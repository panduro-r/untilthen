// lib/db.supabase.ts — real Db backed by Supabase (service-role client). SERVER-ONLY.
//
// Atomic operations go through the SQL functions in supabase/migrations/0002_atomic_functions.sql
// (.rpc), so the single-use / optimistic-concurrency / idempotency guarantees live in the database.
// Simple reads/writes use the query builder. Postgres timestamptz columns are mapped to epoch ms.

import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import type {
  Db,
  DropRow,
  OwnerDropSummary,
  RecipientRow,
  BurnResult,
  NewDropInput,
  WalletRegistration,
  SignerRegistration,
  SignerRow,
  RecipientWithSecret,
} from "./db"
import type { DropMode, DropDistribution, RecipientType, WalletChain } from "@/types"

// Raw row shapes as returned by PostgREST (snake_case; timestamps are ISO strings).
type RawDrop = {
  id: string
  owner_address: string
  encrypted_title: string
  blob_name: string
  iv: string
  ciphertext_fingerprint: string
  mode: DropMode
  distribution: DropDistribution
  tlock_shard_a: string | null
  release_round: number | string | null
  contract_ref: string | null
  ibe_header: string | null
  owner_shard_a: string | null
  owner_key_wrapped: string | null
  check_in_interval_days: number | null
  grace_period_days: number | null
  trigger_at: string | null
  released_at: string | null
  notifications_sent_at: string | null
  expiration_micros: number | string
  created_at: string | null
}

type RawRecipient = {
  id: string
  drop_id: string
  name: string | null
  type: RecipientType
  encrypted_email: string
  encrypted_backup_email: string | null
  wallet_address: string | null
  wallet_chain: WalletChain | null
  wrapped_shard_b: string
  released_at: string | null
}

const tsMs = (iso: string | null): number | null => (iso ? Date.parse(iso) : null)
const num = (v: number | string | null): number | null =>
  v === null ? null : typeof v === "string" ? Number(v) : v

function mapDrop(r: RawDrop): DropRow {
  return {
    id: r.id,
    ownerAddress: r.owner_address,
    encryptedTitle: r.encrypted_title,
    blobName: r.blob_name,
    iv: r.iv,
    ciphertextFingerprint: r.ciphertext_fingerprint,
    mode: r.mode,
    distribution: r.distribution,
    tlockShardA: r.tlock_shard_a,
    releaseRound: num(r.release_round),
    contractRef: r.contract_ref,
    ibeHeader: r.ibe_header,
    ownerShardA: r.owner_shard_a,
    ownerKeyWrapped: r.owner_key_wrapped,
    checkInIntervalDays: r.check_in_interval_days,
    gracePeriodDays: r.grace_period_days,
    triggerAt: tsMs(r.trigger_at),
    releasedAt: tsMs(r.released_at),
    notificationsSentAt: tsMs(r.notifications_sent_at),
    expirationMicros: num(r.expiration_micros) ?? 0,
    createdAt: tsMs(r.created_at) ?? 0,
  }
}

function mapRecipient(r: RawRecipient): RecipientRow {
  return {
    id: r.id,
    dropId: r.drop_id,
    name: r.name,
    type: r.type,
    encryptedEmail: r.encrypted_email,
    encryptedBackupEmail: r.encrypted_backup_email,
    walletAddress: r.wallet_address,
    walletChain: r.wallet_chain,
    wrappedShardB: r.wrapped_shard_b,
    releasedAt: tsMs(r.released_at),
  }
}

export class SupabaseDb implements Db {
  private sb: SupabaseClient

  constructor(url: string, serviceRoleKey: string) {
    this.sb = createClient(url, serviceRoleKey, { auth: { persistSession: false } })
  }

