// lib/decrypt.ts — recipient-side retrieval. Everything happens in the browser; the server only
// ever returns locked material (ARCHITECTURE.md "Flow: condition is met and recipient retrieves").
//
// Supported now: time-lock (private email + public). Wallet-recipient and multisig paths need the
// wallet signature / aggregated signer shares and land with those flows.

import { importKey, decryptBytes, hkdfExpand, xorBytes, fingerprintOf, unb64, unpackFileWithName } from "@/lib/crypto"
import { timelockDecryptShardA } from "@/lib/timelock"
import { downloadCiphertext } from "@/lib/shelby"
import { base64UrlDecode } from "@/lib/ids"
import { ibeDecryptWithShares } from "@/lib/threshold"
import { AptosMoveContractClient } from "@/lib/contract.aptos"

/** Recover the gated secret (shardA private / K public) for a multisig drop from on-chain shares. */
async function recoverMultisigSecret(dropId: string): Promise<Uint8Array> {
  const contractAddress = process.env.NEXT_PUBLIC_DEADDROP_CONTRACT_ADDRESS
  if (!contractAddress) throw new Error("Multi-sig isn't configured on this deployment.")
  const noop = async (): Promise<{ hash: string }> => {
    throw new Error("read-only client")
  }
  const drop = await new AptosMoveContractClient(contractAddress, noop).getDrop(dropId)
  if (!drop) throw new Error("This drop isn't on chain yet.")
  if (!drop.released) {
    throw new Error("This drop hasn't been released — signers still need to approve.")
  }
  // Aggregates the published shares into the IBE key and decrypts the header.
  return ibeDecryptWithShares({ ibeHeader: drop.ibeHeader, dropId, shares: drop.sigShares })
}

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
  ownerAddress: string // Shelby blob namespace (owner's wallet)
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

  const ciphertext = await downloadCiphertext(m.blobName, m.ownerAddress)
  await verifyFingerprint(ciphertext, m.ciphertextFingerprint)
  const urlSecret = base64UrlDecode(args.urlSecretB64Url)

  if (m.mode === "timelock" && m.tlockShardA) {
    return decryptPrivateEmailTimelock({
      ciphertext,
      iv: unb64(m.iv),
      tlockShardA: m.tlockShardA,
      wrappedShardB: unb64(m.wrappedShardB ?? ""),
      urlSecret,
    })
  }
  // Multisig: shardA comes from aggregating the on-chain signer shares; shardB from the URL secret.
  const shardA = await recoverMultisigSecret(args.dropId)
  const wrapKey = await hkdfExpand(urlSecret, "deaddrop-shardB", 32)
  const shardB = xorBytes(unb64(m.wrappedShardB ?? ""), wrapKey)
  const key = await importKey(xorBytes(shardA, shardB))
  return decryptBytes(ciphertext, unb64(m.iv), key)
}

export type PublicMeta = {
  dropId: string
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
  ownerAddress: string // Shelby blob namespace (owner's wallet)
  status: "armed" | "released"
}

export async function fetchPublicMeta(dropId: string): Promise<PublicMeta> {
  const res = await fetch(`/api/public/${dropId}`)
  if (res.status === 404) throw new Error("That drop doesn't exist or isn't public.")
  if (!res.ok) throw new Error("We couldn't load that drop.")
  const data = (await res.json()) as Omit<PublicMeta, "dropId">
  return { ...data, dropId }
}

/** Public self-unlock: fetch + verify ciphertext, tlock-decrypt. Throws if the round hasn't published. */
export async function retrievePublic(meta: PublicMeta): Promise<Uint8Array> {
  const ciphertext = await downloadCiphertext(meta.blobName, meta.ownerAddress)
  await verifyFingerprint(ciphertext, meta.ciphertextFingerprint)

  if (meta.mode === "timelock" && meta.tlockShardA) {
    return decryptPublicTimelock({ ciphertext, iv: unb64(meta.iv), tlockShardA: meta.tlockShardA })
  }
  // Multisig public: the gated secret IS K, recovered from the on-chain shares.
  const keyBytes = await recoverMultisigSecret(meta.dropId)
  const key = await importKey(keyBytes)
  return decryptBytes(ciphertext, unb64(meta.iv), key)
}

/**
 * Trigger a browser download of decrypted bytes. `decrypted` may carry the original filename in a
 * header (see packFileWithName) — if so we use it (keeping the extension); otherwise we fall back to
 * `fallbackName` (e.g. for legacy blobs armed before filename packing).
 */
export function triggerDownload(decrypted: Uint8Array, fallbackName: string): void {
  const { name, data } = unpackFileWithName(decrypted)
  const blob = new Blob([data as BlobPart], { type: "application/octet-stream" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name || fallbackName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
