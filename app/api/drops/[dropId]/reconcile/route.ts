// POST /api/drops/[dropId]/reconcile — prompt multi-sig release notifier. The approve page calls this
// after a signer's approval (and on load when the safe is already released) so the recipient's one-time
// retrieval-link email fires immediately, rather than waiting for the daily cron backstop.
//
// Safe to call by anyone same-origin: it only sends the notification the on-chain release ALREADY
// permits (it re-checks the contract), it returns no secret or link, and it's idempotent via
// notifications_sent_at. No owner session needed — signers aren't the owner.

import { isSameOrigin } from "@/lib/origin"
import { notifyMultisigReleaseIfDue } from "@/lib/multisigRelease"

export async function POST(
  req: Request,
  { params }: { params: Promise<{ dropId: string }> },
): Promise<Response> {
  if (!isSameOrigin(req)) return Response.json({ error: "Bad origin" }, { status: 403 })
  const { dropId } = await params
  try {
    const { released, emailsSent } = await notifyMultisigReleaseIfDue(dropId)
    return Response.json({ released, emailsSent })
  } catch (e) {
    console.error("[reconcile] failed:", e)
    return Response.json({ error: "Couldn't reconcile the release." }, { status: 500 })
  }
}
