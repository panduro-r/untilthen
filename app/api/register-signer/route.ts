// Once-per-wallet multisig signer registration.
//   POST: the signer signs `signerRegisterMessage(encPublicKey)` (binding their X25519 encryption
//         pubkey to the wallet), we verify it, and store the key once by wallet address so the OWNER
//         can ECIES-deal that signer's Shamir share to it when arming ANY safe.
//   GET ?address=…: the owner reads whether a wallet is registered + its enc pubkey.
// Wallet-scoped, not per-safe: a signer registers a single time and is usable on every future safe.

import { z } from "zod"
import { getDb } from "@/lib/db"
import { verifyAptosSignedMessage } from "@/lib/aptos"
import { signerRegisterMessage } from "@/lib/auth"
import { unb64 } from "@/lib/crypto"

// Canonical address form so the owner's designated address and the signer's registered address match
// regardless of 0x-prefix or zero-padding. Matches lib/armDrop's normAddr.
const norm = (a: string) => (a.startsWith("0x") ? a.slice(2) : a).toLowerCase().padStart(64, "0")

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

export async function POST(req: Request): Promise<Response> {
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
    mustContain: signerRegisterMessage(b.encPublicKey),
  })
  if (!ok) return Response.json({ error: "Invalid signature" }, { status: 401 })

  // Upsert by wallet address: a signer can re-register (e.g. after clearing storage) and it just
  // refreshes their key. The signature above proves the caller controls this wallet, so only the
  // wallet owner can set their own key.
  await getDb().putSignerKey(norm(b.walletAddress), b.encPublicKey)
  return Response.json({ registered: true }, { status: 200 })
}

export async function GET(req: Request): Promise<Response> {
  const address = new URL(req.url).searchParams.get("address")
  if (!address) return Response.json({ error: "Missing address" }, { status: 400 })
  const encPublicKey = await getDb().getSignerKey(norm(address))
  if (!encPublicKey) return Response.json({ registered: false }, { status: 200 })
  return Response.json({ registered: true, encPublicKey }, { status: 200 })
}
