// POST /api/drops/[dropId]/delete — permanently delete a drop (owner only).
// Removes the DB record + cascaded recipients/signers/secrets. Authorized by the SIWA session (the
// owner proved wallet ownership at sign-in); we check the session address owns this drop. The Shelby
// blob is deleted separately by the owner's wallet (delete_blob) in the browser — owner-signed on
// chain — so this route only touches our database.

import { getDb } from "@/lib/db"
import { getSession } from "@/lib/session"
import { isSameOrigin } from "@/lib/origin"

export async function POST(
  req: Request,
  { params }: { params: Promise<{ dropId: string }> },
): Promise<Response> {
  const { dropId } = await params

  // Cookie-authorized + destructive → reject cross-origin (CSRF).
  if (!isSameOrigin(req)) return Response.json({ error: "Cross-origin request rejected" }, { status: 403 })

  const session = await getSession()
  if (!session) return Response.json({ error: "Not signed in." }, { status: 401 })

  const db = getDb()
  const drop = await db.getDrop(dropId)
  if (!drop) return Response.json({ ok: true }) // already gone — idempotent

  if (drop.ownerAddress.toLowerCase() !== session.address.toLowerCase()) {
    return Response.json({ error: "Unauthorized" }, { status: 403 })
  }

  await db.deleteDrop(dropId)
  return Response.json({ ok: true })
}
