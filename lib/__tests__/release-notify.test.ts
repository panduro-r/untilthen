// notifyMultisigReleaseIfDue — the prompt multi-sig notifier. This is exactly where the last two
// release-email bugs lived (cron query filter, missing prompt trigger), so lock the behavior down:
// released+unnotified emails once, already-notified is a no-op, public marks-done-no-email, and an
// env without email (RESEND unset) never destroys the retrieval secret or marks the drop notified.
//
// EMAIL_ENC_KEY must be set before serverCrypto loads. The email module is mocked so no network hits.
process.env.EMAIL_ENC_KEY = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"

import { vi, describe, it, expect, beforeEach } from "vitest"

vi.mock("@/lib/email", () => ({ sendRetrievalEmail: vi.fn().mockResolvedValue({ id: "test-email" }) }))

import { __setDb, type NewDropInput } from "@/lib/db"
import { MockDb } from "@/lib/db.mock"
import { encryptAtRest } from "@/lib/serverCrypto"
import { sendRetrievalEmail } from "@/lib/email"
import { notifyMultisigReleaseIfDue } from "@/lib/multisigRelease"

const sendMock = vi.mocked(sendRetrievalEmail)

// Seed a multi-sig drop already stamped released_at (the dashboard-reconcile scenario), optionally
// already notified or public.
async function seedReleasedMultisig(
  db: MockDb,
  id: string,
  opts: { distribution?: "private" | "public"; notified?: boolean } = {},
): Promise<void> {
  const distribution = opts.distribution ?? "private"
  const encryptedEmail = await encryptAtRest("alice@example.com")
  const input: NewDropInput = {
    id,
    ownerAddress: "0xowner",
    network: "shelbynet",
    encryptedTitle: "t",
    blobName: `deaddrop_${id}`,
    iv: "aXY=",
    ciphertextFingerprint: "fp",
    mode: "multisig",
    distribution,
    tlockShardA: null,
    releaseRound: null,
    contractRef: "ref",
    ibeHeader: "hdr",
    ownerShardA: null,
    ownerKeyWrapped: null,
    checkInIntervalDays: null,
    gracePeriodDays: null,
    triggerAt: null,
    expirationMicros: 0,
    recipients:
      distribution === "public"
        ? []
        : [
            {
              id: "rcpt_1",
              dropId: id,
              type: "email",
              name: null,
              encryptedEmail,
              encryptedBackupEmail: null,
              walletAddress: null,
              walletChain: null,
              wrappedShardB: "d3JhcA==",
            },
          ],
    recipientSecrets: distribution === "public" ? [] : [{ recipientId: "rcpt_1", secret: "c2VjcmV0" }],
    signers: [],
  }
  await db.createDrop(input)
  await db.markReleased(id) // stamp released_at, as the dashboard reconcile does — WITHOUT emailing
  if (opts.notified) await db.markNotificationsSent(id)
}

let db: MockDb
beforeEach(() => {
  db = new MockDb()
  __setDb(db)
  process.env.RESEND_API_KEY = "test" // canSend = true by default
  vi.clearAllMocks()
})

describe("notifyMultisigReleaseIfDue", () => {
  it("released + unnotified private → sends once, marks notified, deletes the one-time secret", async () => {
    await seedReleasedMultisig(db, "safe_1")
    const r = await notifyMultisigReleaseIfDue("safe_1")
    expect(r).toEqual({ released: true, emailsSent: 1 })
    expect(sendMock).toHaveBeenCalledTimes(1)
    expect(sendMock.mock.calls[0][0]).toMatchObject({ mode: "multisig", recipientType: "email" })
    expect((await db.getDrop("safe_1"))!.notificationsSentAt).not.toBeNull()
    expect(db.__hasSecret("rcpt_1")).toBe(false)
  })

  it("already notified → no-op (never emails twice)", async () => {
    await seedReleasedMultisig(db, "safe_2", { notified: true })
    const r = await notifyMultisigReleaseIfDue("safe_2")
    expect(r).toEqual({ released: true, emailsSent: 0 })
    expect(sendMock).not.toHaveBeenCalled()
  })

  it("public → marks done, no email (the /p page self-unlocks)", async () => {
    await seedReleasedMultisig(db, "safe_3", { distribution: "public" })
    const r = await notifyMultisigReleaseIfDue("safe_3")
    expect(r).toEqual({ released: true, emailsSent: 0 })
    expect(sendMock).not.toHaveBeenCalled()
    expect((await db.getDrop("safe_3"))!.notificationsSentAt).not.toBeNull()
  })

  it("email off (RESEND unset) → preserves the secret and does NOT mark notified", async () => {
    delete process.env.RESEND_API_KEY
    await seedReleasedMultisig(db, "safe_4")
    const r = await notifyMultisigReleaseIfDue("safe_4")
    expect(r.released).toBe(true)
    expect(sendMock).not.toHaveBeenCalled()
    expect(db.__hasSecret("rcpt_1")).toBe(true) // retrieval material intact
    expect((await db.getDrop("safe_4"))!.notificationsSentAt).toBeNull() // still owed a notification
  })

  it("ignores missing or non-multisig drops", async () => {
    expect(await notifyMultisigReleaseIfDue("does_not_exist")).toEqual({ released: false, emailsSent: 0 })
  })
})
