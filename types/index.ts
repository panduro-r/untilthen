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

export type Drop = {
  id: string // "drop_" + 8 hex chars
  // Owner-facing label. Plaintext only in the owner's browser; stored as encryptedTitle.
  title: string
  blobName: string // Shelby blob name: `deaddrop_${id}`
  iv: string // base64 AES-GCM IV
  ciphertextFingerprint: string // SHA-256 of ciphertext, hex groups

  mode: DropMode
  distribution: DropDistribution
  status: DropStatus
  expirationMicros: number // Shelby blob expiration

  // --- gating (exactly one path populated) ---
  // timelock: the gated secret (shardA private / K public) timelock-encrypted to a drand round.
  tlockShardA?: string // tlock-js armored ciphertext. base64/armored.
  releaseRound?: number
  // multisig: secret IBE-encrypted to identity=dropId under the signer-group key.
  contractRef?: string
  ibeHeader?: string // base64 IBE ciphertext header

  // --- owner reset copy (timelock only; wallet-wrapped, useless to the backend) ---
  ownerShardA?: string // base64 (private timelock)
  ownerKeyWrapped?: string // base64 (public timelock)

  // --- timelock fields ---
  checkInIntervalDays?: number
  gracePeriodDays?: number
  triggerAt?: number // epoch ms

  // --- multisig fields ---
  signers?: Signer[]
  threshold?: number
  approvals?: number

  // private drops only; empty for public
  recipients: Recipient[]

  releasedAt: number | null
  notificationsSentAt: number | null

  ownerAddress: string
  created: number
}

/** What the owner's wallet signs to prove "I'm still here". */
export type CheckInPayload = {
  dropId: string
  timestamp: number
  action: "checkin"
}
