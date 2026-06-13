// lib/email.ts — transactional email via Resend (SERVER-ONLY; uses RESEND_API_KEY).
//
// Privacy rule: the drop TITLE is never put in an email body. Plain-text fallback is always
// included (Resend uses it if HTML rendering fails). Sender reads as "Until Then" — we never have
// the owner's real name (we don't collect it), so emails refer to the owner as "someone you know"
// and keep the owner's wallet address only as a small footer attribution for verification.

import { Resend } from "resend"
import { render } from "@react-email/render"
import RecipientEmail from "./email-templates/recipient-email"
import RecipientWallet from "./email-templates/recipient-wallet"
import RecipientHeadsUp from "./email-templates/recipient-heads-up"
import SignerRegister from "./email-templates/signer-register"
import SignerApprove from "./email-templates/signer-approve"
import type { ReactElement } from "react"

const FROM_ADDRESS = process.env.EMAIL_FROM ?? "notifications@untilthen.xyz"
const REPLY_TO = process.env.EMAIL_REPLY_TO ?? "support@untilthen.xyz"
// Clean, recognizable sender — no wallet address (which looked like spam in the inbox).
const FROM_HEADER = `Until Then <${FROM_ADDRESS}>`

function client(): Resend {
  const key = process.env.RESEND_API_KEY
  if (!key) throw new Error("RESEND_API_KEY is not set")
  return new Resend(key)
}

async function send(args: {
  to: string
  subject: string
  node: ReactElement
  text: string
}): Promise<{ id: string }> {
  const html = await render(args.node)
  const { data, error } = await client().emails.send({
    from: FROM_HEADER,
    to: args.to,
    replyTo: REPLY_TO,
    subject: args.subject,
    html,
    text: args.text,
  })
  if (error) throw new Error(error.message)
  return { id: data?.id ?? "" }
}

// Sent at ARM time — informational only, NO secret/link. Lets the recipient know in advance so the
// retrieval email later isn't a surprise.
export async function sendRecipientHeadsUpEmail(args: {
  to: string
  recipientName?: string
  ownerName: string
  mode: "timelock" | "multisig"
  triggerDate?: Date | null
}): Promise<{ id: string }> {
  const node = RecipientHeadsUp({
    ownerName: args.ownerName,
    recipientName: args.recipientName,
    mode: args.mode,
    triggerDate: args.triggerDate ?? null,
  })
  const text =
    `Someone you know named you as a recipient on Until Then. Nothing to do right now — if it's ` +
    `released, you'll get a separate one-time link by email to open it. No one at Until Then can read ` +
    `its contents.`
  return send({ to: args.to, subject: "You've been named a recipient · Until Then", node, text })
}

export async function sendRetrievalEmail(args: {
  to: string
  recipientName?: string
  ownerName: string // owner wallet (short) — used only as footer attribution, never the From/subject
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
    `Someone you know left an encrypted file for you on Until Then.\n` +
    `Open it within 7 days (one-time link): ${args.retrievalUrl}\n` +
    (args.recipientType === "wallet" ? "You'll connect your registered wallet and sign to decrypt.\n" : "") +
    `No one at Until Then can read its contents.`
  return send({ to: args.to, subject: "An encrypted file is waiting for you · Until Then", node, text })
}

export async function sendRegistrationEmail(args: {
  to: string
  ownerName: string
  registrationUrl: string
}): Promise<{ id: string }> {
  // Wallet recipient pre-registration reuses the signer-register layout's structure via a link.
  const node = SignerRegister({ ownerName: args.ownerName, registerUrl: args.registrationUrl })
  const text = `Someone you know asked you to register your wallet for a safe on Until Then: ${args.registrationUrl}`
  return send({ to: args.to, subject: "Action needed: register your wallet · Until Then", node, text })
}

export async function sendSignerRegistrationEmail(args: {
  to: string
  ownerName: string
  registerUrl: string
}): Promise<{ id: string }> {
  const node = SignerRegister({ ownerName: args.ownerName, registerUrl: args.registerUrl })
  const text = `Someone you know asked you to be a signer on Until Then. Register here: ${args.registerUrl}`
  return send({ to: args.to, subject: "You've been named a signer · Until Then", node, text })
}

export async function sendSignerApprovalRequestEmail(args: {
  to: string
  ownerName: string
  approveUrl: string
}): Promise<{ id: string }> {
  const node = SignerApprove({ ownerName: args.ownerName, approveUrl: args.approveUrl })
  const text = `Your approval is requested on an Until Then release: ${args.approveUrl}`
  return send({ to: args.to, subject: "Your approval is requested · Until Then", node, text })
}
