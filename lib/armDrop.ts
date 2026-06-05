// lib/armDrop.ts — the canonical arming flow (ARCHITECTURE.md "Upload flow as actual code").
// Runs entirely in the browser. The backend only ever receives gated/wrapped material.
//
// Supported now: timelock (private + public). Multisig arming needs the deployed Move contract +
// signer pre-registration (their BLS keys) and is gated in the UI until those land.

import {
  importKey,
  exportKey,
  generateKey,
  xorBytes,
  randomBytes,
  hkdfExpand,
  deriveWalletWrapKey,
  deriveOwnerTitleKey,
  encryptTitleForOwner,
  b64,
  encryptBytes,
  fingerprintOf,
} from "@/lib/crypto"
import { roundForTime, timelockEncryptShardA } from "@/lib/timelock"
import { uploadCiphertext, chooseExpiration } from "@/lib/shelby"
import { signMessage, signMessageFull, getWalletSigner } from "@/lib/aptos"
import { ownerAuthMessage } from "@/lib/auth"
import { useWalletStore } from "@/store/wallet"
import type { Draft } from "@/store/draft"

const TITLE_KEY_MESSAGE = "deaddrop:title-key:v1"

export type ArmResult = { dropId: string; publicLink?: string }

/** Ensure we have a fingerprint/iv/keyBytes — the encrypt step fills these, but recompute defensively. */
async function ensureCiphertext(draft: Draft): Promise<{
  ciphertext: Uint8Array
  iv: Uint8Array
  keyBytes: Uint8Array
  fingerprint: string
}> {
  if (draft.ciphertext && draft.iv && draft.keyBytes && draft.fingerprint) {
    return { ciphertext: draft.ciphertext, iv: draft.iv, keyBytes: draft.keyBytes, fingerprint: draft.fingerprint }
  }
  throw new Error("File not encrypted yet")
}

/** Derive (and cache) the session owner title key — one signature, reused for all titles. */
async function getTitleKey(): Promise<CryptoKey> {
  const cached = useWalletStore.getState().titleKey
  if (cached) return cached
  const sig = await signMessage(TITLE_KEY_MESSAGE)
  const key = await deriveOwnerTitleKey(sig)
  useWalletStore.getState().setTitleKey(key)
  return key
}

export async function armDrop(draft: Draft): Promise<ArmResult> {
  const wallet = useWalletStore.getState()
  if (!wallet.address || !wallet.publicKey) throw new Error("Connect your wallet first")
  if (!draft.dropId) throw new Error("Missing drop id")
  if (draft.mode === "multisig") {
    throw new Error(
      "Multisig drops need the on-chain contract deployed and each signer registered — coming next. Use a time-lock for now.",
    )
  }

  const dropId = draft.dropId
  const { ciphertext, iv, keyBytes, fingerprint } = await ensureCiphertext(draft)

  // 1. Decide what gets gated.
  let shardB: Uint8Array | undefined
  let toGate: Uint8Array
  if (draft.distribution === "private") {
    shardB = randomBytes(32)
    toGate = xorBytes(keyBytes, shardB)
  } else {
    toGate = keyBytes
  }

  // 2. Gate it by timelock. releaseAtMs = now + check-in interval + grace.
  const releaseAtMs = Date.now() + draft.checkInHours * 3_600_000 + draft.graceDays * 86_400_000
  const releaseRound = await roundForTime(releaseAtMs)
  const tlockShardA = await timelockEncryptShardA(toGate, releaseRound)

  // 3. Owner copy (wallet-wrapped) so the owner can reset the timer / self-recover.
  const ownerWrapKey = await deriveWalletWrapKey(await signMessage(`deaddrop:owner:${dropId}`))
  const ownerWrapped = b64(xorBytes(toGate, ownerWrapKey))

  // 4. Encrypt the title under the session owner key.
  const titleKey = await getTitleKey()
  const encryptedTitle = await encryptTitleForOwner(draft.title, titleKey, dropId)

  // 5. PRIVATE: wrap shardB per recipient (email path only for now).
  const recipients = draft.distribution === "private"
    ? await Promise.all(
        draft.recipients.map(async (r) => {
          if (r.type !== "email") {
            throw new Error("Wallet recipients require pre-registration — coming next. Use email recipients for now.")
          }
          const secret = randomBytes(32)
          const wrapKey = await hkdfExpand(secret, "deaddrop-shardB", 32)
          return {
            id: r.id,
            type: "email" as const,
            name: r.name,
            email: r.email,
            backupEmail: r.backupEmail || undefined,
            wrappedShardB: b64(xorBytes(shardB!, wrapKey)),
            secret: b64(secret),
          }
        }),
      )
    : []

  // 6. Upload the ciphertext to Shelby (mock until the SDK is available).
  const { blobName } = await uploadCiphertext({
    signer: getWalletSigner(),
    ciphertext,
    blobName: `deaddrop_${dropId}`,
    expirationMicros: chooseExpiration(releaseAtMs),
  })

  // 7. Owner auth challenge (verified server-side over the signed fullMessage).
  const auth = await signMessageFull(ownerAuthMessage(dropId))

  // 8. POST — backend receives only gated/wrapped material.
  const res = await fetch("/api/drops", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      dropId,
      ownerAddress: wallet.address,
      auth: {
        address: wallet.address,
        chain: "aptos",
        publicKey: wallet.publicKey,
        signature: auth.signatureHex,
        fullMessage: auth.fullMessage,
      },
      mode: "timelock",
      distribution: draft.distribution,
      blobName,
      iv: b64(iv),
      fingerprint,
      encryptedTitle,
      expirationMicros: chooseExpiration(releaseAtMs),
      tlockShardA,
      releaseRound,
      ownerShardA: draft.distribution === "private" ? ownerWrapped : undefined,
      ownerKeyWrapped: draft.distribution === "public" ? ownerWrapped : undefined,
      triggerAt: releaseAtMs,
      checkInIntervalDays: Math.round(draft.checkInHours / 24),
      gracePeriodDays: draft.graceDays,
      recipients,
      signers: [],
    }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || "We couldn't arm the drop. Please try again.")
  }

  return {
    dropId,
    publicLink: draft.distribution === "public" ? `${window.location.origin}/p/${dropId}` : undefined,
  }
}

// Re-exported so the encrypt page can produce ciphertext with the same primitives.
export { generateKey, encryptBytes, exportKey, fingerprintOf, importKey }
