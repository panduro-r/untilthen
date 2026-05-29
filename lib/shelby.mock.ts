// lib/shelby.mock.ts — drop-in mock for the Shelby SDK while it's access-gated (CLAUDE.md Step 7).
//
// Same API surface as lib/shelby.ts. Backed by an in-memory Map so it works in Node (tests) and the
// browser. For cross-reload persistence in the browser, swap the `store` for an IndexedDB-backed one
// (files can exceed localStorage's ~5MB limit, so IndexedDB — not localStorage — is the right home).
// Blobs are immutable and namespaced by user-supplied name, mirroring real Shelby semantics.

import type { BlobMeta, ShelbySigner } from "./shelby"

type StoredBlob = {
  bytes: Uint8Array
  account: string
  expirationMicros: number
}

const store = new Map<string, StoredBlob>()

export async function uploadCiphertext(args: {
  signer: ShelbySigner
  ciphertext: Uint8Array
  blobName: string
  expirationMicros: number
}): Promise<{ blobName: string }> {
  if (store.has(args.blobName)) {
    // Real Shelby blobs are immutable; reject re-upload of the same name.
    throw new Error(`blob already exists: ${args.blobName}`)
  }
  store.set(args.blobName, {
    bytes: args.ciphertext.slice(),
    account: args.signer.accountAddress,
    expirationMicros: args.expirationMicros,
  })
  return { blobName: args.blobName }
}

export async function downloadCiphertext(blobName: string): Promise<Uint8Array> {
  const blob = store.get(blobName)
  if (!blob) throw new Error(`blob not found: ${blobName}`)
  return blob.bytes.slice()
}

export async function listBlobs(args: {
  account: string
  limit?: number
  offset?: number
}): Promise<BlobMeta[]> {
  const all: BlobMeta[] = []
  for (const [name, blob] of store) {
    if (blob.account === args.account) {
      all.push({ name, size: blob.bytes.length, expiresAt: blob.expirationMicros })
    }
  }
  const offset = args.offset ?? 0
  return all.slice(offset, args.limit ? offset + args.limit : undefined)
}

/** Test/dev helper — not part of the real SDK surface. */
export function __resetMockStore(): void {
  store.clear()
}
