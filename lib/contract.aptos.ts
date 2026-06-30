// lib/contract.aptos.ts — real on-chain MoveContractClient (Aptos ts-sdk).
//
// Implements the lib/contract.ts MoveContractClient interface against the deployed until_then module.
// Writes (create_drop, approve_release) go through an injected `submit` callback — the connected
// wallet's signAndSubmitTransaction in the app, or a raw Account in tests. Reads come from the Drop
// table item (no view needed). The call shapes here mirror the on-chain integration test that passes.

import { Aptos, AptosConfig, Network, type SimpleEntryFunctionArgumentTypes } from "@aptos-labs/ts-sdk"
import { b64, unb64 } from "./crypto"
import type { ChainDrop, CreateDropArgs, MoveContractClient, SignatureShare } from "./contract"
import type { DropMode, DropDistribution } from "@/types"

export type EntryPayload = {
  function: `${string}::${string}::${string}`
  functionArguments: SimpleEntryFunctionArgumentTypes[]
}
export type SubmitFn = (payload: EntryPayload) => Promise<{ hash: string }>

function networkFromEnv(): Network {
  switch (process.env.NEXT_PUBLIC_APTOS_NETWORK) {
    case "mainnet":
      return Network.MAINNET
    case "testnet":
      return Network.TESTNET
    case "devnet":
      return Network.DEVNET
    default:
      return Network.SHELBYNET
  }
}

const enc = (s: string) => new TextEncoder().encode(s)
const hexToBytes = (h: string) => unb64(b64FromHex(h))
function b64FromHex(h: string): string {
  const s = h.startsWith("0x") ? h.slice(2) : h
  const out = new Uint8Array(s.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16)
  return b64(out)
}

type RawDrop = {
  owner: string
  mode: number
  distribution: number
  threshold: number
  signers: string[]
  signer_bls_pubkeys: string[]
  group_pubkey: string
  enc_key_shares: string[]
  ibe_ciphertext_header: string
  sig_shares: string[]
  approvals: string[]
  released: boolean
}

export class AptosMoveContractClient implements MoveContractClient {
  private aptos: Aptos
  constructor(
    private contractAddress: string,
    private submit: SubmitFn,
    network: Network = networkFromEnv(),
  ) {
    // The Shelbynet gateway requires an Origin header on most requests. Browsers send one
    // automatically, but the Node SDK does not — so server-side reads (dashboard reconcile, cron,
    // retrieval) are rejected and readRaw silently reads them as "not found" (released: false).
    // Set Origin explicitly when running on the server. (Mirrors scripts/deploy-untilthen-shelbynet.)
    const apiKey = process.env.NEXT_PUBLIC_SHELBY_API_KEY
    const clientConfig: { API_KEY?: string; HEADERS?: Record<string, string> } = {}
    if (apiKey) clientConfig.API_KEY = apiKey
    if (typeof window === "undefined") {
      clientConfig.HEADERS = { Origin: process.env.NEXT_PUBLIC_APP_URL ?? "https://untilthen.xyz" }
    }
    this.aptos = new Aptos(
      new AptosConfig({ network, ...(Object.keys(clientConfig).length ? { clientConfig } : {}) }),
    )
  }

  private fn(name: string): `${string}::${string}::${string}` {
    return `${this.contractAddress}::until_then::${name}` as `${string}::${string}::${string}`
  }

  async createDrop(args: CreateDropArgs): Promise<{ contractRef: string }> {
    const functionArguments: SimpleEntryFunctionArgumentTypes[] = [
      enc(args.dropId),
      args.mode === "multisig" ? 1 : 0,
      args.distribution === "public" ? 1 : 0,
      args.threshold ?? 0,
      args.signers ?? [],
      (args.signerBlsPubkeys ?? []).map(unb64),
      args.groupPubkey ? unb64(args.groupPubkey) : new Uint8Array(),
      (args.encKeyShares ?? []).map(unb64),
      args.ibeHeader ? enc(args.ibeHeader) : new Uint8Array(),
    ]
    await this.submit({ function: this.fn("create_drop"), functionArguments })
    return { contractRef: `aptos://${this.contractAddress}/${args.dropId}` }
  }

