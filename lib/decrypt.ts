// lib/decrypt.ts — recipient-side retrieval. Everything happens in the browser; the server only
// ever returns locked material (ARCHITECTURE.md "Flow: condition is met and recipient retrieves").
//
// Supported now: time-lock (private email + public). Wallet-recipient and multisig paths need the
// wallet signature / aggregated signer shares and land with those flows.

import { importKey, decryptBytes, hkdfExpand, xorBytes, fingerprintOf, unb64 } from "@/lib/crypto"
import { timelockDecryptShardA } from "@/lib/timelock"
import { downloadCiphertext } from "@/lib/shelby"
import { base64UrlDecode } from "@/lib/ids"

async function verifyFingerprint(ciphertext: Uint8Array, expected: string): Promise<void> {
  const got = await fingerprintOf(ciphertext)
  if (got !== expected) throw new Error("Fingerprint mismatch — the stored file may be corrupted.")
}

/** Private email recipient, time-lock drop. urlSecret is the raw 32 bytes from the URL fragment. */
export async function decryptPrivateEmailTimelock(args: {
  ciphertext: Uint8Array
  iv: Uint8Array
  tlockShardA: string
  wrappedShardB: Uint8Array
  urlSecret: Uint8Array
}): Promise<Uint8Array> {
  const shardA = await timelockDecryptShardA(args.tlockShardA) // throws until the round publishes
  const wrapKey = await hkdfExpand(args.urlSecret, "deaddrop-shardB", 32)
  const shardB = xorBytes(args.wrappedShardB, wrapKey)
  const key = await importKey(xorBytes(shardA, shardB))
  return decryptBytes(args.ciphertext, args.iv, key)
}

/** Public time-lock drop: the gated secret IS K (no shardB). */
export async function decryptPublicTimelock(args: {
  ciphertext: Uint8Array
  iv: Uint8Array
  tlockShardA: string
}): Promise<Uint8Array> {
  const keyBytes = await timelockDecryptShardA(args.tlockShardA)
  const key = await importKey(keyBytes)
  return decryptBytes(args.ciphertext, args.iv, key)
}

export type RetrieveMaterial = {
  wrappedShardB: string | null
  tlockShardA: string | null
  contractRef: string | null
  ibeHeader: string | null
  releaseRound: number | null
  iv: string
  blobName: string
  ciphertextFingerprint: string
  mode: "timelock" | "multisig"
}

/**
 * Claim a PRIVATE drop: burn the link (server), fetch + verify the ciphertext, decrypt locally.
 * `urlSecret` is the base64url fragment from the email link.
 */
export async function retrievePrivate(args: {
  dropId: string
  recipientId: string
  urlSecretB64Url: string
}): Promise<Uint8Array> {
  const res = await fetch(`/api/retrieve/${args.dropId}/${args.recipientId}`)
  if (res.status === 410) throw new Error("This link is no longer valid.")
  if (!res.ok) throw new Error("This link is no longer valid.")
  const m = (await res.json()) as RetrieveMaterial

  if (m.mode !== "timelock" || !m.tlockShardA) {
    throw new Error("Multisig retrieval is coming next — this drop can't be opened here yet.")
  }
  const ciphertext = await downloadCiphertext(m.blobName)
  await verifyFingerprint(ciphertext, m.ciphertextFingerprint)

  return decryptPrivateEmailTimelock({
    ciphertext,
    iv: unb64(m.iv),
    tlockShardA: m.tlockShardA,
    wrappedShardB: unb64(m.wrappedShardB ?? ""),
    urlSecret: base64UrlDecode(args.urlSecretB64Url),
  })
}

export type PublicMeta = {
  distribution: "public"
  mode: "timelock" | "multisig"
  releaseRound: number | null
  contractRef: string | null
  tlockShardA: string | null
  ibeHeader: string | null
  iv: string
  blobName: string
  ciphertextFingerprint: string
  triggerAt: number | null
  status: "armed" | "released"
}

export async function fetchPublicMeta(dropId: string): Promise<PublicMeta> {
  const res = await fetch(`/api/public/${dropId}`)
  if (res.status === 404) throw new Error("That drop doesn't exist or isn't public.")
  if (!res.ok) throw new Error("We couldn't load that drop.")
  return res.json()
}

/** Public self-unlock: fetch + verify ciphertext, tlock-decrypt. Throws if the round hasn't published. */
export async function retrievePublic(meta: PublicMeta): Promise<Uint8Array> {
  if (meta.mode !== "timelock" || !meta.tlockShardA) {
    throw new Error("Multisig public retrieval is coming next.")
  }
  const ciphertext = await downloadCiphertext(meta.blobName)
  await verifyFingerprint(ciphertext, meta.ciphertextFingerprint)
  return decryptPublicTimelock({ ciphertext, iv: unb64(meta.iv), tlockShardA: meta.tlockShardA })
}

/** Trigger a browser download of decrypted bytes. */
export function triggerDownload(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes as BlobPart], { type: "application/octet-stream" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
