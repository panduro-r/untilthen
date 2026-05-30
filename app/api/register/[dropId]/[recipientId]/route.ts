// Wallet recipient pre-registration.
//   POST: the recipient signs `deaddrop:register:${dropId}`; we verify it and store the signature
//         so the owner can derive that recipient's wrappedShardB before arming.
//   GET:  the owner reads the stored signature (not secret — it only becomes a wrap key when
//         SHA-256'd, and even then wraps shardB, which is useless without shardA).

import { z } from "zod"
import { getDb } from "@/lib/db"
import { verifySignature } from "@/lib/aptos"
import { registerMessage } from "@/lib/crypto"

const bodySchema = z.object({
  walletAddress: z.string().min(1),
  walletChain: z.enum(["aptos", "solana", "ethereum"]),
  registrationSignature: z.string().min(1),
  publicKey: z.string().optional(),
})

export async function POST(
  req: Request,
  { params }: { params: Promise<{ dropId: string; recipientId: string }> },
): Promise<Response> {
  const { dropId, recipientId } = await params
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 })
  const b = parsed.data

  const ok = await verifySignature({
    address: b.walletAddress,
    chain: b.walletChain,
    message: registerMessage(dropId),
    signature: b.registrationSignature,
    publicKey: b.publicKey,
  })
  if (!ok) return Response.json({ error: "Invalid signature" }, { status: 401 })

  // SECURITY TODO (review finding, full fix): bind this slot to the wallet_address the OWNER
  // designated for `recipientId` at slot-creation time and reject registrations that don't match.
  // Until the create flow stores that intended address, the owner's UI must show + verify the
  // registered address before arming. Insert-once below prevents silent overwrite of a slot.
  const stored = await getDb().putWalletRegistration(dropId, recipientId, {
    walletAddress: b.walletAddress,
    walletChain: b.walletChain,
    signature: b.registrationSignature,
    publicKey: b.publicKey ?? null,
  })
  if (!stored) {
    return Response.json({ error: "This recipient is already registered" }, { status: 409 })
  }
  return Response.json({ registered: true }, { status: 200 })
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ dropId: string; recipientId: string }> },
): Promise<Response> {
  const { dropId, recipientId } = await params
  const reg = await getDb().getWalletRegistration(dropId, recipientId)
  if (!reg) return Response.json({ registered: false }, { status: 200 })
  return Response.json(
    { registered: true, walletAddress: reg.walletAddress, signature: reg.signature },
    { status: 200 },
  )
}
