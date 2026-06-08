// lib/email.ts — transactional email via Resend (SERVER-ONLY; uses RESEND_API_KEY).
//
// Privacy rule: the drop TITLE is never put in an email body. Plain-text fallback is always
// included (Resend uses it if HTML rendering fails). Sender reads as "<owner> via Until Then".

import { Resend } from "resend"
import { render } from "@react-email/render"
import RecipientEmail from "./email-templates/recipient-email"
import RecipientWallet from "./email-templates/recipient-wallet"
import SignerRegister from "./email-templates/signer-register"
import SignerApprove from "./email-templates/signer-approve"
import type { ReactElement } from "react"

const FROM_ADDRESS = process.env.EMAIL_FROM ?? "notifications@untilthen.xyz"
const REPLY_TO = process.env.EMAIL_REPLY_TO ?? "support@untilthen.xyz"

function client(): Resend {
  const key = process.env.RESEND_API_KEY
  if (!key) throw new Error("RESEND_API_KEY is not set")
  return new Resend(key)
}

function fromHeader(ownerName: string): string {
  // Display name reads naturally in the inbox; address must be on a Resend-verified domain.
  return `${ownerName} via Until Then <${FROM_ADDRESS}>`
}

async function send(args: {
  to: string
  ownerName: string
  subject: string
  node: ReactElement
  text: string
}): Promise<{ id: string }> {
  const html = await render(args.node)
  const { data, error } = await client().emails.send({
    from: fromHeader(args.ownerName),
    to: args.to,
    replyTo: REPLY_TO,
    subject: args.subject,
    html,
    text: args.text,
  })
  if (error) throw new Error(error.message)
  return { id: data?.id ?? "" }
}

export async function sendRetrievalEmail(args: {
  to: string
  recipientName?: string
  ownerName: string
  dropTitle?: string // intentionally NOT used — privacy
  triggerDate: Date
  retrievalUrl: string
  recipientType: "email" | "wallet"
}): Promise<{ id: string }> {
  const common = {
    ownerName: args.ownerName,
    recipientName: args.recipientName,
    triggerDate: args.triggerDate,
    retrievalUrl: args.retrievalUrl,
  }
  const node = args.recipientType === "wallet" ? RecipientWallet(common) : RecipientEmail(common)
  const text =
    `${args.ownerName} left an encrypted file for you on Until Then.\n` +
    `Open it within 7 days (one-time link): ${args.retrievalUrl}\n` +
    (args.recipientType === "wallet" ? "You'll connect your registered wallet and sign to decrypt.\n" : "") +
    `No one at Until Then can read its contents.`
  return send({ to: args.to, ownerName: args.ownerName, subject: `${args.ownerName} left something for you`, node, text })
}

export async function sendRegistrationEmail(args: {
  to: string
  ownerName: string
  registrationUrl: string
}): Promise<{ id: string }> {
  // Wallet recipient pre-registration reuses the signer-register layout's structure via a link.
  const node = SignerRegister({ ownerName: args.ownerName, registerUrl: args.registrationUrl })
  const text = `${args.ownerName} asked you to register your wallet for a drop on Until Then: ${args.registrationUrl}`
  return send({ to: args.to, ownerName: args.ownerName, subject: `${args.ownerName} needs you to register a wallet`, node, text })
}

export async function sendSignerRegistrationEmail(args: {
  to: string
  ownerName: string
  registerUrl: string
}): Promise<{ id: string }> {
  const node = SignerRegister({ ownerName: args.ownerName, registerUrl: args.registerUrl })
  const text = `${args.ownerName} asked you to be a signer on Until Then. Register here: ${args.registerUrl}`
  return send({ to: args.to, ownerName: args.ownerName, subject: `${args.ownerName} asked you to be a signer`, node, text })
}

export async function sendSignerApprovalRequestEmail(args: {
  to: string
  ownerName: string
  approveUrl: string
}): Promise<{ id: string }> {
  const node = SignerApprove({ ownerName: args.ownerName, approveUrl: args.approveUrl })
  const text = `Your approval is requested on an Until Then release set up by ${args.ownerName}: ${args.approveUrl}`
  return send({ to: args.to, ownerName: args.ownerName, subject: `Approval requested on an Until Then release`, node, text })
}
