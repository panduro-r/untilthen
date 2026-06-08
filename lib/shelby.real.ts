// lib/shelby.real.ts — real @shelby-protocol/sdk calls behind the lib/shelby.ts surface.
//
// RESOLVED open question (ARCHITECTURE "Open questions to resolve BEFORE building", CLAUDE.md §9):
// At SDK 0.3.1 BOTH upload paths require a raw Aptos `Account` with signing capability —
// `ShelbyClient.upload({ signer: Account })` and `rpc.putBlobResumable({ account: Account })` both
// sign the storage-layer challenge-response (BlobOwnerAuth = { challenge, signature, publicKey })
// internally. A browser wallet (Petra) never exposes its private key, so the connected wallet CANNOT
// be the Shelby upload signer. We therefore use the documented fallback: a server-side uploader
// Account (key in SHELBY_UPLOADER_PRIVATE_KEY, server-only) signs+pays the upload. The browser still
// encrypts everything first — only ciphertext is ever uploaded, so confidentiality is unchanged.
//
// DOWNLOAD, by contrast, needs only an account *address* (`download({ account, blobName })`) — NO
// signer. So recipient/public retrieval runs fully client-side with no backend, preserving the
// "decryptable with our backend offline" property.
//
// This module imports the SDK's BROWSER subpath (erasure coding + RPC), which works in both the
// browser (download) and Node (upload, from the server route). It is loaded dynamically by
// lib/shelby.ts only in real mode, so mock-mode builds never bundle the SDK.

import {
  ShelbyClient,
  BlobNameSchema,
  SHELBY_DEPLOYER,
  type BlobName,
  type ShelbyNetwork,
} from "@shelby-protocol/sdk/browser"
import { Network, AccountAddress, type Account } from "@aptos-labs/ts-sdk"

function networkFromEnv(): ShelbyNetwork {
  const n = (process.env.NEXT_PUBLIC_SHELBY_NETWORK ?? "shelbynet").toLowerCase()
  if (n === "testnet") return Network.TESTNET
  if (n === "local") return Network.LOCAL
  return Network.SHELBYNET
}

let client: ShelbyClient | null = null
function getShelbyClient(): ShelbyClient {
  if (!client) client = new ShelbyClient({ network: networkFromEnv() })
  return client
}

/** The fixed account namespace blobs are stored under (the server uploader's address). */
function uploaderAddress(): string {
  const addr = process.env.NEXT_PUBLIC_SHELBY_UPLOADER_ADDRESS
  if (!addr) {
    throw new Error(
      "NEXT_PUBLIC_SHELBY_UPLOADER_ADDRESS is not set — required to locate Shelby blobs for download.",
    )
  }
  return addr
}

function blobName(name: string): BlobName {
  return BlobNameSchema.parse(name)
}

/**
 * Upload ciphertext under the given uploader Account. Node/server-only path (needs a raw Account).
 * The browser never calls this directly — it POSTs ciphertext to /api/shelby/upload, which does.
 */
export async function uploadWithAccount(args: {
  account: Account
  ciphertext: Uint8Array
  blobName: string
  expirationMicros: number
}): Promise<{ blobName: string }> {
  await getShelbyClient().upload({
    blobData: args.ciphertext,
    signer: args.account,
    blobName: blobName(args.blobName),
    expirationMicros: args.expirationMicros,
  })
  return { blobName: args.blobName }
}

/**
 * Extend a blob's expiration via `blob_metadata::increase_expiration_time(name, new_expiration)`.
 * Shelbynet caps the new expiration at now + 48h per call, so the renewal cron calls this on a
 * sub-48h cadence to keep long-locked drops alive until they release. Node/server-only (needs the
 * uploader Account, which owns the blob). Verified against the live module ABI:
 *   increase_expiration_time(&signer, blob_name: 0x1::string::String, new_expiration: u64)
 */
export async function increaseExpiration(args: {
  account: Account
  blobName: string
  newExpirationMicros: number
}): Promise<{ hash: string }> {
  const aptos = getShelbyClient().aptos
  const txn = await aptos.transaction.build.simple({
    sender: args.account.accountAddress,
    data: {
      function: `${SHELBY_DEPLOYER.toString()}::blob_metadata::increase_expiration_time`,
      functionArguments: [blobName(args.blobName), args.newExpirationMicros],
    },
  })
  const pending = await aptos.signAndSubmitTransaction({ signer: args.account, transaction: txn })
  await aptos.waitForTransaction({ transactionHash: pending.hash })
  return { hash: pending.hash }
}

/** Download ciphertext by blob name. Signer-less — works in the browser and Node. */
export async function downloadCiphertext(name: string): Promise<Uint8Array> {
  const blob = await getShelbyClient().download({
    account: AccountAddress.from(uploaderAddress()),
    blobName: name,
  })
  return drain(blob.readable, blob.contentLength)
}

async function drain(stream: ReadableStream, expectedBytes: number): Promise<Uint8Array> {
  const reader = (stream as ReadableStream<Uint8Array>).getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      chunks.push(value)
      total += value.length
    }
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  if (expectedBytes && total !== expectedBytes) {
    // Shelby validates integrity internally; this is a belt-and-suspenders guard.
    throw new Error(`Shelby download length mismatch: got ${total}, expected ${expectedBytes}`)
  }
  return out
}
