// The ?round= override on /api/cron/release is a test/dev affordance. It feeds
// findReleasableTimelockDrops' `release_round <= currentRound`, so honouring it in production would
// let anyone holding CRON_SECRET (a set that includes Upstash, which we forward it to) release EVERY
// unreleased time-lock safe with one request. These tests pin both directions of the guard.

process.env.EMAIL_ENC_KEY = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"
process.env.CRON_SECRET = "test-cron-secret"

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest"

// Keep the live drand beacon out of the test. Round 1 is below the seeded drop's release round, so a
// production run (which ignores ?round=) must release nothing.
vi.mock("@/lib/timelock", () => ({ latestRound: vi.fn().mockResolvedValue(1) }))

import { __setDb, type NewDropInput } from "@/lib/db"
import { MockDb } from "@/lib/db.mock"
import { GET as cron } from "@/app/api/cron/release/route"

const HUGE_ROUND = 99_999_999
const req = () =>
  new Request(`http://t/api/cron/release?round=${HUGE_ROUND}`, {
    headers: { authorization: "Bearer test-cron-secret" },
  })

function timelockDrop(id: string): NewDropInput {
  return {
    id,
    ownerAddress: "0xowner",
    network: "shelbynet",
    encryptedTitle: "t",
    blobName: `deaddrop_${id}`,
    iv: "aXY=",
    ciphertextFingerprint: "fp",
    mode: "timelock",
    distribution: "private",
    tlockShardA: "ct",
    releaseRound: 1000, // far above the mocked live round (1)
    contractRef: null,
    ibeHeader: null,
    ownerShardA: "owner",
    ownerKeyWrapped: null,
    checkInIntervalDays: 30,
    gracePeriodDays: 7,
    triggerAt: Date.now(),
    expirationMicros: Date.now() * 1000,
    recipients: [
      {
        id: "rcpt_g1",
        dropId: id,
        name: null,
        type: "email",
        encryptedEmail: "enc",
        encryptedBackupEmail: null,
        walletAddress: null,
        walletChain: null,
        wrappedShardB: "w",
      },
    ],
    recipientSecrets: [{ recipientId: "rcpt_g1", secret: "c2VjcmV0" }],
    signers: [],
  }
}

// process.env.NODE_ENV is readonly in the Node types; write through a cast.
const setEnv = (v: string) => {
  ;(process.env as Record<string, string>).NODE_ENV = v
}

let db: MockDb
let originalEnv: string | undefined
beforeEach(() => {
  db = new MockDb()
  __setDb(db)
  originalEnv = process.env.NODE_ENV
})
afterEach(() => setEnv(originalEnv ?? "test"))

describe("cron release: ?round= override guard", () => {
  it("IGNORES ?round= in production — a huge round can't force-release every safe", async () => {
    await db.createDrop(timelockDrop("drop_g1"))
    setEnv("production")

    const res = await cron(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ released: 0, emailsSent: 0 })

    // untouched: not released, and the one-time secret is intact
    expect((await db.getDrop("drop_g1"))!.releasedAt).toBeNull()
    expect(db.__hasSecret("rcpt_g1")).toBe(true)
  })

  it("still honours ?round= outside production (tests/local runs)", async () => {
    await db.createDrop(timelockDrop("drop_g2"))
    setEnv("test")

    const res = await cron(req())
    expect(res.status).toBe(200)
    expect((await res.json()).released).toBe(1)
    expect((await db.getDrop("drop_g2"))!.releasedAt).not.toBeNull()
  })
})
