// GET /api/public/[dropId] — PUBLIC drop metadata. No burn, no single-use, no expiry: public drops
// are intentionally multi-use after release. Safe to return tlockShardA/ibeHeader unconditionally —
// they only open once the drand round publishes / the contract releases.

import { getDb } from "@/lib/db"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ dropId: string }> },
): Promise<Response> {
  const { dropId } = await params
  const d = await getDb().getPublicDrop(dropId)
  if (!d) return Response.json({ error: "Not found" }, { status: 404 })

  return Response.json(
    {
      distribution: d.distribution,
      mode: d.mode,
      releaseRound: d.releaseRound,
      contractRef: d.contractRef,
      tlockShardA: d.tlockShardA,
      ibeHeader: d.ibeHeader,
      iv: d.iv,
      blobName: d.blobName,
      ciphertextFingerprint: d.ciphertextFingerprint,
      triggerAt: d.triggerAt,
      ownerAddress: d.ownerAddress,
      status: d.releasedAt ? "released" : "armed",
    },
    { status: 200 },
  )
}
