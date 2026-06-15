// Owner-only view of a multi-sig safe's signers, for the safe page.
//   GET:  list signers with decrypted email + approval status (so the owner can copy/resend links).
//   POST { signerId }: re-send the approval-request email to one signer.
// Session-gated and owner-scoped: only the wallet that created the drop can read its signer emails.

import { z } from "zod"
import { getDb } from "@/lib/db"
import { getSession } from "@/lib/session"
import { isSameOrigin } from "@/lib/origin"
import { decryptAtRest } from "@/lib/serverCrypto"
import { sendSignerApprovalRequestEmail } from "@/lib/email"
import { formatAddress } from "@/lib/ids"

async function ownDrop(dropId: string, sessionAddress: string) {
  const drop = await getDb().getDrop(dropId)
  if (!drop || drop.ownerAddress.toLowerCase() !== sessionAddress.toLowerCase()) return null
  return drop
}

export async function GET(_req: Request, { params }: { params: Promise<{ dropId: string }> }): Promise<Response> {
  const { dropId } = await params
  const session = await getSession()
  if (!session) return Response.json({ error: "Sign in first." }, { status: 401 })
  if (!(await ownDrop(dropId, session.address))) return Response.json({ error: "Not found" }, { status: 404 })

  const rows = await getDb().listSignersByDrop(dropId)
  const signers = await Promise.all(
    rows.map(async (s) => ({
      id: s.id,
      walletAddress: s.walletAddress,
      email: await decryptAtRest(s.encryptedEmail).catch(() => null),
      approved: s.approvedAt != null,
    })),
  )
  return Response.json({ signers })
}

const postSchema = z.object({ signerId: z.string().min(1) })

export async function POST(req: Request, { params }: { params: Promise<{ dropId: string }> }): Promise<Response> {
  const { dropId } = await params
  if (!isSameOrigin(req)) return Response.json({ error: "Bad origin" }, { status: 403 })
  const session = await getSession()
  if (!session) return Response.json({ error: "Sign in first." }, { status: 401 })
  if (!process.env.RESEND_API_KEY) return Response.json({ error: "Email isn't configured." }, { status: 503 })
  if (!(await ownDrop(dropId, session.address))) return Response.json({ error: "Not found" }, { status: 404 })

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const parsed = postSchema.safeParse(raw)
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 })

  const signer = (await getDb().listSignersByDrop(dropId)).find((s) => s.id === parsed.data.signerId)
  if (!signer) return Response.json({ error: "Signer not found" }, { status: 404 })
  const email = await decryptAtRest(signer.encryptedEmail).catch(() => null)
  if (!email) return Response.json({ error: "No email on file for that signer." }, { status: 400 })

  const base = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin
  try {
    await sendSignerApprovalRequestEmail({
      to: email,
      ownerName: formatAddress(session.address),
      approveUrl: `${base}/approve/${dropId}/${signer.id}`,
    })
  } catch (e) {
    console.error("[signers] approval resend failed:", e)
    return Response.json({ error: "Couldn't send the email. Please try again." }, { status: 502 })
  }
  return Response.json({ ok: true })
}
