// Shared domain types for DeadDrop.
// See ARCHITECTURE.md "Data model" — this mirrors it. The backend never stores a raw
// shardA or raw K; every secret-derived field here is gated, wrapped, or timelocked.

export type RecipientType = "email" | "wallet"
export type WalletChain = "aptos" | "solana" | "ethereum"

/** CONDITION axis — how the gated secret is released. */
export type DropMode = "timelock" | "multisig"
/** DISTRIBUTION axis — who can open the drop. */
export type DropDistribution = "private" | "public"
export type DropStatus = "armed" | "released" | "expired"

export type Recipient = {
  id: string // "rcpt_" + 8 hex chars, used in retrieval URLs
  name?: string // owner-facing label
  type: RecipientType

  // Primary email is required for both types — that's how recipients are notified.
  // Plaintext only in the owner's browser; ciphertext (encrypted_email) at rest.
  email: string
  backupEmail?: string

  // Wallet recipients only.
  walletAddress?: string
  walletChain?: WalletChain

  // shardB XOR (recipient-only wrap key). base64. See ARCHITECTURE "Per-recipient shardB wrapping".
  wrappedShardB: string

  // Single-use burn flag (private drops). Set when the link is first claimed.
  releasedAt: number | null
}

export type Signer = {
  id: string // "sgnr_" + 8 hex chars
  name?: string
  address: string
  chain: WalletChain
  // Signer's BLS public key (their share of the group key), set at registration.
  // base64 of a compressed G1 point. Used to BLS-verify their approval signature.
  blsPubkey?: string
  registered: boolean
  approvedAt?: number | null
}
