// lib/db.mock.ts — in-memory Db implementation (CLAUDE.md "all mocked/local").
//
// Each method implements the SAME logical operation as the atomic SQL it stands in for. Because JS
// is single-threaded, a synchronous check-and-mutate inside one method is atomic with respect to
// other awaited calls — so burnRecipient / resetTimelock / markReleased preserve the single-use,
// optimistic-concurrency, and idempotency guarantees the real Postgres statements provide.

import type {
  Db,
  DropRow,
  RecipientRow,
  SignerRow,
  BurnResult,
  NewDropInput,
  WalletRegistration,
  SignerRegistration,
  RecipientWithSecret,
} from "./db"

const SEVEN_DAYS_MS = 7 * 86_400_000

export class MockDb implements Db {
  private drops = new Map<string, DropRow>()
  private recipients = new Map<string, RecipientRow>()
  private recipientSecrets = new Map<string, string>()
  private signers = new Map<string, SignerRow>()
  private walletRegs = new Map<string, WalletRegistration>()
  private signerRegs = new Map<string, SignerRegistration>()

  async createDrop(input: NewDropInput): Promise<void> {
    if (this.drops.has(input.id)) throw new Error(`drop exists: ${input.id}`)
    const { recipients, recipientSecrets, signers, ...drop } = input
    this.drops.set(input.id, {
      ...drop,
      releasedAt: null,
      notificationsSentAt: null,
      createdAt: Date.now(),
    })
    for (const r of recipients) this.recipients.set(r.id, { ...r, releasedAt: null })
    for (const s of recipientSecrets) this.recipientSecrets.set(s.recipientId, s.secret)
    for (const s of signers) this.signers.set(s.id, { ...s, approvedAt: null })
  }

  async getDrop(dropId: string): Promise<DropRow | null> {
    return this.drops.get(dropId) ?? null
  }

  async listDropsByOwner(ownerAddress: string): Promise<DropRow[]> {
    return [...this.drops.values()].filter((d) => d.ownerAddress === ownerAddress)
  }

  async getPublicDrop(dropId: string): Promise<DropRow | null> {
    const d = this.drops.get(dropId)
    return d && d.distribution === "public" ? d : null
  }

  async burnRecipient(
    dropId: string,
    recipientId: string,
    expiryMs: number = SEVEN_DAYS_MS,
  ): Promise<BurnResult | null> {
    const r = this.recipients.get(recipientId)
    const d = this.drops.get(dropId)
    if (!r || !d) return null
    // All conditions in one guarded check-and-set (mirrors the single UPDATE ... RETURNING).
    if (r.dropId !== dropId) return null
    if (r.releasedAt !== null) return null // already burned
    if (d.distribution !== "private") return null
    if (d.releasedAt === null) return null // not released
    if (d.releasedAt + expiryMs <= Date.now()) return null // expired
    r.releasedAt = Date.now()
    return {
      wrappedShardB: r.wrappedShardB,
      tlockShardA: d.tlockShardA,
      contractRef: d.contractRef,
      ibeHeader: d.ibeHeader,
      releaseRound: d.releaseRound,
      iv: d.iv,
      blobName: d.blobName,
      ciphertextFingerprint: d.ciphertextFingerprint,
      mode: d.mode,
    }
  }

  async resetTimelock(args: {
    dropId: string
    tlockShardA: string
    releaseRound: number
    triggerAt: number
    expectedOldRound: number
  }): Promise<boolean> {
    const d = this.drops.get(args.dropId)
    if (!d) return false
    // optimistic-concurrency guard + cannot reset a released drop (one atomic predicate)
    if (d.releaseRound !== args.expectedOldRound) return false
    if (d.releasedAt !== null) return false
    d.tlockShardA = args.tlockShardA
    d.releaseRound = args.releaseRound
    d.triggerAt = args.triggerAt
    return true
  }

  async putWalletRegistration(
    dropId: string,
    recipientId: string,
    reg: WalletRegistration,
  ): Promise<boolean> {
    const key = `${dropId}:${recipientId}`
    if (this.walletRegs.has(key)) return false // insert-once: no silent overwrite
    this.walletRegs.set(key, reg)
    return true
  }

  async getWalletRegistration(
    dropId: string,
    recipientId: string,
  ): Promise<WalletRegistration | null> {
    return this.walletRegs.get(`${dropId}:${recipientId}`) ?? null
  }

  async putSignerRegistration(
    dropId: string,
    signerId: string,
    reg: SignerRegistration,
  ): Promise<boolean> {
    const key = `${dropId}:${signerId}`
    if (this.signerRegs.has(key)) return false // insert-once: no silent overwrite
    this.signerRegs.set(key, reg)
    return true
  }

  async getSignerRegistration(
    dropId: string,
    signerId: string,
  ): Promise<SignerRegistration | null> {
    return this.signerRegs.get(`${dropId}:${signerId}`) ?? null
  }

  async findReleasableTimelockDrops(currentRound: number): Promise<DropRow[]> {
    return [...this.drops.values()].filter(
      (d) =>
        d.mode === "timelock" &&
        d.releasedAt === null &&
        d.releaseRound !== null &&
        d.releaseRound <= currentRound,
    )
  }

  async findUnreleasedMultisigDrops(): Promise<DropRow[]> {
    return [...this.drops.values()].filter((d) => d.mode === "multisig" && d.releasedAt === null)
  }

  async listDropsForRenewal(retentionMs: number): Promise<DropRow[]> {
    const cutoff = Date.now() - retentionMs
    return [...this.drops.values()].filter(
      (d) =>
        d.releasedAt === null || d.distribution === "public" || (d.releasedAt ?? 0) > cutoff,
    )
  }

  async markReleased(dropId: string): Promise<DropRow | null> {
    const d = this.drops.get(dropId)
    if (!d || d.releasedAt !== null) return null // idempotent: only the call that sets it gets the row
    d.releasedAt = Date.now()
    return d
  }

  async getRecipientsWithSecrets(dropId: string): Promise<RecipientWithSecret[]> {
    // LEFT JOIN semantics: wallet recipients have no secret row (secret: null), not dropped.
    return [...this.recipients.values()]
      .filter((r) => r.dropId === dropId)
      .map((r) => ({ ...r, secret: this.recipientSecrets.get(r.id) ?? null }))
  }

  async deleteRecipientSecrets(recipientIds: string[]): Promise<void> {
    for (const id of recipientIds) this.recipientSecrets.delete(id)
  }

  async markNotificationsSent(dropId: string): Promise<void> {
    const d = this.drops.get(dropId)
    if (d) d.notificationsSentAt = Date.now()
  }

  // --- test helpers (not part of Db) ---
  __getRecipient(id: string): RecipientRow | undefined {
    return this.recipients.get(id)
  }
  __hasSecret(recipientId: string): boolean {
    return this.recipientSecrets.has(recipientId)
  }
  __getSigners(dropId: string): SignerRow[] {
    return [...this.signers.values()].filter((s) => s.dropId === dropId)
  }
}
