// lib/reset.ts — the owner's "I'm still here" timer reset (timelock drops). Runs in the browser.
//
// Recovers the gated secret from the wallet-wrapped owner copy (using only the owner's wallet
// signature), re-timelocks it to a fresh future round, and atomically swaps the stored ciphertext
// with an optimistic-concurrency guard. The backend never sees the raw secret — only the new locked
// ciphertext. Mirrors the owner-copy construction in lib/armDrop.ts.

import { deriveWalletWrapKey, xorBytes, unb64 } from "@/lib/crypto"
import { roundForTime, timelockEncryptShardA } from "@/lib/timelock"
import { signMessage, signMessageFull } from "@/lib/aptos"
import { ownerAuthMessage } from "@/lib/auth"
import { useWalletStore } from "@/store/wallet"

function ownerAuthBody(dropId: string) {
  return async () => {
    const wallet = useWalletStore.getState()
    if (!wallet.address || !wallet.publicKey) throw new Error("Connect your wallet first")
    const auth = await signMessageFull(ownerAuthMessage(dropId))
    return {
      address: wallet.address,
      chain: "aptos" as const,
      publicKey: wallet.publicKey,
      signature: auth.signatureHex,
      fullMessage: auth.fullMessage,
    }
  }
}

/**
 * Reset the timer for a timelock drop. Returns the new release time (epoch ms) on success.
 * Throws with a human message on failure (e.g. already released, or a concurrent reset won).
 */
export async function resetTimer(dropId: string): Promise<{ triggerAt: number }> {
  const buildAuth = ownerAuthBody(dropId)

  // 1. Fetch the owner's wrapped reset copy + current round (owner-authed).
  const matRes = await fetch(`/api/drops/${dropId}/owner-material`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ auth: await buildAuth() }),
  })
  if (!matRes.ok) {
    const body = await matRes.json().catch(() => ({}))
    throw new Error(body.error || "Couldn't load this drop for reset.")
  }
  const mat = (await matRes.json()) as {
    distribution: "private" | "public"
    ownerShardA: string | null
    ownerKeyWrapped: string | null
    releaseRound: number
    checkInIntervalDays: number | null
    gracePeriodDays: number | null
  }

  const wrapped = mat.distribution === "private" ? mat.ownerShardA : mat.ownerKeyWrapped
  if (!wrapped) {
    throw new Error("This drop has no owner reset copy, so it can't be reset.")
  }

  // 2. Recover the gated secret using only the owner's wallet signature.
  const ownerWrapKey = await deriveWalletWrapKey(await signMessage(`deaddrop:owner:${dropId}`))
  const toGate = xorBytes(unb64(wrapped), ownerWrapKey)

  // 3. Re-timelock to a fresh round.
  const intervalDays = mat.checkInIntervalDays ?? 30
  const graceDays = mat.gracePeriodDays ?? 7
  const triggerAt = Date.now() + intervalDays * 86_400_000 + graceDays * 86_400_000
  const newRound = await roundForTime(triggerAt)
  const newTlock = await timelockEncryptShardA(toGate, newRound)

  // 4. Atomic swap with optimistic-concurrency guard (expectedOldRound).
  const res = await fetch(`/api/drops/${dropId}/reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tlockShardA: newTlock,
      releaseRound: newRound,
      triggerAt,
      expectedOldRound: mat.releaseRound,
      auth: await buildAuth(),
    }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || "Couldn't reset the timer. It may have already released.")
  }
  // toGate held the raw secret in memory; it falls out of scope here.
  return { triggerAt }
}