  async createDrop(input: NewDropInput): Promise<void> {
    const p_drop = {
      id: input.id,
      owner_address: input.ownerAddress,
      encrypted_title: input.encryptedTitle,
      blob_name: input.blobName,
      iv: input.iv,
      ciphertext_fingerprint: input.ciphertextFingerprint,
      mode: input.mode,
      distribution: input.distribution,
      tlock_shard_a: input.tlockShardA,
      release_round: input.releaseRound,
      contract_ref: input.contractRef,
      ibe_header: input.ibeHeader,
      owner_shard_a: input.ownerShardA,
      owner_key_wrapped: input.ownerKeyWrapped,
      check_in_interval_days: input.checkInIntervalDays,
      grace_period_days: input.gracePeriodDays,
      trigger_at: input.triggerAt,
      expiration_micros: input.expirationMicros,
    }
    const p_recipients = input.recipients.map((r) => ({
      id: r.id,
      drop_id: r.dropId,
      name: r.name,
      type: r.type,
      encrypted_email: r.encryptedEmail,
      encrypted_backup_email: r.encryptedBackupEmail,
      wallet_address: r.walletAddress,
      wallet_chain: r.walletChain,
      wrapped_shard_b: r.wrappedShardB,
    }))
    const p_secrets = input.recipientSecrets.map((s) => ({
      recipient_id: s.recipientId,
      secret: s.secret,
    }))
    const p_signers = input.signers.map((s) => ({
      id: s.id,
      drop_id: s.dropId,
      name: s.name,
      wallet_address: s.walletAddress,
      wallet_chain: s.walletChain,
      bls_pubkey: s.blsPubkey,
      encrypted_email: s.encryptedEmail,
      registered: s.registered,
    }))
    const { error } = await this.sb.rpc("create_drop_tx", { p_drop, p_recipients, p_secrets, p_signers })
    if (error) throw new Error(error.message)
  }

  async getDrop(dropId: string): Promise<DropRow | null> {
    const { data, error } = await this.sb.from("drops").select("*").eq("id", dropId).maybeSingle()
    if (error) throw new Error(error.message)
    return data ? mapDrop(data as RawDrop) : null
  }

  async deleteDrop(dropId: string): Promise<void> {
    // recipients / recipient_secrets / signers cascade via the FK `on delete cascade`.
    const { error } = await this.sb.from("drops").delete().eq("id", dropId)
    if (error) throw new Error(error.message)
  }

  async listDropsByOwner(ownerAddress: string): Promise<DropRow[]> {
    const { data, error } = await this.sb.from("drops").select("*").eq("owner_address", ownerAddress)
    if (error) throw new Error(error.message)
    return (data as RawDrop[]).map(mapDrop)
  }

  async listOwnerDropSummaries(ownerAddress: string): Promise<OwnerDropSummary[]> {
    // ilike (no wildcards) = case-insensitive exact match, since session addresses are lowercased.
    const { data, error } = await this.sb
      .from("drops")
      .select("id, encrypted_title, mode, distribution, trigger_at, released_at, created_at, recipients(count)")
      .ilike("owner_address", ownerAddress)
      .order("created_at", { ascending: false })
    if (error) throw new Error(error.message)
    const rows = data as Array<{
      id: string
      encrypted_title: string
      mode: DropMode
      distribution: DropDistribution
      trigger_at: string | null
      released_at: string | null
      created_at: string | null
      recipients: Array<{ count: number }> | null
    }>
    return rows.map((r) => ({
      id: r.id,
      encryptedTitle: r.encrypted_title,
      mode: r.mode,
      distribution: r.distribution,
      triggerAt: tsMs(r.trigger_at),
      releasedAt: tsMs(r.released_at),
      createdAt: tsMs(r.created_at) ?? 0,
      recipientCount: r.recipients?.[0]?.count ?? 0,
    }))
  }

  async getPublicDrop(dropId: string): Promise<DropRow | null> {
    const { data, error } = await this.sb
      .from("drops")
      .select("*")
      .eq("id", dropId)
      .eq("distribution", "public")
      .maybeSingle()
    if (error) throw new Error(error.message)
    return data ? mapDrop(data as RawDrop) : null
  }

