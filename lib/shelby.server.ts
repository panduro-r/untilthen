// lib/shelby.server.ts — SERVER-ONLY. Holds the Shelby uploader Account (private key in env) and
// performs the actual upload. Never import this from a "use client" file or any non-route module
// that ends up in the browser bundle — SHELBY_UPLOADER_PRIVATE_KEY must never reach the client.
//
// Why a server uploader: Shelby's SDK upload needs a raw Account with signing capability (see
// lib/shelby.real.ts). The owner's browser has only a wallet (no private key), so it POSTs the
// already-encrypted ciphertext to /api/shelby/upload, which calls this module. Only ciphertext
// crosses the wire; plaintext never leaves the browser, so the no-plaintext invariant holds.

import "server-only"
import { Account, Ed25519PrivateKey, PrivateKey, PrivateKeyVariants } from "@aptos-labs/ts-sdk"
import { uploadWithAccount, increaseExpiration } from "./shelby.real"

let uploader: Account | null = null

function getUploaderAccount(): Account {
  if (uploader) return uploader
  const raw = process.env.SHELBY_UPLOADER_PRIVATE_KEY
  if (!raw) {
    throw new Error(
      "SHELBY_UPLOADER_PRIVATE_KEY is not set — required to upload to Shelby in real mode.",
    )
  }
  // Accept AIP-80 (`ed25519-priv-0x…`) or a bare hex key; normalize then build the account.
  const formatted = PrivateKey.formatPrivateKey(raw, PrivateKeyVariants.Ed25519)
  uploader = Account.fromPrivateKey({ privateKey: new Ed25519PrivateKey(formatted) })
  return uploader
}

/** The uploader's address — the namespace blobs are stored under. Used to sanity-check env wiring. */
export function uploaderAccountAddress(): string {
  return getUploaderAccount().accountAddress.toString()
}

export async function uploadCiphertext(args: {
  ciphertext: Uint8Array
  blobName: string
  expirationMicros: number
}): Promise<{ blobName: string }> {
  return uploadWithAccount({ account: getUploaderAccount(), ...args })
}

/** Extend a blob's expiration (renewal cron). Signs with the uploader account that owns the blob. */
export async function renewBlob(args: {
  blobName: string
  newExpirationMicros: number
}): Promise<{ hash: string }> {
  return increaseExpiration({ account: getUploaderAccount(), ...args })
}
