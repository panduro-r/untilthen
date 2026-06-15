// GET /api/retrieve/[dropId]/[recipientId] — claim a PRIVATE drop. The most security-sensitive
// endpoint: the check-and-burn is a SINGLE atomic db operation (mirrors UPDATE ... RETURNING).
//
// On any failure — already burned, expired, not released, wrong distribution, nonexistent — return
// the SAME 410 so a prober can't distinguish cases. Even a buggy early return is not decryptable:
// tlockShardA needs the published drand round, ibeHeader needs a threshold of signer signatures.

import { getDb } from "@/lib/db"
import { AptosMoveContractClient } from "@/lib/contract.aptos"

const GONE = { error: "This link is no longer valid." }
const SEVEN_DAYS_MS = 7 * 86_400_000

// Multi-sig safes release on-chain the instant signers approve, but the DB `released_at` (which the
// atomic burn below requires) is normally stamped by the daily cron. Stamp it here too, so a private
// recipient isn't blocked waiting for the cron. Idempotent (markReleased is atomic) and best-effort:
// any failure falls through to the same atomic burn + uniform 410, so it never leaks or weakens it.
async function ensureMultisigReleaseStamped(dropId: string): Promise<void> {
  const contractAddress = process.env.NEXT_PUBLIC_DEADDROP_CONTRACT_ADDRESS
  if (!contractAddress) return
  const drop = await getDb().getDrop(dropId)
  if (!drop || drop.mode !== "multisig" || drop.releasedAt) return
  const noop = async (): Promise<{ hash: string }> => {
    throw new Error("read-only client")
  }
  const { released } = await new AptosMoveContractClient(contractAddress, noop).getReleaseMaterial(dropId)
  if (released) await getDb().markReleased(dropId)
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ dropId: string; recipientId: string }> },
): Promise<Response> {
  const { dropId, recipientId } = await params
  try {
    await ensureMultisigReleaseStamped(dropId)
  } catch (e) {
    console.error("[retrieve] multisig release pre-check failed:", e)
  }
  const burned = await getDb().burnRecipient(dropId, recipientId, SEVEN_DAYS_MS)
  if (!burned) return Response.json(GONE, { status: 410 })

  // Only locked material — never a usable secret.
  return Response.json(
    {
      wrappedShardB: burned.wrappedShardB,
      tlockShardA: burned.tlockShardA,
      contractRef: burned.contractRef,
      ibeHeader: burned.ibeHeader,
      releaseRound: burned.releaseRound,
      iv: burned.iv,
      blobName: burned.blobName,
      ciphertextFingerprint: burned.ciphertextFingerprint,
      mode: burned.mode,
      ownerAddress: burned.ownerAddress,
    },
    { status: 200 },
  )
}
