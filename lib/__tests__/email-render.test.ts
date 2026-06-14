// Renders every email template (no network) so a template that throws at render — e.g. an invalid
// Intl.DateTimeFormat option combo — is caught by normal `npm test`, not silently in production.

import { describe, it, expect } from "vitest"
import { render } from "@react-email/render"
import RecipientEmail from "../email-templates/recipient-email"
import RecipientWallet from "../email-templates/recipient-wallet"
import RecipientHeadsUp from "../email-templates/recipient-heads-up"
import SignerRegister from "../email-templates/signer-register"
import SignerApprove from "../email-templates/signer-approve"

const owner = "0x50cc…e5fc"
const date = new Date("2026-07-17T21:45:00Z")

describe("email templates render", () => {
  it("retrieval (email)", async () => {
    const html = await render(
      RecipientEmail({ ownerName: owner, recipientName: "Test", triggerDate: date, retrievalUrl: "https://untilthen.xyz/r/a/b#x" }),
    )
    expect(html).toContain("Until Then")
    expect(html).toContain("UTC")
  })

  it("retrieval (wallet)", async () => {
    const html = await render(RecipientWallet({ ownerName: owner, triggerDate: date, retrievalUrl: "https://untilthen.xyz/r/a/b" }))
    expect(html).toContain("Until Then")
    expect(html).toContain("UTC")
  })

  it("recipient heads-up (with date)", async () => {
    const html = await render(RecipientHeadsUp({ ownerName: owner, recipientName: "Test", mode: "timelock", triggerDate: date }))
    expect(html).toContain("Until Then")
    expect(html).toContain("UTC")
  })

  it("recipient heads-up (no date / multisig)", async () => {
    const html = await render(RecipientHeadsUp({ ownerName: owner, mode: "multisig", triggerDate: null }))
    expect(html).toContain("Until Then")
  })

  it("signer register", async () => {
    const html = await render(SignerRegister({ ownerName: owner, registerUrl: "https://untilthen.xyz/register-signer/a/b" }))
    expect(html).toContain("signer")
  })

  it("signer approve", async () => {
    const html = await render(SignerApprove({ ownerName: owner, approveUrl: "https://untilthen.xyz/approve/a/b" }))
    expect(html.toLowerCase()).toContain("approv")
  })
})
