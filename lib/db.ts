// lib/db.ts — database abstraction for the notifier/API layer.
//
// The methods mirror the ATOMIC SQL operations in CLAUDE.md (single-statement check-and-burn,
// optimistic-concurrency reset, idempotent release stamp) so the security guarantees hold and the
// swap to real Supabase (service-role client) is mechanical. Until then getDb() returns the
// in-memory mock. This module is SERVER-ONLY (it would hold the service-role client); never import
// it into a "use client" file.

import type { DropMode, DropDistribution, RecipientType, WalletChain } from "@/types"
import { MockDb } from "./db.mock"

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
  blsPubkey: string
}

export type RecipientWithSecret = RecipientRow & { secret: string | null }

export interface Db {
  // --- create ---
  createDrop(input: NewDropInput): Promise<void>

  // --- reads ---
  getDrop(dropId: string): Promise<DropRow | null>
  listDropsByOwner(ownerAddress: string): Promise<DropRow[]>
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
  putWalletRegistration(dropId: string, recipientId: string, reg: WalletRegistration): Promise<void>
  getWalletRegistration(dropId: string, recipientId: string): Promise<WalletRegistration | null>
  putSignerRegistration(dropId: string, signerId: string, reg: SignerRegistration): Promise<void>
  getSignerRegistration(dropId: string, signerId: string): Promise<SignerRegistration | null>

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

/** Returns the active Db. Mock until the real Supabase service-role client is wired. */
export function getDb(): Db {
  if (!singleton) singleton = new MockDb()
  return singleton
}

/** Test helper — swap in a fresh mock (or a custom Db). */
export function __setDb(db: Db | null): void {
  singleton = db
}
