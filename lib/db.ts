// lib/db.ts — database abstraction for the notifier/API layer.
//
// The methods mirror the ATOMIC SQL operations in CLAUDE.md (single-statement check-and-burn,
// optimistic-concurrency reset, idempotent release stamp) so the security guarantees hold and the
// swap to real Supabase (service-role client) is mechanical. Until then getDb() returns the
// in-memory mock. This module is SERVER-ONLY (it would hold the service-role client); never import
// it into a "use client" file.

import type { DropMode, DropDistribution, RecipientType, WalletChain } from "@/types"
import { MockDb } from "./db.mock"
import { SupabaseDb } from "./db.supabase"

export type DropRow = {
  id: string
  ownerAddress: string
  encryptedTitle: string
  blobName: string
  iv: string
  ciphertextFingerprint: string
  mode: DropMode
  distribution: DropDistribution
  tlockShardA: string | null
  releaseRound: number | null
  contractRef: string | null
  ibeHeader: string | null
  ownerShardA: string | null
  ownerKeyWrapped: string | null
  checkInIntervalDays: number | null
  gracePeriodDays: number | null
  triggerAt: number | null // epoch ms
  releasedAt: number | null // epoch ms
  notificationsSentAt: number | null // epoch ms
  expirationMicros: number
  createdAt: number
}

export type RecipientRow = {
  id: string
  dropId: string
  name: string | null
  type: RecipientType
  encryptedEmail: string
  encryptedBackupEmail: string | null
  walletAddress: string | null
  walletChain: WalletChain | null
  wrappedShardB: string
  releasedAt: number | null
}

export type SignerRow = {
  id: string
  dropId: string
  name: string | null
  walletAddress: string
  walletChain: WalletChain
  blsPubkey: string | null
  encryptedEmail: string
  registered: boolean
  approvedAt: number | null
}

/** What the atomic burn returns — only locked material, never a usable secret. */
/** Secret-free drop summary for the owner dashboard. No gated material, no owner copy — just status. */
export type OwnerDropSummary = {
  id: string
  encryptedTitle: string // decrypted client-side with the owner title key
  mode: DropMode
  distribution: DropDistribution
  triggerAt: number | null
  releasedAt: number | null
  createdAt: number
  recipientCount: number
}

export type BurnResult = {
  wrappedShardB: string
  tlockShardA: string | null
  contractRef: string | null
  ibeHeader: string | null
  releaseRound: number | null
  iv: string
  blobName: string
  ciphertextFingerprint: string
  mode: DropMode
  ownerAddress: string // blob namespace (owner's wallet) for the signer-less Shelby download
}

export type NewDropInput = Omit<DropRow, "releasedAt" | "notificationsSentAt" | "createdAt"> & {
  recipients: Omit<RecipientRow, "releasedAt">[]
  recipientSecrets: { recipientId: string; secret: string }[]
  signers: Omit<SignerRow, "approvedAt">[]
}

export type WalletRegistration = {
  walletAddress: string
  walletChain: WalletChain
  signature: string
  publicKey: string | null
}

export type SignerRegistration = {
  walletAddress: string
  walletChain: WalletChain
  encPublicKey: string // base64 X25519 (32 bytes) — owner ECIES-deals the signer's share to it
}

export type RecipientWithSecret = RecipientRow & { secret: string | null }

export interface Db {
  // --- create ---
  createDrop(input: NewDropInput): Promise<void>

  // --- reads ---
  getDrop(dropId: string): Promise<DropRow | null>
  /** Permanently delete a drop and its recipients/signers/secrets (FK cascade). */
  deleteDrop(dropId: string): Promise<void>
  listDropsByOwner(ownerAddress: string): Promise<DropRow[]>
  /** Safe, secret-free drop summaries for the signed-in owner's dashboard (server-fetched). */
  listOwnerDropSummaries(ownerAddress: string): Promise<OwnerDropSummary[]>
  getPublicDrop(dropId: string): Promise<DropRow | null> // only distribution='public'

  // --- atomic private retrieval (single statement: verify-released + within-expiry + unburned,
  //     set released_at, return locked material). Null if not retrievable / already burned. ---
  burnRecipient(dropId: string, recipientId: string, expiryMs: number): Promise<BurnResult | null>

  // --- atomic timelock reset with optimistic-concurrency guard. False on race / already released. ---
  resetTimelock(args: {
    dropId: string
    tlockShardA: string
    releaseRound: number
    triggerAt: number
    expectedOldRound: number
  }): Promise<boolean>

  // --- pre-registration (decoupled from the drops FK; finalized into rows at arm) ---
  // Insert-once: returns false if the slot is already registered (no silent overwrite). This blocks
  // an attacker silently replacing a legitimate registration before the owner arms the drop.
  putWalletRegistration(dropId: string, recipientId: string, reg: WalletRegistration): Promise<boolean>
  getWalletRegistration(dropId: string, recipientId: string): Promise<WalletRegistration | null>
  putSignerRegistration(dropId: string, signerId: string, reg: SignerRegistration): Promise<boolean>
  getSignerRegistration(dropId: string, signerId: string): Promise<SignerRegistration | null>

  // --- once-per-wallet signer key (replaces per-safe signer registration) ---
  // A signer's enc key is wallet-scoped, so it's stored once by address and reused across all safes.
  // Upsert: re-registering the same wallet just refreshes the key (idempotent), never errors.
  putSignerKey(address: string, encPublicKey: string): Promise<void>
  getSignerKey(address: string): Promise<string | null>

  // --- notifier ---
  /** Drops whose condition is met but not yet stamped released (timelock round reached). */
  findReleasableTimelockDrops(currentRound: number): Promise<DropRow[]>
  findUnreleasedMultisigDrops(): Promise<DropRow[]>
  /** Atomic, idempotent: set released_at where null; return the row only if THIS call set it. */
  markReleased(dropId: string): Promise<DropRow | null>
  getRecipientsWithSecrets(dropId: string): Promise<RecipientWithSecret[]>
  deleteRecipientSecrets(recipientIds: string[]): Promise<void>
  markNotificationsSent(dropId: string): Promise<void>
}

let singleton: Db | null = null

/**
 * Returns the active Db. Uses the real Supabase service-role client when both the URL and the
 * service-role key are present; otherwise the in-memory mock (dev/tests). The dynamic import keeps
 * @supabase/supabase-js out of bundles that don't need it.
 */
export function getDb(): Db {
  if (!singleton) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    singleton = url && serviceKey ? new SupabaseDb(url, serviceKey) : new MockDb()
  }
  return singleton
}

/** Test helper — swap in a fresh mock (or a custom Db). */
export function __setDb(db: Db | null): void {
  singleton = db
}
