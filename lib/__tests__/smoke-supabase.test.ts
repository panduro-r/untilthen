// Live smoke test against a REAL Supabase project. Skipped unless RUN_SMOKE=1, so the normal
// `npm test` never touches the network/DB. Run:  RUN_SMOKE=1 npx vitest run lib/__tests__/smoke-supabase.test.ts
//
// Exercises the SupabaseDb adapter + the atomic SQL functions + RLS-bypass (service role) end to end:
// create → read → atomic burn (single-use) → reset (optimistic concurrency) → registrations, then
// cleans up its rows.

import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync } from "node:fs"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import type { Db, NewDropInput } from "../db"

const RUN = !!process.env.RUN_SMOKE

function loadEnvLocal() {
  const text = readFileSync(".env.local", "utf8")
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}

const suffix = Date.now().toString(36)
const id = (p: string) => `${p}_smoke_${suffix}`
const rcptId = (dropId: string) => `${dropId}_r` // unique per drop

function privateTimelock(dropId: string): NewDropInput {
  return {
    id: dropId,
    ownerAddress: "0xsmokeowner",
    network: "shelbynet",
    encryptedTitle: "encTitle",
    blobName: `deaddrop_${dropId}`,
    iv: "aXY=",
    ciphertextFingerprint: "fp",
    mode: "timelock",
    distribution: "private",
    tlockShardA: "tlock-ct",
    releaseRound: 1000,
    contractRef: null,
    ibeHeader: null,
    ownerShardA: "ownerwrap",
    ownerKeyWrapped: null,
    checkInIntervalDays: 30,
    gracePeriodDays: 7,
    triggerAt: Date.now(),
    expirationMicros: Date.now() * 1000,
    recipients: [
      {
        id: rcptId(dropId),
        dropId,
        name: "Alice",
        type: "email",
        encryptedEmail: "encEmail",
        encryptedBackupEmail: "encBackup",
        walletAddress: null,
        walletChain: null,
        wrappedShardB: "wrapB",
      },
    ],
    recipientSecrets: [{ recipientId: rcptId(dropId), secret: "c2VjcmV0" }],
    signers: [],
  }
}

describe.skipIf(!RUN)("live Supabase smoke", () => {
  let db: Db
  let admin: SupabaseClient

  beforeAll(async () => {
    loadEnvLocal()
    const { getDb } = await import("../db")
    db = getDb()
    admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    )
  })

  afterAll(async () => {
    // Cascade deletes recipients + secrets; registrations have no FK.
    await admin.from("drops").delete().in("id", [id("dropA"), id("dropB")])
    await admin.from("wallet_registrations").delete().eq("drop_id", id("dropR"))
  })

  it("creates a drop and reads it back (atomic create_drop_tx)", async () => {
    await db.createDrop(privateTimelock(id("dropA")))
    const d = await db.getDrop(id("dropA"))
    expect(d).not.toBeNull()
    expect(d!.mode).toBe("timelock")
    expect(d!.encryptedTitle).toBe("encTitle")
    expect(d!.releaseRound).toBe(1000)
    expect(d!.releasedAt).toBeNull()
  })

  it("atomic burn: 410-equivalent before release, succeeds once after, then single-use", async () => {
    const before = await db.burnRecipient(id("dropA"), rcptId(id("dropA")), 7 * 86_400_000)
    expect(before).toBeNull() // not released yet

    const stamped = await db.markReleased(id("dropA"))
    expect(stamped).not.toBeNull()
    expect(await db.markReleased(id("dropA"))).toBeNull() // idempotent

    const first = await db.burnRecipient(id("dropA"), rcptId(id("dropA")), 7 * 86_400_000)
    expect(first).not.toBeNull()
    expect(first!.tlockShardA).toBe("tlock-ct")
    expect(first!.wrappedShardB).toBe("wrapB")

    const second = await db.burnRecipient(id("dropA"), rcptId(id("dropA")), 7 * 86_400_000)
    expect(second).toBeNull() // burned — single use enforced in SQL
  })

  it("optimistic-concurrency reset: matches old round once, stale repeat fails", async () => {
    await db.createDrop(privateTimelock(id("dropB")))
    const ok = await db.resetTimelock({
      dropId: id("dropB"),
      tlockShardA: "new-ct",
      releaseRound: 5000,
      triggerAt: Date.now() + 86_400_000,
      expectedOldRound: 1000,
    })
    expect(ok).toBe(true)
    expect((await db.getDrop(id("dropB")))!.releaseRound).toBe(5000)

    const stale = await db.resetTimelock({
      dropId: id("dropB"),
      tlockShardA: "newer-ct",
      releaseRound: 9000,
      triggerAt: Date.now(),
      expectedOldRound: 1000, // stale
    })
    expect(stale).toBe(false)
  })

  it("wallet registration round-trips", async () => {
    await db.putWalletRegistration(id("dropR"), "rcpt_x", {
      walletAddress: "0xabc",
      walletChain: "aptos",
      signature: "deadbeef",
      publicKey: "pub",
    })
    const reg = await db.getWalletRegistration(id("dropR"), "rcpt_x")
    expect(reg).not.toBeNull()
    expect(reg!.signature).toBe("deadbeef")
  })
})
