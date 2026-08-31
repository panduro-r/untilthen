// lib/auth.ts — owner authentication for mutating API routes (SERVER-ONLY).
//
// The owner proves control of owner_address with a wallet signature over a fixed challenge. Aptos
// wallets sign a wrapped `fullMessage` (prefix + nonce), so we verify over that exact signed string
// and require the logical challenge to be contained in it. Possession check, not a session.

import { z } from "zod"
import { verifyAptosSignedMessage } from "./aptos"

export const ownerAuthSchema = z.object({
  address: z.string().min(1),
  chain: z.enum(["aptos", "solana", "ethereum"]),
  publicKey: z.string().min(1),
  signature: z.string().min(1),
  fullMessage: z.string().min(1), // the exact message the wallet signed
  issuedAtMs: z.number().int(), // bound into the signed message; rejected once stale
})

export type OwnerAuth = z.infer<typeof ownerAuthSchema>

/**
 * The challenge the owner signs to authorize a server-side change to a safe (reset / recover).
 *
 * The timestamp is part of the signed bytes so the signature EXPIRES (see OWNER_AUTH_MAX_AGE_MS).
 * Without it the challenge was constant per safe, so one captured signature stayed a permanent
 * capability: replaying it against POST /api/drops/[id]/reset overwrites the drand-locked ciphertext
 * and moves the release date, which can destroy a safe or postpone the switch forever.
 *
 * Unlike ownerCopyMessage this is NOT key material — nothing derives a key from it — so its wording
 * is safe to change without breaking existing safes.
 */
export function ownerAuthMessage(dropId: string, issuedAtMs: number): string {
  return [
    `Until Then — authorize an update to safe ${dropId} (no transaction, no fee)`,
    `Issued: ${new Date(issuedAtMs).toISOString()} (${issuedAtMs})`,
  ].join("\n")
}

/**
 * Max age of an owner-authorization signature. Deliberately wider than the SIWA window: issuedAtMs is
 * stamped BEFORE the wallet prompt, so this has to absorb however long the user takes to approve, and
 * one signature is reused across the two requests of a single reset flow (lib/reset.ts).
 */
const OWNER_AUTH_MAX_AGE_MS = 10 * 60 * 1000

/**
 * The message whose signature derives the owner's reset/recovery key for a safe. Held only by the
 * wallet; lets the owner reset the timer or self-recover. Must be byte-stable per safe (it's key
 * material), so don't change it for an existing safe.
 */
export function ownerCopyMessage(dropId: string): string {
  return `Until Then — enable timer reset & recovery for safe ${dropId} (derives a wallet-only key; no transaction, no fee)`
}

// --- SIWA (Sign In With Aptos): one signature after connect → a session (lib/session) ---

/** Max age of a sign-in signature. Guards against replay of an old captured signature. */
const SIWA_MAX_AGE_MS = 5 * 60 * 1000

/**
 * The canonical sign-in message. Deterministic in (address, issuedAtMs) so the server can rebuild it
 * and verify the wallet signed exactly this. It authorizes NO transaction — just proves ownership.
 */
export function siwaMessage(address: string, issuedAtMs: number): string {
  return [
    "Until Then — confirm wallet ownership",
    "",
    `Address: ${address.toLowerCase()}`,
    `Issued: ${new Date(issuedAtMs).toISOString()} (${issuedAtMs})`,
    "",
    "Signing proves you control this wallet so we can show your drops. It does not authorize any transaction.",
  ].join("\n")
}

export const siwaSchema = z.object({
  address: z.string().min(1),
  publicKey: z.string().min(1),
  signature: z.string().min(1),
  fullMessage: z.string().min(1),
  issuedAtMs: z.number().int(),
})

export type SiwaInput = z.infer<typeof siwaSchema>

/**
 * Verify a SIWA sign-in: the signature is valid for `address`, the signed message contains our exact
 * canonical message (so it can't be a signature reused from another app/action), and it's fresh.
 * Returns the lowercased address on success, else null.
 */
export function verifySiwa(input: SiwaInput): string | null {
  const ageMs = Math.abs(Date.now() - input.issuedAtMs)
  if (ageMs > SIWA_MAX_AGE_MS) return null
  const expected = siwaMessage(input.address, input.issuedAtMs)
  const ok = verifyAptosSignedMessage({
    address: input.address,
    publicKey: input.publicKey,
    signedMessage: input.fullMessage,
    signature: input.signature,
    mustContain: expected,
  })
  return ok ? input.address.toLowerCase() : null
}

/**
 * The message a multisig signer signs at registration. WALLET-SCOPED (not per-safe): the signer
 * registers their encryption key once and it is reused for every safe. Embeds the encryption pubkey
 * so it's bound to the wallet — a stranger can't register a bogus key for someone else's wallet.
 * One-time proof (verified server-side at registration only, never re-derived).
 */
export function signerRegisterMessage(encPublicKey: string): string {
  return `Until Then — register as a signer (binds your key ${encPublicKey}; no transaction, no fee)`
}

/**
 * Verify that `auth` is a valid owner signature over the drop challenge AND belongs to
 * `expectedAddress`. Aptos only at launch.
 */
export async function verifyOwnerAuth(
  auth: OwnerAuth,
  expectedAddress: string,
  dropId: string,
): Promise<boolean> {
  if (auth.chain !== "aptos") return false
  if (auth.address.toLowerCase() !== expectedAddress.toLowerCase()) return false
  // Freshness: the timestamp is inside the signed bytes, so a stale (or future-dated) signature can't
  // be replayed. Math.abs mirrors verifySiwa — it also rejects a clock-skewed future timestamp.
  if (Math.abs(Date.now() - auth.issuedAtMs) > OWNER_AUTH_MAX_AGE_MS) return false
  return verifyAptosSignedMessage({
    address: auth.address,
    publicKey: auth.publicKey,
    signedMessage: auth.fullMessage,
    signature: auth.signature,
    mustContain: ownerAuthMessage(dropId, auth.issuedAtMs),
  })
}
