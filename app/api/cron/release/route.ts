// GET /api/cron/release — release notifier (scheduled). Confirms the ACTUAL release condition is
// met (drand round published / contract released), then notifies private recipients. It NEVER
// causes a decryption the cryptography wouldn't already permit — it only flips flags and emails.
// Protected by CRON_SECRET. Idempotent across concurrent runs (markReleased is atomic).

import { getDb } from "@/lib/db"
import { latestRound } from "@/lib/timelock"
import { notifyReleasedDrop } from "@/lib/releaseNotify"
import { readonlyContractClient, type AptosMoveContractClient } from "@/lib/contract.aptos"
import { contractAddressOrNull, aptosNetworkFor, type AppNetwork } from "@/lib/networks"

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

    emailsSent += await notifyReleasedDrop(db, drop)
  }

  // 4. Multisig drops: released when the on-chain contract reports threshold met. Confidentiality
  //    never depends on this job — the contract releases, this just notifies + stamps for the UI.
  //    Each drop carries its own network (a single run may span shelbynet + testnet), so resolve the
  //    contract per drop, caching one read-only client per network.
  const clientsByNetwork = new Map<AppNetwork, AptosMoveContractClient>()
  for (const drop of await db.findUnnotifiedMultisigDrops()) {
    const contractAddress = contractAddressOrNull(drop.network)
    if (!contractAddress) continue
    let client = clientsByNetwork.get(drop.network)
    if (!client) {
      client = readonlyContractClient(contractAddress, aptosNetworkFor(drop.network))
      clientsByNetwork.set(drop.network, client)
    }
    let onChainReleased = false
    try {
      onChainReleased = (await client.getReleaseMaterial(drop.id)).released
    } catch {
      continue // not on chain / read failed; try again next run
    }
    if (!onChainReleased) continue
    // markReleased is idempotent — the dashboard reconcile may have already stamped released_at (for
    // the UI) WITHOUT emailing, so we still owe the notification. Don't skip on !stamped; just count
    // newly-stamped ones. The `notifications_sent_at` filter is what makes this run once.
    if (await db.markReleased(drop.id)) released++
    if (drop.distribution === "public") {
      await db.markNotificationsSent(drop.id) // public self-unlocks via /p; mark done so we don't re-scan
      continue
    }
    emailsSent += await notifyReleasedDrop(db, drop)
  }

  return Response.json({ released, emailsSent }, { status: 200 })
}

// QStash schedules a one-shot release by POSTing here (forwarding the CRON_SECRET). Same logic as the
// scheduled GET — the auth + drand-round checks inside GET make it safe to call at any time.
export async function POST(req: Request): Promise<Response> {
  return GET(req)
}
