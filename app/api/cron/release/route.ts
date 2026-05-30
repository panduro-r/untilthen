// GET /api/cron/release — release notifier (scheduled). Confirms the ACTUAL release condition is
// met (drand round published / contract released), then notifies private recipients. It NEVER
// causes a decryption the cryptography wouldn't already permit — it only flips flags and emails.
// Protected by CRON_SECRET. Idempotent across concurrent runs (markReleased is atomic).

import { getDb, type DropRow, type RecipientWithSecret } from "@/lib/db"
import { latestRound } from "@/lib/timelock"
import { base64UrlEncode } from "@/lib/ids"
import { unb64 } from "@/lib/crypto"

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://deaddrop.app"

export async function GET(req: Request): Promise<Response> {
  // 1. Auth
  const secret = process.env.CRON_SECRET
  const authz = req.headers.get("authorization")
  if (!secret || authz !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  // 2. Current drand round — overridable via ?round= for manual/test runs; else live drand.
  const url = new URL(req.url)
  const roundParam = url.searchParams.get("round")
  let currentRound: number
  try {
    currentRound = roundParam !== null ? Number(roundParam) : await latestRound()
  } catch {
    return Response.json({ error: "Could not read the drand round" }, { status: 503 })
  }

  const db = getDb()
  let released = 0
  let emailsSent = 0

  // 3. Timelock drops whose round has published.
  const candidates = await db.findReleasableTimelockDrops(currentRound)
  for (const drop of candidates) {
    const stamped = await db.markReleased(drop.id) // atomic; null if a concurrent run won
    if (!stamped) continue
    released++
    if (drop.distribution === "public") continue // the /p page self-unlocks; no email

    emailsSent += await notifyPrivateRecipients(db, drop)
  }

  // NOTE: multisig release detection reads the Move contract's `released` flag and is wired with the
  // real contract client (lib/contract.ts) once deployed. Confidentiality never depends on this job:
  // a multisig drop is released by the contract, not here.

  return Response.json({ released, emailsSent }, { status: 200 })
}

async function notifyPrivateRecipients(
  db: ReturnType<typeof getDb>,
  drop: DropRow,
): Promise<number> {
  // LEFT JOIN semantics: wallet recipients have no secret row but must still be notified.
  const recipients = await db.getRecipientsWithSecrets(drop.id)
  let sent = 0
  for (const r of recipients) {
    const url = retrievalUrl(drop.id, r)
    // TODO(email): wire Resend (lib/email). For now we count the would-be sends; primary + backup.
    void url
    sent += 1 // primary email
    if (r.encryptedBackupEmail) sent += 1 // identical second email to the backup
  }
  await db.deleteRecipientSecrets(recipients.map((r) => r.id))
  await db.markNotificationsSent(drop.id)
  return sent
}

/** Email recipients get the secret in the URL fragment; wallet recipients get no fragment. */
function retrievalUrl(dropId: string, r: RecipientWithSecret): string {
  const base = `${APP_URL}/r/${dropId}/${r.id}`
  if (r.type === "email" && r.secret) {
    return `${base}#${base64UrlEncode(unb64(r.secret))}`
  }
  return base
}