  async approveRelease(dropId: string, _signerAddress: string, share: SignatureShare): Promise<void> {
    // The signer IS the submitter (their wallet) — the contract checks the caller is a signer.
    await this.submit({ function: this.fn("approve_release"), functionArguments: [enc(dropId), unb64(share.sig)] })
  }

  async recordReset(dropId: string, newReleaseRound: number): Promise<void> {
    await this.submit({ function: this.fn("record_reset"), functionArguments: [enc(dropId), newReleaseRound] })
  }

  async getDrop(dropId: string): Promise<ChainDrop | null> {
    const raw = await this.readRaw(dropId)
    if (!raw) return null
    const sigShares: SignatureShare[] = raw.sig_shares.map((sigHex, k) => ({
      index: raw.signers.indexOf(raw.approvals[k]) + 1,
      sig: b64FromHex(sigHex),
    }))
    return {
      dropId,
      owner: raw.owner,
      mode: (raw.mode === 1 ? "multisig" : "timelock") as DropMode,
      distribution: (raw.distribution === 1 ? "public" : "private") as DropDistribution,
      threshold: raw.threshold,
      signers: raw.signers,
      signerBlsPubkeys: raw.signer_bls_pubkeys.map(b64FromHex),
      groupPubkey: b64FromHex(raw.group_pubkey),
      encKeyShares: raw.enc_key_shares.map(b64FromHex),
      ibeHeader: new TextDecoder().decode(hexToBytes(raw.ibe_ciphertext_header)),
      sigShares,
      approvals: raw.approvals,
      released: raw.released,
    }
  }

  async getReleaseMaterial(dropId: string): Promise<{ released: boolean; sigShares: SignatureShare[] }> {
    const drop = await this.getDrop(dropId)
    if (!drop) return { released: false, sigShares: [] }
    return { released: drop.released, sigShares: drop.sigShares }
  }

  /** The signer's own encrypted key share (base64) — read from chain to decrypt at approval. */
  async getEncKeyShareFor(dropId: string, signerAddress: string): Promise<string | null> {
    const raw = await this.readRaw(dropId)
    if (!raw) return null
    const i = raw.signers.indexOf(signerAddress)
    return i >= 0 ? b64FromHex(raw.enc_key_shares[i]) : null
  }

  private async readRaw(dropId: string): Promise<RawDrop | null> {
    try {
      const reg = (await this.aptos.getAccountResource({
        accountAddress: this.contractAddress,
        resourceType: `${this.contractAddress}::until_then::Registry`,
      })) as { drops: { handle: string } }
      return await this.aptos.getTableItem<RawDrop>({
        handle: reg.drops.handle,
        data: {
          key_type: "vector<u8>",
          value_type: `${this.contractAddress}::until_then::Drop`,
          key: "0x" + Array.from(enc(dropId)).map((x) => x.toString(16).padStart(2, "0")).join(""),
        },
      })
    } catch {
      return null // drop not on chain (or table item missing)
    }
  }
}

/** Build the app's contract client from the connected wallet's signAndSubmitTransaction. */
export function walletContractClient(
  contractAddress: string,
  signAndSubmit: (txn: unknown) => Promise<{ hash: string }>,
  network: Network = networkFromEnv(),
): AptosMoveContractClient {
  return new AptosMoveContractClient(contractAddress, (payload) => signAndSubmit({ data: payload }), network)
}

/** Build a read-only contract client (no submit) for a given network — used by server/recipient paths
 *  that resolve the network from the drop row, never from a wallet. */
export function readonlyContractClient(contractAddress: string, network: Network): AptosMoveContractClient {
  const noop = async (): Promise<{ hash: string }> => {
    throw new Error("read-only client")
  }
  return new AptosMoveContractClient(contractAddress, noop, network)
}
