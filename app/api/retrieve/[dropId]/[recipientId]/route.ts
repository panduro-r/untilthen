// GET /api/retrieve/[dropId]/[recipientId] — claim a PRIVATE drop. The most security-sensitive
// endpoint: the check-and-burn is a SINGLE atomic db operation (mirrors UPDATE ... RETURNING).
//
// On any failure — already burned, expired, not released, wrong distribution, nonexistent — return
// the SAME 410 so a prober can't distinguish cases. Even a buggy early return is not decryptable:
// tlockShardA needs the published drand round, ibeHeader needs a threshold of signer signatures.

import { getDb } from "@/lib/db"

const GONE = { error: "This link is no longer valid." }
const SEVEN_DAYS_MS = 7 * 86_400_000

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ dropId: string; recipientId: string }> },
): Promise<Response> {
  const { dropId, recipientId } = await params
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
