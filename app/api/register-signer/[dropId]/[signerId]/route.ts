// Multisig signer pre-registration.
//   POST: the signer signs `deaddrop:signer:${dropId}:${blsPubkey}` (binding the BLS pubkey to the
//         wallet), we verify it, and store the BLS pubkey so the owner can deal the group key and
//         the contract can later verify approvals.
//   GET:  the owner reads registration status + the BLS pubkey to assemble the signer group.

import { z } from "zod"
import { getDb } from "@/lib/db"
import { verifyAptosSignedMessage } from "@/lib/aptos"
import { signerRegisterMessage } from "@/lib/auth"
import { unb64 } from "@/lib/crypto"

const bodySchema = z.object({
  walletAddress: z.string().min(1),
  walletChain: z.enum(["aptos", "solana", "ethereum"]),
  blsPubkey: z.string().min(1),
  proofSignature: z.string().min(1),
  publicKey: z.string().min(1),
  fullMessage: z.string().min(1), // exact message the wallet signed (contains signerRegisterMessage)
})

function isValidBlsPubkey(b64: string): boolean {
  try {
    return unb64(b64).length === 48 // compressed G1
  } catch {
    return false
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ dropId: string; signerId: string }> },
): Promise<Response> {
  const { dropId, signerId } = await params
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 })
  const b = parsed.data

  if (!isValidBlsPubkey(b.blsPubkey)) {
    return Response.json({ error: "Malformed BLS public key" }, { status: 400 })
  }

  if (b.walletChain !== "aptos") {
    return Response.json({ error: "Only Aptos wallets are supported at launch" }, { status: 400 })
  }
  const ok = verifyAptosSignedMessage({
    address: b.walletAddress,
    publicKey: b.publicKey,
    signedMessage: b.fullMessage,
    signature: b.proofSignature,
    mustContain: signerRegisterMessage(dropId, b.blsPubkey),
  })
  if (!ok) return Response.json({ error: "Invalid signature" }, { status: 401 })

  // SECURITY TODO (review finding, full fix): bind this signer slot to the wallet_address the OWNER
  // designated at slot-creation time and reject mismatches, so an attacker can't substitute their
  // own BLS pubkey into a threshold slot. Insert-once below prevents silent overwrite meanwhile.
  const stored = await getDb().putSignerRegistration(dropId, signerId, {
    walletAddress: b.walletAddress,
    walletChain: b.walletChain,
    blsPubkey: b.blsPubkey,
  })
  if (!stored) {
    return Response.json({ error: "This signer is already registered" }, { status: 409 })
  }
  return Response.json({ registered: true }, { status: 200 })
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ dropId: string; signerId: string }> },
): Promise<Response> {
  const { dropId, signerId } = await params
  const reg = await getDb().getSignerRegistration(dropId, signerId)
  if (!reg) return Response.json({ registered: false }, { status: 200 })
  return Response.json(
    { registered: true, walletAddress: reg.walletAddress, blsPubkey: reg.blsPubkey },
    { status: 200 },
  )
}
