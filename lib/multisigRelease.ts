import "server-only"
import { getDb } from "@/lib/db"
import { AptosMoveContractClient } from "@/lib/contract.aptos"

/**
 * Mirror an on-chain multi-sig release into the DB (set released_at) so server-backed surfaces — the
 * owner dashboard and the private-retrieval burn — don't have to wait for the daily cron. A multi-sig
 * safe releases the moment signers approve on-chain; this just catches the DB up.
 *
 * Idempotent and safe: it only stamps when the contract confirms `released`, so it can never force a
 * release. Returns whether the safe is released.
 */
export async function syncMultisigRelease(dropId: string): Promise<boolean> {
  const contractAddress = process.env.NEXT_PUBLIC_DEADDROP_CONTRACT_ADDRESS
  if (!contractAddress) return false
  const drop = await getDb().getDrop(dropId)
  if (!drop || drop.mode !== "multisig") return !!drop?.releasedAt
  if (drop.releasedAt) return true
  const noop = async (): Promise<{ hash: string }> => {
    throw new Error("read-only client")
  }
  const { released } = await new AptosMoveContractClient(contractAddress, noop).getReleaseMaterial(dropId)
  if (released) await getDb().markReleased(dropId)
  return released
}
