// GET /api/cron/renew — blob-renewal notifier (scheduled). Real Shelby only.
//
// Shelbynet caps each blob's lifetime at 48h (extendable +48h per `increase_expiration_time`). A
// dead man's switch may lock a file for months, so this job runs on a sub-48h cadence and extends
// every still-needed blob back up to the cap. It keeps a blob alive while the drop is locked, while
// it's public (multi-use), and for the private 7-day retrieval window after release; then it lets it
// expire. Signs with the server uploader account (which owns the blobs). Protected by CRON_SECRET.
//
// DURABILITY CAVEAT: on a 48h-cap network, if this job stops for >48h every blob expires and the
// affected drops become permanently undecryptable. That is inherent to Shelbynet's dev limit and
// weakens the "operator can vanish" property — production durability needs a longer-retention tier
// (testnet/mainnet). Documented in DEPLOY.md.

import { getDb } from "@/lib/db"
import { isMockActive, renewalTargetExpirationMicros } from "@/lib/shelby"

export const runtime = "nodejs"

// Keep private blobs alive through the 7-day retrieval window (+1 day margin) after release.
const RETENTION_MS = 8 * 24 * 60 * 60 * 1000

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET
  const authz = req.headers.get("authorization")
  if (!secret || authz !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Nothing to renew with the mock (its blobs never expire).
  if (isMockActive()) {
    return Response.json({ skipped: "mock", renewed: 0, failed: 0 })
  }

  const { renewBlob } = await import("@/lib/shelby.server")
  const db = getDb()
  const drops = await db.listDropsForRenewal(RETENTION_MS)
  const newExpirationMicros = renewalTargetExpirationMicros()

  let renewed = 0
  let failed = 0
  for (const drop of drops) {
    try {
      await renewBlob({ blobName: drop.blobName, newExpirationMicros })
      renewed++
    } catch (err) {
      failed++
      console.error(`[shelby] renew failed for drop ${drop.id} (blob ${drop.blobName}):`, err)
    }
  }

  return Response.json({ candidates: drops.length, renewed, failed })
}
