// lib/shelby.ts — wrapper around Shelby decentralized blob storage.
// Components/crypto code call this module, never the SDK directly.
//
// Two backends, selected by NEXT_PUBLIC_USE_SHELBY_MOCK:
//   - mock (default): lib/shelby.mock.ts — IndexedDB (browser) / in-memory (node). No tokens needed.
//   - real ("false"): the @shelby-protocol/sdk. The OWNER WALLET signs + pays the register_blob
//     transaction and the blob is stored under the owner's address; download is signer-less and takes
//     that address. No server account, no subsidy — the data owner pays for their own storage.
//
// The real SDK is loaded dynamically so mock-mode builds never bundle it.

import * as mock from "./shelby.mock"
import { shelbyNetworkFor, type AppNetwork } from "./networks"

/**
 * The signer passed to uploadCiphertext. It carries the connected wallet's address (used by the mock
 * for namespacing, and reserved for a future where Shelby accepts a wallet signer directly). In real
 * mode the actual upload is signed by the SERVER uploader account, so this is informational only —
 * Shelby's SDK requires a raw private-key Account, which a browser wallet cannot provide.
 */
export interface ShelbySigner {
  readonly accountAddress: string
  signAndSubmitTransaction?: (txn: unknown) => Promise<{ hash: string }>
}

export type BlobMeta = {
  name: string
  size: number
  expiresAt: number // microseconds since epoch
}

// Default to the mock: real uploads need a funded ShelbyUSD/APT uploader account. Opt in explicitly
// with NEXT_PUBLIC_USE_SHELBY_MOCK=false once the uploader account is funded.
const USE_MOCK = process.env.NEXT_PUBLIC_USE_SHELBY_MOCK !== "false"

const ONE_DAY_MICROS = 86_400_000_000
const ONE_HOUR_MICROS = 3_600_000_000
const ONE_MINUTE_MICROS = 60_000_000

/**
 * The hard cap a real Shelby network places on a single blob's lifetime. Shelbynet enforces 48h
 * (extendable +48h per `increase_expiration_time` call), so a long-locked drop must be renewed by
 * the renewal cron until it releases. Tunable via env for other networks. Mock storage has no cap.
 */
function maxBlobLifetimeMicros(): number {
  const hours = Number(process.env.NEXT_PUBLIC_SHELBY_MAX_BLOB_HOURS ?? "48")
  return Math.max(1, Number.isFinite(hours) ? hours : 48) * ONE_HOUR_MICROS
}

/**
 * Pick a blob expiration. Ideally overshoots the release time by ≥30 days (ARCHITECTURE "Renewal
 * logic"); multisig has no fixed release → 1 year. On a real network the per-blob lifetime is capped
 * (Shelbynet: 48h), so we set just under the cap and rely on the renewal cron to extend it until the
 * drop releases + its retrieval window closes. The mock has no cap, preserving the long overshoot.
 */
export function chooseExpiration(releaseAtMs?: number): number {
  const nowMicros = Date.now() * 1000
  const desired =
    releaseAtMs === undefined
      ? nowMicros + 365 * ONE_DAY_MICROS
      : Math.max(nowMicros + 30 * ONE_DAY_MICROS, releaseAtMs * 1000 + 30 * ONE_DAY_MICROS)
  if (USE_MOCK) return desired
  const cap = nowMicros + maxBlobLifetimeMicros() - 5 * ONE_MINUTE_MICROS
  return Math.min(desired, cap)
}

export async function uploadCiphertext(args: {
  signer: ShelbySigner
  ciphertext: Uint8Array
  blobName: string // e.g. `deaddrop_${dropId}`
  expirationMicros: number
  network?: AppNetwork // the wallet's network; selects the Shelby endpoint (real mode). Mock ignores it.
}): Promise<{ blobName: string }> {
  if (USE_MOCK) return mock.uploadCiphertext(args)

  // Real mode: the OWNER WALLET signs + pays the register_blob tx, then we put the bytes. No server,
  // no subsidy — the data owner pays for their own Shelby storage. Browser-only (drives the wallet).
  if (typeof window === "undefined") {
    throw new Error("Real Shelby uploads require the connected wallet (browser only).")
  }
  if (!args.signer.signAndSubmitTransaction) {
    throw new Error("Connect a wallet to store your file on Shelby.")
  }
  const real = await import("./shelby.real")
  return real.uploadViaWallet({
    signAndSubmit: args.signer.signAndSubmitTransaction,
    ownerAddress: args.signer.accountAddress,
    ciphertext: args.ciphertext,
    blobName: args.blobName,
    expirationMicros: args.expirationMicros,
    network: args.network ? shelbyNetworkFor(args.network) : undefined,
  })
}

