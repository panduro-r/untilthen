// POST /api/drops — create a drop. Stores ONLY gated/wrapped material; rejects any raw shardA/K.
// Encrypts recipient/signer emails under EMAIL_ENC_KEY before storage (metadata minimization).

import { z } from "zod"
import { getDb, type NewDropInput } from "@/lib/db"
import { ownerAuthSchema, verifyOwnerAuth } from "@/lib/auth"
import { getSession } from "@/lib/session"
import { isSameOrigin } from "@/lib/origin"
import { encryptAtRest } from "@/lib/serverCrypto"
import { sendRecipientHeadsUpEmail, sendSignerApprovalRequestEmail } from "@/lib/email"
import { formatAddress } from "@/lib/ids"
import { scheduleRelease } from "@/lib/qstash"
import { syncMultisigRelease } from "@/lib/multisigRelease"

// GET /api/drops — list the signed-in owner's drop summaries (no secrets). Session-gated, so it works
// across devices: sign in once (SIWA) and your dashboard is fetched server-side.
export async function GET(): Promise<Response> {
  const session = await getSession()
  if (!session) return Response.json({ error: "Not signed in." }, { status: 401 })
  const drops = await getDb().listOwnerDropSummaries(session.address)
  // Multi-sig safes release on-chain when signers approve; the DB only catches up on the daily cron.
  // Reconcile from the chain here so the dashboard shows Released promptly. Best-effort + parallel;
  // once stamped, later loads skip the on-chain read (releasedAt is set).
  await Promise.all(
    drops.map(async (d) => {
      if (d.mode === "multisig" && !d.releasedAt) {
        try {
          if (await syncMultisigRelease(d.id)) d.releasedAt = Date.now()
        } catch {
          // transient RPC error; the next dashboard load (or the cron) reconciles
        }
      }
    }),
  )
  return Response.json({ drops })
}

// Top-level field names that would indicate a raw secret leaked into the payload. (recipients[].secret
// is the per-recipient email secret, which only unwraps shardB and is allowed — see ARCHITECTURE.)
// Compared against lowercased payload keys, so all entries are lowercase.
const FORBIDDEN_TOP_LEVEL = ["sharda", "shard_a", "key", "keybytes", "k", "rawsecret", "w", "secret"]

const recipientSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["email", "wallet"]),
  name: z.string().optional(),
  email: z.string().email(),
  backupEmail: z.string().email().optional(),
  walletAddress: z.string().optional(),
  walletChain: z.enum(["aptos", "solana", "ethereum"]).optional(),
  wrappedShardB: z.string().min(1),
  secret: z.string().optional(), // email recipients only (base64); deleted once notified
})

const signerSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  walletAddress: z.string().min(1),
  walletChain: z.enum(["aptos", "solana", "ethereum"]),
  blsPubkey: z.string().min(1),
  email: z.string().email(),
})

const bodySchema = z.object({
  dropId: z.string().min(1),
  ownerAddress: z.string().min(1),
  auth: ownerAuthSchema.optional(), // optional: the session authorizes the create; auth is a fallback
  mode: z.enum(["timelock", "multisig"]),
  distribution: z.enum(["private", "public"]),
  blobName: z.string().min(1),
  iv: z.string().min(1),
  fingerprint: z.string().min(1),
  encryptedTitle: z.string().min(1),
  expirationMicros: z.number(),
  tlockShardA: z.string().nullish(),
  releaseRound: z.number().nullish(),
  contractRef: z.string().nullish(),
  ibeHeader: z.string().nullish(),
  ownerShardA: z.string().nullish(),
  ownerKeyWrapped: z.string().nullish(),
  triggerAt: z.number().nullish(),
  checkInIntervalDays: z.number().nullish(),
  gracePeriodDays: z.number().nullish(),
  recipients: z.array(recipientSchema).default([]),
  signers: z.array(signerSchema).default([]),
})