  async burnRecipient(dropId: string, recipientId: string, expiryMs: number): Promise<BurnResult | null> {
    const { data, error } = await this.sb.rpc("burn_recipient", {
      p_drop_id: dropId,
      p_recipient_id: recipientId,
      p_expiry_ms: expiryMs,
    })
    if (error) throw new Error(error.message)
    const rows = data as Array<{
      wrapped_shard_b: string
      tlock_shard_a: string | null
      contract_ref: string | null
      ibe_header: string | null
      release_round: number | string | null
      iv: string
      blob_name: string
      ciphertext_fingerprint: string
      mode: DropMode
      owner_address: string
    }>
    if (!rows || rows.length === 0) return null
    const r = rows[0]
    return {
      wrappedShardB: r.wrapped_shard_b,
      tlockShardA: r.tlock_shard_a,
      contractRef: r.contract_ref,
      ibeHeader: r.ibe_header,
      releaseRound: num(r.release_round),
      iv: r.iv,
      blobName: r.blob_name,
      ciphertextFingerprint: r.ciphertext_fingerprint,
      mode: r.mode,
      ownerAddress: r.owner_address,
    }
  }

  async resetTimelock(args: {
    dropId: string
    tlockShardA: string
    releaseRound: number
    triggerAt: number
    expectedOldRound: number
  }): Promise<boolean> {
    const { data, error } = await this.sb.rpc("reset_timelock", {
      p_drop_id: args.dropId,
      p_tlock: args.tlockShardA,
      p_round: args.releaseRound,
      p_trigger_ms: args.triggerAt,
      p_expected_old_round: args.expectedOldRound,
    })
    if (error) throw new Error(error.message)
    return data === true
  }

  async putWalletRegistration(dropId: string, recipientId: string, reg: WalletRegistration): Promise<boolean> {
    // Insert-once (not upsert): a PK conflict on (drop_id, recipient_id) means already registered.
    const { error } = await this.sb.from("wallet_registrations").insert({
      drop_id: dropId,
      recipient_id: recipientId,
      wallet_address: reg.walletAddress,
      wallet_chain: reg.walletChain,
      signature: reg.signature,
      public_key: reg.publicKey,
    })
    if (error) {
      if (error.code === "23505") return false // unique_violation → slot already registered
      throw new Error(error.message)
    }
    return true
  }

