import "server-only"
import { getDb } from "@/lib/db"
import { readonlyContractClient } from "@/lib/contract.aptos"
import { contractAddressOrNull, aptosNetworkFor } from "@/lib/networks"
import { notifyReleasedDrop } from "@/lib/releaseNotify"

/**
 * Mirror an on-chain multi-sig release into the DB (set released_at) so server-backed surfaces — the
 * owner dashboard and the private-retrieval burn — don't have to wait for the daily cron. A multi-sig
 * safe releases the moment signers approve on-chain; this just catches the DB up.
 *
 * Idempotent and safe: it only stamps when the contract confirms `released`, so it can never force a
 * release. Returns whether the safe is released.
 */
export async function syncMultisigRelease(dropId: string): Promise<boolean> {
  const drop = await getDb().getDrop(dropId)
  if (!drop || drop.mode !== "multisig") return !!drop?.releasedAt
  if (drop.releasedAt) return true
  const contractAddress = contractAddressOrNull(drop.network)
  if (!contractAddress) return false
  const client = readonlyContractClient(contractAddress, aptosNetworkFor(drop.network))
  const { released } = await client.getReleaseMaterial(dropId)
  if (released) await getDb().markReleased(dropId)
  return released
}

/**
 * Prompt multi-sig notifier: confirm the on-chain release, then email the recipients their one-time
 * link RIGHT AWAY (once), instead of waiting for the daily cron. Called from the approve flow so the
 * email fires the moment the threshold is met. Idempotent (guarded by notifications_sent_at); it only
 * sends the notification the on-chain release already permits, so it's safe to trigger same-origin.
 */
export async function notifyMultisigReleaseIfDue(
  dropId: string,
): Promise<{ released: boolean; emailsSent: number }> {
  const db = getDb()
  const drop = await db.getDrop(dropId)
  if (!drop || drop.mode !== "multisig") return { released: !!drop?.releasedAt, emailsSent: 0 }

  // Confirm release: trust an existing stamp, else read the chain and stamp it.
  let released = !!drop.releasedAt
  if (!released) {
    const contractAddress = contractAddressOrNull(drop.network)
    if (!contractAddress) return { released: false, emailsSent: 0 }
    const client = readonlyContractClient(contractAddress, aptosNetworkFor(drop.network))
    released = (await client.getReleaseMaterial(dropId)).released
    if (released) await db.markReleased(dropId)
  }
  if (!released) return { released: false, emailsSent: 0 }

  // Notify exactly once. Public drops self-unlock via /p — mark done (no email) so we don't re-scan.
  if (drop.notificationsSentAt) return { released: true, emailsSent: 0 }
  if (drop.distribution === "public") {
    await db.markNotificationsSent(dropId)
    return { released: true, emailsSent: 0 }
  }
  const emailsSent = await notifyReleasedDrop(db, drop)
  return { released: true, emailsSent }
}
