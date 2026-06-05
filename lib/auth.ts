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
})

export type OwnerAuth = z.infer<typeof ownerAuthSchema>

/** The challenge the owner signs for a given drop (must appear in the signed fullMessage). */
export function ownerAuthMessage(dropId: string): string {
  return `deaddrop:auth:${dropId}`
}

/**
 * The message a multisig signer signs at registration. Binds the BLS pubkey to the wallet so a
 * stranger can't register a bogus key for someone else's signer slot.
 */
export function signerRegisterMessage(dropId: string, blsPubkey: string): string {
  return `deaddrop:signer:${dropId}:${blsPubkey}`
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
  return verifyAptosSignedMessage({
    address: auth.address,
    publicKey: auth.publicKey,
    signedMessage: auth.fullMessage,
    signature: auth.signature,
    mustContain: ownerAuthMessage(dropId),
  })
}
