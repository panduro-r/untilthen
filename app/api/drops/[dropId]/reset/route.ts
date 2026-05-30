// POST /api/drops/[dropId]/reset — atomic timelock timer reset. The owner's browser already
// recovered shardA/K via wallet signature and re-timelocked; this just swaps the stored ciphertext
// with an optimistic-concurrency guard (expectedOldRound) and refuses once released. 409 on race.

import { z } from "zod"
import { getDb } from "@/lib/db"
import { ownerAuthSchema, verifyOwnerAuth } from "@/lib/auth"

const bodySchema = z.object({
  tlockShardA: z.string().min(1),
  releaseRound: z.number(),
  triggerAt: z.number(),
  expectedOldRound: z.number(),
  auth: ownerAuthSchema,
})

export async function POST(
  req: Request,
  { params }: { params: Promise<{ dropId: string }> },
): Promise<Response> {
  const { dropId } = await params

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 })
  const b = parsed.data

  const drop = await getDb().getDrop(dropId)
  if (!drop) return Response.json({ error: "Not found" }, { status: 404 })
  if (drop.mode !== "timelock") {
    return Response.json({ error: "Only timelock drops can be reset" }, { status: 400 })
  }

  const authed = await verifyOwnerAuth(b.auth, drop.ownerAddress, dropId)
  if (!authed) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const ok = await getDb().resetTimelock({
    dropId,
    tlockShardA: b.tlockShardA,
    releaseRound: b.releaseRound,
    triggerAt: b.triggerAt,
    expectedOldRound: b.expectedOldRound,
  })
  if (!ok) {
    // Already released, or a concurrent/stale reset won the optimistic-concurrency race.
    return Response.json({ error: "Drop already released or reset out of date" }, { status: 409 })
  }
  return Response.json({ ok: true }, { status: 200 })
}
