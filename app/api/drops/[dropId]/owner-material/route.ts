// POST /api/drops/[dropId]/owner-material — returns the OWNER's reset material for their own drop.
// Owner-authed. The returned owner copy is wallet-wrapped (XOR'd with a key derived from the owner's
// wallet signature), so it is useless to anyone but the owner — the same material the DB already
// holds. Used by the timer-reset flow to recover the gated secret and re-timelock it.

import { z } from "zod"
import { getDb } from "@/lib/db"
import { ownerAuthSchema, verifyOwnerAuth } from "@/lib/auth"

const bodySchema = z.object({ auth: ownerAuthSchema })

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

  const drop = await getDb().getDrop(dropId)
  if (!drop) return Response.json({ error: "Not found" }, { status: 404 })
  if (drop.mode !== "timelock") {
    return Response.json({ error: "Only timelock drops can be reset" }, { status: 400 })
  }
  const authed = await verifyOwnerAuth(parsed.data.auth, drop.ownerAddress, dropId)
  if (!authed) return Response.json({ error: "Unauthorized" }, { status: 401 })

  if (drop.releasedAt) {
    return Response.json({ error: "This drop has already released" }, { status: 409 })
  }

  return Response.json(
    {
      distribution: drop.distribution,
      ownerShardA: drop.ownerShardA,
      ownerKeyWrapped: drop.ownerKeyWrapped,
      releaseRound: drop.releaseRound,
      checkInIntervalDays: drop.checkInIntervalDays,
      gracePeriodDays: drop.gracePeriodDays,
    },
    { status: 200 },
  )
}