  async getWalletRegistration(dropId: string, recipientId: string): Promise<WalletRegistration | null> {
    const { data, error } = await this.sb
      .from("wallet_registrations")
      .select("*")
      .eq("drop_id", dropId)
      .eq("recipient_id", recipientId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return null
    const d = data as { wallet_address: string; wallet_chain: WalletChain; signature: string; public_key: string | null }
    return { walletAddress: d.wallet_address, walletChain: d.wallet_chain, signature: d.signature, publicKey: d.public_key }
  }

  async putSignerRegistration(dropId: string, signerId: string, reg: SignerRegistration): Promise<boolean> {
    // Insert-once (not upsert): a PK conflict on (drop_id, signer_id) means already registered.
    const { error } = await this.sb.from("signer_registrations").insert({
      drop_id: dropId,
      signer_id: signerId,
      wallet_address: reg.walletAddress,
      wallet_chain: reg.walletChain,
      enc_pubkey: reg.encPublicKey,
    })
    if (error) {
      if (error.code === "23505") return false // unique_violation → slot already registered
      throw new Error(error.message)
    }
    return true
  }

  async getSignerRegistration(dropId: string, signerId: string): Promise<SignerRegistration | null> {
    const { data, error } = await this.sb
      .from("signer_registrations")
      .select("*")
      .eq("drop_id", dropId)
      .eq("signer_id", signerId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return null
    const d = data as { wallet_address: string; wallet_chain: WalletChain; enc_pubkey: string }
    return { walletAddress: d.wallet_address, walletChain: d.wallet_chain, encPublicKey: d.enc_pubkey }
  }

  async putSignerKey(address: string, encPublicKey: string): Promise<void> {
    const { error } = await this.sb
      .from("signer_keys")
      .upsert({ address, enc_public_key: encPublicKey }, { onConflict: "address" })
    if (error) throw new Error(error.message)
  }

  async getSignerKey(address: string): Promise<string | null> {
    const { data, error } = await this.sb
      .from("signer_keys")
      .select("enc_public_key")
      .eq("address", address)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return data ? (data as { enc_public_key: string }).enc_public_key : null
  }

  async listSignersByDrop(dropId: string): Promise<SignerRow[]> {
    const { data, error } = await this.sb.from("signers").select("*").eq("drop_id", dropId)
    if (error) throw new Error(error.message)
    type Raw = {
      id: string
      drop_id: string
      name: string | null
      wallet_address: string
      wallet_chain: WalletChain
      bls_pubkey: string | null
      encrypted_email: string
      registered: boolean
      approved_at: number | null
    }
    return ((data ?? []) as Raw[]).map((d) => ({
      id: d.id,
      dropId: d.drop_id,
      name: d.name,
      walletAddress: d.wallet_address,
      walletChain: d.wallet_chain,
      blsPubkey: d.bls_pubkey,
      encryptedEmail: d.encrypted_email,
      registered: d.registered,
      approvedAt: d.approved_at,
    }))
  }

  async findReleasableTimelockDrops(currentRound: number): Promise<DropRow[]> {
    const { data, error } = await this.sb
      .from("drops")
      .select("*")
      .eq("mode", "timelock")
      .is("released_at", null)
      .lte("release_round", currentRound)
    if (error) throw new Error(error.message)
    return (data as RawDrop[]).map(mapDrop)
  }

  async findUnreleasedMultisigDrops(): Promise<DropRow[]> {
    const { data, error } = await this.sb
      .from("drops")
      .select("*")
      .eq("mode", "multisig")
      .is("released_at", null)
    if (error) throw new Error(error.message)
    return (data as RawDrop[]).map(mapDrop)
  }

  async markReleased(dropId: string): Promise<DropRow | null> {
    const { data, error } = await this.sb.rpc("mark_released", { p_drop_id: dropId })
    if (error) throw new Error(error.message)
    const rows = data as RawDrop[]
    return rows && rows.length > 0 ? mapDrop(rows[0]) : null
  }

  async getRecipientsWithSecrets(dropId: string): Promise<RecipientWithSecret[]> {
    const { data: recips, error } = await this.sb.from("recipients").select("*").eq("drop_id", dropId)
    if (error) throw new Error(error.message)
    const rows = (recips as RawRecipient[]).map(mapRecipient)
    if (rows.length === 0) return []

    const { data: secrets, error: e2 } = await this.sb
      .from("recipient_secrets")
      .select("recipient_id, secret")
      .in(
        "recipient_id",
        rows.map((r) => r.id),
      )
    if (e2) throw new Error(e2.message)
    const secretMap = new Map<string, string>()
    for (const s of (secrets as { recipient_id: string; secret: string }[]) ?? []) {
      secretMap.set(s.recipient_id, s.secret)
    }
    // LEFT JOIN: wallet recipients have no secret row → secret: null.
    return rows.map((r) => ({ ...r, secret: secretMap.get(r.id) ?? null }))
  }

  async deleteRecipientSecrets(recipientIds: string[]): Promise<void> {
    if (recipientIds.length === 0) return
    const { error } = await this.sb.from("recipient_secrets").delete().in("recipient_id", recipientIds)
    if (error) throw new Error(error.message)
  }

  async markNotificationsSent(dropId: string): Promise<void> {
    const { error } = await this.sb
      .from("drops")
      .update({ notifications_sent_at: new Date().toISOString() })
      .eq("id", dropId)
    if (error) throw new Error(error.message)
  }
}