export async function POST(req: Request): Promise<Response> {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }

  // Invariant guard: no raw drop secret may appear at the top level of the payload.
  if (raw && typeof raw === "object") {
    for (const key of Object.keys(raw as Record<string, unknown>)) {
      if (FORBIDDEN_TOP_LEVEL.includes(key.toLowerCase())) {
        return Response.json({ error: "Payload must not contain a raw secret" }, { status: 400 })
      }
    }
  }

  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 })
  }
  const b = parsed.data

  // Gating must match the mode, and the raw secret must already be locked (we never receive it raw).
  if (b.mode === "timelock" && !(b.tlockShardA && typeof b.releaseRound === "number")) {
    return Response.json({ error: "timelock drop requires tlockShardA + releaseRound" }, { status: 400 })
  }
  if (b.mode === "multisig" && !(b.ibeHeader && b.contractRef)) {
    return Response.json({ error: "multisig drop requires ibeHeader + contractRef" }, { status: 400 })
  }

  // Distribution rules: public has no recipients; private must have at least one.
  if (b.distribution === "public" && b.recipients.length > 0) {
    return Response.json({ error: "public drops cannot have recipients" }, { status: 400 })
  }
  if (b.distribution === "private" && b.recipients.length === 0) {
    return Response.json({ error: "private drops require at least one recipient" }, { status: 400 })
  }

  // Authorize: prefer the signed-in session (connecting already proved wallet ownership). Fall back to
  // a per-action owner signature for callers without a session (e.g. tests). The owner is taken from
  // whichever proof succeeds — never trusted blindly from the body.
  const session = await getSession()
  let ownerAddress: string
  if (session) {
    // Cookie-authorized: block cross-origin (CSRF) requests and confused-deputy owner mismatches.
    if (!isSameOrigin(req)) {
      return Response.json({ error: "Cross-origin request rejected" }, { status: 403 })
    }
    if (b.ownerAddress.toLowerCase() !== session.address.toLowerCase()) {
      return Response.json({ error: "Owner address does not match your session" }, { status: 400 })
    }
    ownerAddress = session.address
  } else if (b.auth && (await verifyOwnerAuth(b.auth, b.ownerAddress, b.dropId))) {
    ownerAddress = b.ownerAddress
  } else {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Encrypt recipient/signer emails at rest (decryptable only by the notifier).
  const recipients = await Promise.all(
    b.recipients.map(async (r) => ({
      id: r.id,
      dropId: b.dropId,
      name: r.name ?? null,
      type: r.type,
      encryptedEmail: await encryptAtRest(r.email),
      encryptedBackupEmail: r.backupEmail ? await encryptAtRest(r.backupEmail) : null,
      walletAddress: r.walletAddress ?? null,
      walletChain: r.walletChain ?? null,
      wrappedShardB: r.wrappedShardB,
    })),
  )
  const recipientSecrets = b.recipients
    .filter((r) => r.type === "email" && r.secret)
    .map((r) => ({ recipientId: r.id, secret: r.secret as string }))

  const signers = await Promise.all(
    b.signers.map(async (s) => ({
      id: s.id,
      dropId: b.dropId,
      name: s.name ?? null,
      walletAddress: s.walletAddress,
      walletChain: s.walletChain,
      blsPubkey: s.blsPubkey,
      encryptedEmail: await encryptAtRest(s.email),
      registered: true, // signers must already be registered to arm a multisig drop
    })),
  )

  const input: NewDropInput = {
    id: b.dropId,
    ownerAddress,
    encryptedTitle: b.encryptedTitle,
    blobName: b.blobName,
    iv: b.iv,
    ciphertextFingerprint: b.fingerprint,
    mode: b.mode,
    distribution: b.distribution,
    tlockShardA: b.tlockShardA ?? null,
    releaseRound: b.releaseRound ?? null,
    contractRef: b.contractRef ?? null,
    ibeHeader: b.ibeHeader ?? null,
    ownerShardA: b.ownerShardA ?? null,
    ownerKeyWrapped: b.ownerKeyWrapped ?? null,
    checkInIntervalDays: b.checkInIntervalDays ?? null,
    gracePeriodDays: b.gracePeriodDays ?? null,
    triggerAt: b.triggerAt ?? null,
    expirationMicros: b.expirationMicros,
    recipients,
    recipientSecrets,
    signers,
  }

  try {
    await getDb().createDrop(input)
  } catch {
    return Response.json({ error: "Could not create the drop" }, { status: 409 })
  }

  // Schedule the one-shot release trigger (time-lock only) via QStash, so the retrieval email + status
  // flip happen promptly at the release time instead of on the daily cron. Best-effort; no-op if QStash
  // isn't configured. Multisig releases on-chain, so it's left to the cron's contract poll.
  if (b.mode === "timelock" && b.triggerAt) {
    await scheduleRelease(b.triggerAt)
  }

  // Heads-up email to private recipients at arm time — informational only, NO secret/link (the
  // one-time retrieval link is emailed separately when the safe actually releases). Best-effort:
  // a send failure never fails the arm. Awaited so it completes before the serverless fn freezes.
  if (process.env.RESEND_API_KEY && b.recipients.length > 0) {
    const ownerName = formatAddress(ownerAddress)
    const triggerDate = b.triggerAt ? new Date(b.triggerAt) : null
    await Promise.all(
      b.recipients.map((r) =>
        sendRecipientHeadsUpEmail({ to: r.email, recipientName: r.name, ownerName, mode: b.mode, triggerDate })
          .catch((e) => console.error("[drops] heads-up email failed:", e)),
      ),
    )
  }

  // Multi-sig: email each signer their approval link at arm so they know where to approve when the
  // group decides it's time. Best-effort (a send failure never fails the arm); the owner can also
  // resend or copy the link from the safe page. The link is not a secret — approving still needs the
  // signer's own wallet signature.
  if (process.env.RESEND_API_KEY && b.mode === "multisig" && b.signers.length > 0) {
    const ownerName = formatAddress(ownerAddress)
    const base = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin
    await Promise.all(
      b.signers.map((s) =>
        sendSignerApprovalRequestEmail({ to: s.email, ownerName, approveUrl: `${base}/approve/${b.dropId}/${s.id}` })
          .catch((e) => console.error("[drops] approval email failed:", e)),
      ),
    )
  }

  return Response.json({ dropId: b.dropId }, { status: 200 })
}
