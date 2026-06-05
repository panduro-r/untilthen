// Live on-chain multisig integration test against the deployed DeadDrop contract (devnet).
// Skipped unless RUN_CHAIN=1. Run:
//   RUN_CHAIN=1 CONTRACT=0x6b97...5fc4 npx vitest run lib/__tests__/multisig-chain.test.ts
//
// Proves the FULL owner-dealt multisig flow end to end on the real chain:
//   setup group → ECIES-deal shares to signers → IBE-encrypt the secret → create_drop on chain →
//   signers decrypt their share, produce a BLS sig share, approve_release on chain (contract
//   BLS-verifies) → threshold flips released → read shares from chain → aggregate → IBE-decrypt →
//   recover the original secret.

import { describe, it, expect, beforeAll } from "vitest"
import {
  Aptos,
  AptosConfig,
  Network,
  Account,
  Ed25519PrivateKey,
  type SimpleEntryFunctionArgumentTypes,
} from "@aptos-labs/ts-sdk"
import { ed25519 } from "@noble/curves/ed25519.js"
import { setupSignerGroup, ibeEncryptToGroup, produceSignatureShare, ibeDecryptWithShares } from "../threshold"
import { signerEncMessage, deriveSignerEncKeypair, eciesEncryptToSigner, eciesDecryptAsSigner } from "../signerKeys"
import { randomBytes, b64, unb64 } from "../crypto"

const RUN = !!process.env.RUN_CHAIN
const CONTRACT = process.env.CONTRACT ?? "0x6b9735ae28dc3eb5d901ba89a64239c374f9334d0523c34a497f46ebe77e5fc4"

const hex = (b: Uint8Array) => Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("")
const hexToBytes = (h: string) => {
  const s = h.startsWith("0x") ? h.slice(2) : h
  const out = new Uint8Array(s.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16)
  return out
}

describe.skipIf(!RUN)("multisig on-chain (devnet)", () => {
  const aptos = new Aptos(new AptosConfig({ network: Network.DEVNET }))

  // Make 3 signers from noble keys (we control the raw bytes → can sign the enc-message off-SDK).
  const signerSks = [0, 1, 2].map(() => ed25519.utils.randomSecretKey())
  const signers = signerSks.map((sk) => Account.fromPrivateKey({ privateKey: new Ed25519PrivateKey(hex(sk)) }))
  const owner = Account.generate()
  const dropId = `drop_ms_${Date.now().toString(36)}`
  const secret = randomBytes(32)

  beforeAll(async () => {
    await aptos.fundAccount({ accountAddress: owner.accountAddress, amount: 100_000_000 })
    for (const s of signers) await aptos.fundAccount({ accountAddress: s.accountAddress, amount: 100_000_000 })
  }, 60_000)

  async function submit(acct: Account, fn: string, functionArguments: SimpleEntryFunctionArgumentTypes[]) {
    const txn = await aptos.transaction.build.simple({
      sender: acct.accountAddress,
      data: { function: `${CONTRACT}::dead_drop::${fn}` as `${string}::${string}::${string}`, functionArguments },
    })
    const pending = await aptos.signAndSubmitTransaction({ signer: acct, transaction: txn })
    await aptos.waitForTransaction({ transactionHash: pending.hash })
  }

  type ChainDrop = {
    released: boolean
    signers: string[]
    approvals: string[]
    sig_shares: string[]
    enc_key_shares: string[]
    signer_bls_pubkeys: string[]
    ibe_ciphertext_header: string
  }
  async function readDrop(): Promise<ChainDrop> {
    const reg = (await aptos.getAccountResource({
      accountAddress: CONTRACT,
      resourceType: `${CONTRACT}::dead_drop::Registry`,
    })) as { drops: { handle: string } }
    return aptos.getTableItem<ChainDrop>({
      handle: reg.drops.handle,
      data: { key_type: "vector<u8>", value_type: `${CONTRACT}::dead_drop::Drop`, key: "0x" + hex(new TextEncoder().encode(dropId)) },
    })
  }

  it("creates a 2-of-3 multisig drop, approves to threshold, and recovers the secret on-chain", async () => {
    // 1. Owner deals the group + ECIES-encrypts each share to the signer's wallet-derived enc pubkey.
    const group = setupSignerGroup({ signerCount: 3, threshold: 2 })
    const encShares: Uint8Array[] = []
    for (let i = 0; i < 3; i++) {
      const encSig = hex(ed25519.sign(new TextEncoder().encode(signerEncMessage(dropId)), signerSks[i]))
      const { publicKey } = await deriveSignerEncKeypair(encSig)
      const packedB64 = await eciesEncryptToSigner(publicKey, unb64(group.signers[i].shareScalar))
      encShares.push(unb64(packedB64))
    }

    // 2. IBE-encrypt the secret to identity=dropId under the group key.
    const ibeHeader = await ibeEncryptToGroup({ secret, dropId, groupPubkey: group.groupPubkey })

    // 3. create_drop on chain (mode=1 multisig, distribution=1 public, threshold=2).
    await submit(owner, "create_drop", [
      new TextEncoder().encode(dropId),
      1,
      1,
      2,
      signers.map((s) => s.accountAddress.toString()),
      group.signers.map((s) => unb64(s.blsPubkey)),
      unb64(group.groupPubkey),
      encShares,
      new TextEncoder().encode(ibeHeader),
    ])

    let drop = await readDrop()
    expect(drop.released).toBe(false)
    expect(drop.enc_key_shares.length).toBe(3)

    // 4. Signers 0 and 2 each: decrypt their share from chain, produce a BLS sig share, approve.
    for (const i of [0, 2]) {
      const encSig = hex(ed25519.sign(new TextEncoder().encode(signerEncMessage(dropId)), signerSks[i]))
      const { privateKey } = await deriveSignerEncKeypair(encSig)
      const packed = hexToBytes(drop.enc_key_shares[i])
      const shareScalar = await eciesDecryptAsSigner(privateKey, b64(packed))
      const share = produceSignatureShare({ dropId, shareScalar: b64(shareScalar), index: i + 1 })
      await submit(signers[i], "approve_release", [new TextEncoder().encode(dropId), unb64(share.sig)])
    }

    // 5. Threshold met → released, both shares published on-chain.
    drop = await readDrop()
    expect(drop.released).toBe(true)
    expect(drop.sig_shares.length).toBe(2)

    // 6. Aggregate the on-chain shares (index = signer position + 1) → IBE-decrypt → recover secret.
    const shares = drop.sig_shares.map((sigHex, k) => ({
      index: drop.signers.indexOf(drop.approvals[k]) + 1,
      sig: b64(hexToBytes(sigHex)),
    }))
    const headerFromChain = new TextDecoder().decode(hexToBytes(drop.ibe_ciphertext_header))
    const recovered = await ibeDecryptWithShares({ ibeHeader: headerFromChain, dropId, shares })
    expect([...recovered]).toEqual([...secret])
  }, 120_000)
})
