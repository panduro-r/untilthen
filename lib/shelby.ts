// lib/shelby.ts — wrapper around Shelby decentralized blob storage.
// Components/crypto code call this module, never the SDK directly.
//
// NOTE on `signer` (ARCHITECTURE.md "Open questions to resolve BEFORE building"): ShelbySigner is
// whatever the Shelby SDK's upload accepts. It is NOT a private-key Account constructed from the
// wallet (that cannot exist). The connected Aptos wallet's signer (signAndSubmitTransaction path) is
// preferred; confirm against the SDK before wiring the real upload. Until the SDK is available
// (Early Access), everything routes to lib/shelby.mock.ts.

import * as mock from "./shelby.mock"

/**
 * The signer the Shelby upload accepts. Thin wrapper over the connected Aptos wallet. The exact
 * shape is finalized once the real SDK type is known; at minimum we need the uploader's account
 * address (for blob namespacing and listing).
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

// Real SDK isn't installed yet (access-gated). Default to the mock; an explicit opt-out before the
// SDK is wired is a loud error rather than a confusing runtime failure.
const USE_MOCK = process.env.NEXT_PUBLIC_USE_SHELBY_MOCK !== "false"
if (!USE_MOCK) {
  throw new Error(
    "Real @shelby-protocol/sdk is not wired yet. Set NEXT_PUBLIC_USE_SHELBY_MOCK=true (default).",
  )
}

const ONE_DAY_MICROS = 86_400_000_000

/**
 * Pick a blob expiration that overshoots the release time by ≥30 days (ARCHITECTURE "Renewal
 * logic"). For multisig drops there's no fixed release time → generous default (now + 1 year).
 */
export function chooseExpiration(releaseAtMs?: number): number {
  const nowMicros = Date.now() * 1000
  if (releaseAtMs === undefined) return nowMicros + 365 * ONE_DAY_MICROS
  const releaseMicros = releaseAtMs * 1000
  return Math.max(nowMicros + 30 * ONE_DAY_MICROS, releaseMicros + 30 * ONE_DAY_MICROS)
}

export async function uploadCiphertext(args: {
  signer: ShelbySigner
  ciphertext: Uint8Array
  blobName: string // e.g. `deaddrop_${dropId}`
  expirationMicros: number
}): Promise<{ blobName: string }> {
  return mock.uploadCiphertext(args)
}

export async function downloadCiphertext(blobName: string): Promise<Uint8Array> {
  return mock.downloadCiphertext(blobName)
}

export async function listBlobs(args: {
  account: string
  limit?: number
  offset?: number
}): Promise<BlobMeta[]> {
  return mock.listBlobs(args)
}

/** True when the in-memory/IndexedDB mock is active — the dashboard surfaces a banner for this. */
export function isMockActive(): boolean {
  return USE_MOCK
}
