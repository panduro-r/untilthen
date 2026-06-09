// lib/shelby.mock.ts — drop-in mock for the Shelby SDK while it's access-gated (CLAUDE.md Step 7).
//
// Same API surface as lib/shelby.ts. In the BROWSER it persists blobs in IndexedDB (so a recipient
// in the same browser can fetch a blob uploaded earlier; files can exceed localStorage's ~5MB limit,
// so IndexedDB — not localStorage). In Node (tests) it falls back to an in-memory Map. Blobs are
// immutable and namespaced by user-supplied name, mirroring real Shelby semantics.
//
// (A same-browser mock can't deliver a blob to a recipient on a different device — that's what the
// real Shelby SDK is for. The mock is enough to develop and demo every flow locally.)

import type { BlobMeta, ShelbySigner } from "./shelby"

type StoredBlob = { bytes: Uint8Array; account: string; expirationMicros: number }

const DB_NAME = "deaddrop-shelby"
const STORE = "blobs"
const hasIDB = typeof indexedDB !== "undefined"
const mem = new Map<string, StoredBlob>()

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "name" })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbReq<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await idb()
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const req = fn(tx.objectStore(STORE))
    req.onsuccess = () => resolve(req.result as T)
    req.onerror = () => reject(req.error)
  })
}

export async function uploadCiphertext(args: {
  signer: ShelbySigner
  ciphertext: Uint8Array
  blobName: string
  expirationMicros: number
}): Promise<{ blobName: string }> {
  const blob: StoredBlob = {
    bytes: args.ciphertext.slice(),
    account: args.signer.accountAddress,
    expirationMicros: args.expirationMicros,
  }
  if (hasIDB) {
    const existing = await idbReq<unknown>("readonly", (s) => s.get(args.blobName))
    if (existing) throw new Error(`blob already exists: ${args.blobName}`) // immutable
    await idbReq("readwrite", (s) => s.put({ name: args.blobName, ...blob }))
  } else {
    if (mem.has(args.blobName)) throw new Error(`blob already exists: ${args.blobName}`)
    mem.set(args.blobName, blob)
  }
  return { blobName: args.blobName }
}

export async function downloadCiphertext(blobName: string): Promise<Uint8Array> {
  if (hasIDB) {
    const row = await idbReq<{ bytes: Uint8Array } | undefined>("readonly", (s) => s.get(blobName))
    if (!row) throw new Error(`blob not found: ${blobName}`)
    return new Uint8Array(row.bytes)
  }
  const blob = mem.get(blobName)
  if (!blob) throw new Error(`blob not found: ${blobName}`)
  return blob.bytes.slice()
}

export async function listBlobs(args: { account: string; limit?: number; offset?: number }): Promise<BlobMeta[]> {
  let rows: { name: string; bytes: Uint8Array; account: string; expirationMicros: number }[]
  if (hasIDB) {
    rows = await idbReq("readonly", (s) => s.getAll())
  } else {
    rows = [...mem.entries()].map(([name, b]) => ({ name, ...b }))
  }
  const all = rows
    .filter((r) => r.account === args.account)
    .map((r) => ({ name: r.name, size: r.bytes.length, expiresAt: r.expirationMicros }))
  const offset = args.offset ?? 0
  return all.slice(offset, args.limit ? offset + args.limit : undefined)
}

export async function deleteCiphertext(blobName: string): Promise<void> {
  if (hasIDB) {
    await idbReq("readwrite", (s) => s.delete(blobName))
  } else {
    mem.delete(blobName)
  }
}

/** Test/dev helper — clears the in-memory store (Node). */
export function __resetMockStore(): void {
  mem.clear()
}
