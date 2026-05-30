// lib/auth.ts — owner authentication for mutating API routes (SERVER-ONLY).
//
// The owner proves control of owner_address with a wallet signature over a fixed challenge. We
// verify it with the same cross-chain verifier the registration routes use (lib/aptos). This is a
// possession check, not a session — there's no cookie; each mutating request carries its own proof.

import { z } from "zod"
import { verifySignature } from "./aptos"

export const ownerAuthSchema = z.object({
  address: z.string().min(1),
  chain: z.enum(["aptos", "solana", "ethereum"]),
  publicKey: z.string().optional(),
  signature: z.string().min(1),
})

export type OwnerAuth = z.infer<typeof ownerAuthSchema>

/** The challenge the owner signs for a given drop. */
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
 * Verify that `auth` is a valid owner signature over the drop challenge AND that it belongs to
 * `expectedAddress`. Returns true only when both hold.
 */
export async function verifyOwnerAuth(
  auth: OwnerAuth,
  expectedAddress: string,
  dropId: string,
): Promise<boolean> {
  if (auth.address.toLowerCase() !== expectedAddress.toLowerCase()) return false
  return verifySignature({
    address: auth.address,
    chain: auth.chain,
    message: ownerAuthMessage(dropId),
    signature: auth.signature,
    publicKey: auth.publicKey,
  })
}
