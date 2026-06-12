// Email a multisig signer their registration link. Session + same-origin authed (the owner is signed
// in via SIWA); the owner attribution comes from the session, not the client. Sends a registration
// link the signer opens to register their approval key — the link is not a secret on its own.

import { z } from "zod"
import { getSession } from "@/lib/session"
import { isSameOrigin } from "@/lib/origin"
import { sendSignerRegistrationEmail } from "@/lib/email"

const schema = z.object({
  dropId: z.string().min(1),
  signerId: z.string().min(1),
  email: z.string().email(),
})

export async function POST(req: Request): Promise<Response> {
  if (!isSameOrigin(req)) return Response.json({ error: "Bad origin" }, { status: 403 })
  const session = await getSession()
  if (!session) return Response.json({ error: "Sign in first." }, { status: 401 })
  if (!process.env.RESEND_API_KEY) return Response.json({ error: "Email isn't configured." }, { status: 503 })

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 })
  const { dropId, signerId, email } = parsed.data

  const owner = session.address
  const ownerShort = `${owner.slice(0, 6)}…${owner.slice(-4)}`
  const base = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin
  const registerUrl = `${base}/register-signer/${dropId}/${signerId}`

  try {
    await sendSignerRegistrationEmail({ to: email, ownerName: ownerShort, registerUrl })
  } catch (e) {
    console.error("[notify-signer] send failed:", e)
    return Response.json({ error: "Couldn't send the email. Please try again." }, { status: 502 })
  }
  return Response.json({ ok: true })
}
