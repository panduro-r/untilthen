// lib/sessionClient.ts — client helpers to drive the SIWA session (sign in, sign out, refresh).

import { siwaMessage } from "@/lib/auth"
import { useSessionStore } from "@/store/session"

/** Read the current server session into the store (no wallet popup). */
export async function refreshSession(): Promise<string | null> {
  try {
    const res = await fetch("/api/auth/session")
    const { address } = (await res.json()) as { address: string | null }
    useSessionStore.getState().setAddress(address ?? null)
    return address ?? null
  } catch {
    return null
  } finally {
    useSessionStore.getState().setReady(true)
  }
}

/**
 * Prove wallet ownership (one signature) with an explicit signer + identity, and establish a session.
 * Used during connect — before the wallet store is populated — so it can't read the store; the caller
 * passes the adapter's signMessage, address and publicKey directly. Returns the lowercased address.
 */
export async function loginWith(args: {
  address: string
  publicKey: string
  signMessage: (message: string) => Promise<{ signatureHex: string; fullMessage: string }>
}): Promise<string> {
  const issuedAtMs = Date.now()
  const { signatureHex, fullMessage } = await args.signMessage(siwaMessage(args.address, issuedAtMs))
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      address: args.address,
      publicKey: args.publicKey,
      signature: signatureHex,
      fullMessage,
      issuedAtMs,
    }),
  })
  if (!res.ok) throw new Error("Sign-in failed. Please try again.")
  const { address } = (await res.json()) as { address: string }
  useSessionStore.getState().setAddress(address)
  return address
}

export async function signOut(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => {})
  useSessionStore.getState().setAddress(null)
}
