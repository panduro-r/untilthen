// POST /api/drops/[dropId]/reconcile — prompt multi-sig release notifier. The approve page calls this
// after a signer's approval (and on load when the safe is already released) so the recipient's one-time
// retrieval-link email fires immediately, rather than waiting for the daily cron backstop.
//
// Safe to call by anyone: it only sends the notification the on-chain release ALREADY permits (it
// re-checks the contract), it returns no secret or link, and it's idempotent via
// notifications_sent_at. No owner session needed — signers aren't the owner.
//
// The response is deliberately OPAQUE: always 204, whatever happened. isSameOrigin only checks the
// Origin header, which any non-browser client can set (it's CSRF defense-in-depth, not auth), so this
// route is effectively public. Returning {released, emailsSent} made it an oracle: anyone holding a
// dropId could probe whether a safe had fired — for a dead man's switch that discloses that the owner
// stopped checking in — and read the recipient count off emailsSent. That contradicted the uniform
// 410 that /api/retrieve returns precisely so a prober can't distinguish cases. Errors are opaque for
// the same reason; the real cause goes to the server log. The only caller is fire-and-forget.

import { isSameOrigin } from "@/lib/origin"
import { notifyMultisigReleaseIfDue } from "@/lib/multisigRelease"

export async function POST(
  req: Request,
  { params }: { params: Promise<{ dropId: string }> },
): Promise<Response> {
  if (!isSameOrigin(req)) return Response.json({ error: "Bad origin" }, { status: 403 })
  const { dropId } = await params
  try {
    await notifyMultisigReleaseIfDue(dropId)
  } catch (e) {
    console.error("[reconcile] failed:", e)
  }
  return new Response(null, { status: 204 })
}
