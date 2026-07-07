import "server-only"

// Shared release notifier: emails a released drop's private recipients their one-time retrieval link.
// Used by the daily cron AND by the prompt (approve-triggered / dashboard) multi-sig reconcile, so the
// email fires as soon as the threshold is met rather than waiting for the 9am backstop. Idempotent via
// notifications_sent_at (callers filter on it) — a drop is emailed exactly once.

import { getDb, type DropRow, type RecipientWithSecret } from "@/lib/db"
import { base64UrlEncode, formatAddress } from "@/lib/ids"
import { unb64 } from "@/lib/crypto"
import { decryptAtRest } from "@/lib/serverCrypto"
import { sendRetrievalEmail } from "@/lib/email"

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://untilthen.xyz"

/** Email recipients get the secret in the URL fragment; wallet recipients get no fragment. */
function buildRetrievalUrl(dropId: string, r: RecipientWithSecret): string {
  const base = `${APP_URL}/r/${dropId}/${r.id}`
  if (r.type === "email" && r.secret) {
    return `${base}#${base64UrlEncode(unb64(r.secret))}`
  }
  return base
}

/**
 * Notify a released drop's private recipients and stamp notifications_sent_at. Returns the number of
 * emails sent (or would-be sends when Resend isn't configured, for dev/tests). Assumes the caller has
 * confirmed the drop is actually released.
 */
export async function notifyReleasedDrop(db: ReturnType<typeof getDb>, drop: DropRow): Promise<number> {
  // LEFT JOIN semantics: wallet recipients have no secret row but must still be notified.
  const recipients = await db.getRecipientsWithSecrets(drop.id)
  const canSend = !!process.env.RESEND_API_KEY
  // We don't store the owner's name (metadata minimization), so present a shortened address.
  const ownerName = formatAddress(drop.ownerAddress)
  const triggerDate = drop.triggerAt ? new Date(drop.triggerAt) : new Date()

  let sent = 0
  for (const r of recipients) {
    const retrievalUrl = buildRetrievalUrl(drop.id, r)
    const targets: string[] = []
    if (canSend) {
      targets.push(await decryptAtRest(r.encryptedEmail))
      if (r.encryptedBackupEmail) targets.push(await decryptAtRest(r.encryptedBackupEmail))
    } else {
      targets.push("count-only")
      if (r.encryptedBackupEmail) targets.push("count-only")
    }
    for (const to of targets) {
      if (canSend) {
        await sendRetrievalEmail({ to, ownerName, mode: drop.mode, triggerDate, retrievalUrl, recipientType: r.type })
      }
      sent += 1
    }
  }
  await db.deleteRecipientSecrets(recipients.map((r) => r.id))
  await db.markNotificationsSent(drop.id)
  return sent
}
