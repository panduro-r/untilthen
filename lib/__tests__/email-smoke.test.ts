// Live email smoke test via REAL Resend. Skipped unless RUN_EMAIL=1, so normal `npm test` never
// sends mail. Sends one of each template to TEST_EMAIL. Run:
//
//   RUN_EMAIL=1 npx vitest run lib/__tests__/email-smoke.test.ts
//
// Requires in .env.local (or the shell): RESEND_API_KEY, EMAIL_FROM, TEST_EMAIL.
// NOTE: with the Resend sandbox From (onboarding@resend.dev) mail is delivered ONLY to the email of
// the Resend account that owns the API key — so set TEST_EMAIL to that address until a domain is
// verified.

import { describe, it, expect, beforeAll } from "vitest"
import { readFileSync } from "node:fs"

const RUN = !!process.env.RUN_EMAIL

function loadEnvLocal() {
  try {
    const text = readFileSync(".env.local", "utf8")
    for (const line of text.split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
    }
  } catch {
    /* no .env.local — rely on the shell env */
  }
}

describe.skipIf(!RUN)("Resend email (live)", () => {
  let to: string

  beforeAll(() => {
    loadEnvLocal()
    if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY not set")
    if (!process.env.EMAIL_FROM) throw new Error("EMAIL_FROM not set (e.g. onboarding@resend.dev)")
    to = process.env.TEST_EMAIL ?? ""
    if (!to) throw new Error("TEST_EMAIL not set (where to send the test mail)")
  })

  it("sends a recipient heads-up email (arm time)", async () => {
    const { sendRecipientHeadsUpEmail } = await import("../email")
    const { id } = await sendRecipientHeadsUpEmail({
      to,
      recipientName: "Test Recipient",
      ownerName: "0x50cc…e5fc",
      mode: "timelock",
      triggerDate: new Date(Date.now() + 30 * 86_400_000),
    })
    console.log("[email-smoke] heads-up id:", id)
    expect(id).toBeTruthy()
  })

  it("sends a retrieval email (email recipient)", async () => {
    const { sendRetrievalEmail } = await import("../email")
    const { id } = await sendRetrievalEmail({
      to,
      recipientName: "Test Recipient",
      ownerName: "0x50cc…e5fc",
      triggerDate: new Date(),
      retrievalUrl: "https://untilthen.xyz/r/safe_test/rcpt_test",
      recipientType: "email",
    })
    console.log("[email-smoke] retrieval id:", id)
    expect(id).toBeTruthy()
  })

  it("sends a signer-registration email", async () => {
    const { sendSignerRegistrationEmail } = await import("../email")
    const { id } = await sendSignerRegistrationEmail({
      to,
      ownerName: "0x50cc…e5fc",
      registerUrl: "https://untilthen.xyz/register-signer/safe_test/signer_test",
    })
    console.log("[email-smoke] signer-register id:", id)
    expect(id).toBeTruthy()
  })

  it("sends a signer-approval-request email", async () => {
    const { sendSignerApprovalRequestEmail } = await import("../email")
    const { id } = await sendSignerApprovalRequestEmail({
      to,
      ownerName: "0x50cc…e5fc",
      approveUrl: "https://untilthen.xyz/approve/safe_test/signer_test",
    })
    console.log("[email-smoke] signer-approve id:", id)
    expect(id).toBeTruthy()
  })
})