/** Download by blob name from the OWNER's wallet namespace (where the owner registered the blob). */
export async function downloadCiphertext(blobName: string, ownerAddress: string, network?: AppNetwork): Promise<Uint8Array> {
  if (USE_MOCK) return mock.downloadCiphertext(blobName)
  const real = await import("./shelby.real")
  return real.downloadCiphertext(blobName, ownerAddress, network ? shelbyNetworkFor(network) : undefined)
}

/** Whether the blob still exists on-chain (real mode). Mock blobs are always "alive" if present. */
export async function isBlobAlive(blobName: string, ownerAddress: string, network?: AppNetwork): Promise<boolean> {
  if (USE_MOCK) return true
  const real = await import("./shelby.real")
  return real.isBlobAlive(blobName, ownerAddress, network ? shelbyNetworkFor(network) : undefined)
}

/** Permanently delete the blob. Owner wallet signs delete_blob (real); mock just drops it. */
export async function deleteBlob(args: { signer: ShelbySigner; blobName: string; network?: AppNetwork }): Promise<void> {
  if (USE_MOCK) return mock.deleteCiphertext(args.blobName)
  if (typeof window === "undefined") throw new Error("Real Shelby delete requires the connected wallet.")
  if (!args.signer.signAndSubmitTransaction) throw new Error("Connect a wallet to delete the file.")
  const real = await import("./shelby.real")
  return real.deleteViaWallet({
    signAndSubmit: args.signer.signAndSubmitTransaction,
    blobName: args.blobName,
    network: args.network ? shelbyNetworkFor(args.network) : undefined,
  })
}

export async function listBlobs(args: {
  account: string
  limit?: number
  offset?: number
}): Promise<BlobMeta[]> {
  if (USE_MOCK) return mock.listBlobs(args)
  // The live dashboard reads drop metadata from Supabase, not Shelby, so this isn't on a user path.
  // (A real implementation would query the Shelby indexer via createShelbyIndexerClient + GetBlobs.)
  throw new Error("listBlobs is not implemented for the real Shelby backend.")
}

/** True when the in-memory/IndexedDB mock is active — the dashboard surfaces a banner for this. */
export function isMockActive(): boolean {
  return USE_MOCK
}

/**
 * Map a low-level upload/arm failure (wallet, Aptos, Shelby RPC) to a clear, actionable message.
 * Mirrors the failure modes the frameloop Shelby app surfaces. Order matters — check the most
 * specific signatures first.
 */
export function describeArmError(err: unknown): string {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()

  if (/reject|denied|declined|cancell?ed|user has rejected/.test(msg)) {
    return "You declined the wallet signature, so nothing was stored. Try again when ready."
  }
  if (/429|too many requests|rate.?limit/.test(msg)) {
    return "The Shelby network is rate-limiting requests right now. Wait a few seconds and try again."
  }
  if (/insufficient.*(gas|transaction fee)|balance_for_transaction_fee|gas.*insufficient|out of gas/.test(msg)) {
    return "Not enough APT to pay gas. Open “Get test funds” and top up APT for Shelbynet, then retry."
  }
  if (/shelbyusd|insufficient.*(storage|payment|fund)|e_?insufficient|storage.*(fee|payment)/.test(msg)) {
    return "Not enough ShelbyUSD to pay for storage. Open “Get test funds” and top up ShelbyUSD, then retry."
  }
  if (/timeout|timed out|expired|not found on chain|could not.*confirm|waitfortransaction/.test(msg)) {
    return "The network couldn’t confirm your storage transaction in time. Give it a moment and try again."
  }
  if (/already exists|immutable|already registered/.test(msg)) {
    return "That file is already stored on Shelby. Start a new drop to store it again."
  }
  if (/wallet|connect|not connected/.test(msg)) {
    return "Connect your Petra wallet (on Shelbynet) before arming the drop."
  }
  return "We couldn’t arm the drop. Please try again."
}
