// Multisig signer pre-registration.
//   POST: the signer signs `deaddrop:signer:${dropId}:${encPublicKey}` (binding their X25519
//         encryption pubkey to the wallet), we verify it, and store the enc pubkey so the OWNER can
//         ECIES-deal that signer's Shamir share to it when arming.
//   GET:  the owner reads registration status + the enc pubkey to assemble the signer group.

import { z } from "zod"
import { getDb } from "@/lib/db"
import { verifyAptosSignedMessage } from "@/lib/aptos"
import { signerRegisterMessage } from "@/lib/auth"
import { unb64 } from "@/lib/crypto"

const bodySchema = z.object({
  walletAddress: z.string().min(1),
  walletChain: z.enum(["aptos", "solana", "ethereum"]),
  encPublicKey: z.string().min(1), // base64 X25519 (32 bytes)
  proofSignature: z.string().min(1),
  publicKey: z.string().min(1),
  fullMessage: z.string().min(1), // exact message the wallet signed (contains signerRegisterMessage)
})

function isValidEncPubkey(b64: string): boolean {
  try {
    return unb64(b64).length === 32 // X25519
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

  if (!isValidEncPubkey(b.encPublicKey)) {
    return Response.json({ error: "Malformed encryption public key" }, { status: 400 })
  }
  if (b.walletChain !== "aptos") {
    return Response.json({ error: "Only Aptos wallets are supported at launch" }, { status: 400 })
  }
  const ok = verifyAptosSignedMessage({
    address: b.walletAddress,
    publicKey: b.publicKey,
    signedMessage: b.fullMessage,
    signature: b.proofSignature,
    mustContain: signerRegisterMessage(dropId, b.encPublicKey),
  })
  if (!ok) return Response.json({ error: "Invalid signature" }, { status: 401 })

  // Slot-binding (review finding "Vuln-2"): the owner enforces, at arm time, that this slot's
  // registered wallet matches the address they designated — see lib/armDrop fetchSignerEncPubkey,
  // which refuses to deal a signer's key if the registered wallet differs. Insert-once below also
  // prevents silent overwrite of a legitimate registration. (A server-side pre-declare would additionally
  // defend against a malicious backend lying about the registered address — future hardening.)
  const stored = await getDb().putSignerRegistration(dropId, signerId, {
    walletAddress: b.walletAddress,
    walletChain: b.walletChain,
    encPublicKey: b.encPublicKey,
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
    { registered: true, walletAddress: reg.walletAddress, encPublicKey: reg.encPublicKey },
    { status: 200 },
  )
}
