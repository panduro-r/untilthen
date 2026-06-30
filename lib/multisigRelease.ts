import "server-only"
import { getDb } from "@/lib/db"
import { readonlyContractClient } from "@/lib/contract.aptos"
import { contractAddressOrNull, aptosNetworkFor } from "@/lib/networks"

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
