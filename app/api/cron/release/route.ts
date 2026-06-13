// GET /api/cron/release — release notifier (scheduled). Confirms the ACTUAL release condition is
// met (drand round published / contract released), then notifies private recipients. It NEVER
// causes a decryption the cryptography wouldn't already permit — it only flips flags and emails.
// Protected by CRON_SECRET. Idempotent across concurrent runs (markReleased is atomic).

import { getDb, type DropRow, type RecipientWithSecret } from "@/lib/db"
import { latestRound } from "@/lib/timelock"
import { base64UrlEncode, formatAddress } from "@/lib/ids"
import { unb64 } from "@/lib/crypto"
import { decryptAtRest } from "@/lib/serverCrypto"
import { sendRetrievalEmail } from "@/lib/email"
import { AptosMoveContractClient } from "@/lib/contract.aptos"

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://untilthen.xyz"

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

  // 4. Multisig drops: released when the on-chain contract reports threshold met. Confidentiality
  //    never depends on this job — the contract releases, this just notifies + stamps for the UI.
  const contractAddress = process.env.NEXT_PUBLIC_DEADDROP_CONTRACT_ADDRESS
  if (contractAddress) {
    const noop = async () => {
      throw new Error("read-only client")
    }
    const client = new AptosMoveContractClient(contractAddress, noop)
    for (const drop of await db.findUnreleasedMultisigDrops()) {
      let onChainReleased = false
      try {
        onChainReleased = (await client.getReleaseMaterial(drop.id)).released
      } catch {
        continue // not on chain / read failed; try again next run
      }
      if (!onChainReleased) continue
      const stamped = await db.markReleased(drop.id)
      if (!stamped) continue
      released++
      if (drop.distribution === "public") continue
      emailsSent += await notifyPrivateRecipients(db, drop)
    }
  }

  return Response.json({ released, emailsSent }, { status: 200 })
}

// QStash schedules a one-shot release by POSTing here (forwarding the CRON_SECRET). Same logic as the
// scheduled GET — the auth + drand-round checks inside GET make it safe to call at any time.
export async function POST(req: Request): Promise<Response> {
  return GET(req)
}

async function notifyPrivateRecipients(
  db: ReturnType<typeof getDb>,
  drop: DropRow,
): Promise<number> {
  // LEFT JOIN semantics: wallet recipients have no secret row but must still be notified.
  const recipients = await db.getRecipientsWithSecrets(drop.id)
  // Only actually send when Resend is configured; otherwise count would-be sends (dev/tests).
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
        await sendRetrievalEmail({ to, ownerName, triggerDate, retrievalUrl, recipientType: r.type })
      }
      sent += 1
    }
  }
  await db.deleteRecipientSecrets(recipients.map((r) => r.id))
  await db.markNotificationsSent(drop.id)
  return sent
}

/** Email recipients get the secret in the URL fragment; wallet recipients get no fragment. */
function buildRetrievalUrl(dropId: string, r: RecipientWithSecret): string {
  const base = `${APP_URL}/r/${dropId}/${r.id}`
  if (r.type === "email" && r.secret) {
    return `${base}#${base64UrlEncode(unb64(r.secret))}`
  }
  return base
}
