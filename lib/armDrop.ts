// lib/armDrop.ts — the canonical arming flow (ARCHITECTURE.md "Upload flow as actual code").
// Runs entirely in the browser. The backend only ever receives gated/wrapped material.
//
// Timelock: the secret is drand-timelocked + a wallet-wrapped owner copy is kept for resets.
// Multisig: the secret is IBE-encrypted to identity=dropId under the owner-dealt signer-group key,
//   each signer's Shamir share is ECIES-sealed to their registered enc pubkey, and the group +
//   shares + IBE header are written on-chain (no owner copy — owner discarded the master).

import {
  importKey,
  exportKey,
  generateKey,
  xorBytes,
  randomBytes,
  hkdfExpand,
  deriveWalletWrapKey,
  encryptTitleForOwner,
  b64,
  unb64,
  encryptBytes,
  fingerprintOf,
} from "@/lib/crypto"
import { roundForTime, timelockEncryptShardA } from "@/lib/timelock"
import { uploadCiphertext, chooseExpiration } from "@/lib/shelby"
import { signMessage, getWalletSigner } from "@/lib/aptos"
import { ownerCopyMessage } from "@/lib/auth"
import { getTitleKey } from "@/lib/titleKey"
import { setupSignerGroup, ibeEncryptToGroup } from "@/lib/threshold"
import { eciesEncryptToSigner } from "@/lib/signerKeys"
import { walletContractClient } from "@/lib/contract.aptos"
import { useWalletStore } from "@/store/wallet"
import type { Draft } from "@/store/draft"

export type ArmResult = { dropId: string; publicLink?: string }

async function ensureCiphertext(draft: Draft) {
  if (draft.ciphertext && draft.iv && draft.keyBytes && draft.fingerprint) {
    return { ciphertext: draft.ciphertext, iv: draft.iv, keyBytes: draft.keyBytes, fingerprint: draft.fingerprint }
  }
  throw new Error("File not encrypted yet")
}

/** Wrap shardB per email recipient (private drops). Returns the POST recipient payloads. */
async function wrapRecipients(draft: Draft, shardB: Uint8Array | undefined) {
  if (draft.distribution !== "private") return []
  return Promise.all(
    draft.recipients.map(async (r) => {
      if (r.type !== "email") {
        throw new Error("Wallet recipients require pre-registration — use email recipients for now.")
      }
      const secret = randomBytes(32)
      const wrapKey = await hkdfExpand(secret, "deaddrop-shardB", 32)
      return {
        id: r.id,
        type: "email" as const,
        name: r.name,
        email: r.email,
        backupEmail: r.backupEmail || undefined,
        wrappedShardB: b64(xorBytes(shardB!, wrapKey)),
        secret: b64(secret),
      }
    }),
  )
}

export async function armDrop(draft: Draft): Promise<ArmResult> {
  const wallet = useWalletStore.getState()
  if (!wallet.address || !wallet.publicKey) throw new Error("Connect your wallet first")
  if (!draft.dropId) throw new Error("Missing drop id")
  const dropId = draft.dropId

  const { ciphertext, iv, keyBytes, fingerprint } = await ensureCiphertext(draft)

  // What gets gated: shardA (private) or K (public). shardB is wrapped per recipient (private).
  let shardB: Uint8Array | undefined
  let toGate: Uint8Array
  if (draft.distribution === "private") {
    shardB = randomBytes(32)
    toGate = xorBytes(keyBytes, shardB)
  } else {
    toGate = keyBytes
  }

  const titleKey = await getTitleKey()
  const encryptedTitle = await encryptTitleForOwner(draft.title, titleKey, dropId)
  const recipients = await wrapRecipients(draft, shardB)

  const { blobName } = await uploadCiphertext({
    signer: getWalletSigner(),
    ciphertext,
    blobName: `deaddrop_${dropId}`,
    expirationMicros: chooseExpiration(draft.mode === "timelock" ? releaseAtFor(draft) : undefined),
  })

  // No per-safe ownership signature here: connecting already established a signed-in session, and the
  // /api/drops route authorizes the create from that session cookie (sent automatically).
  const ownerAddress = wallet.address

  if (draft.mode === "timelock") {
    return armTimelock({ draft, dropId, toGate, encryptedTitle, recipients, blobName, iv, fingerprint, ownerAddress })
  }
  return armMultisig({ draft, dropId, toGate, encryptedTitle, recipients, blobName, iv, fingerprint, ownerAddress })
}

function releaseAtFor(draft: Draft): number {
  // The owner picks an absolute release time; postpone re-locks to a later one (see lib/reset.ts).
  return draft.releaseAt
}

type ArmCtx = {
  draft: Draft
  dropId: string
  toGate: Uint8Array
  encryptedTitle: string
  recipients: Awaited<ReturnType<typeof wrapRecipients>>
  blobName: string
  iv: Uint8Array
  fingerprint: string
  ownerAddress: string
}

async function postDrop(body: Record<string, unknown>): Promise<void> {
  const res = await fetch("/api/drops", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const e = await res.json().catch(() => ({}))
    throw new Error(e.error || "We couldn't arm the drop. Please try again.")
  }
}

async function armTimelock(ctx: ArmCtx): Promise<ArmResult> {
  const { draft, dropId, toGate } = ctx
  const releaseAtMs = releaseAtFor(draft)
  const releaseRound = await roundForTime(releaseAtMs)
  const tlockShardA = await timelockEncryptShardA(toGate, releaseRound)

  // Owner copy (wallet-wrapped) so the owner can reset / self-recover.
  const ownerWrapKey = await deriveWalletWrapKey(await signMessage(ownerCopyMessage(dropId)))
  const ownerWrapped = b64(xorBytes(toGate, ownerWrapKey))

  await postDrop({
    dropId,
    ownerAddress: ctx.ownerAddress,
    mode: "timelock",
    distribution: draft.distribution,
    blobName: ctx.blobName,
    iv: b64(ctx.iv),
    fingerprint: ctx.fingerprint,
    encryptedTitle: ctx.encryptedTitle,
    expirationMicros: chooseExpiration(releaseAtMs),
    tlockShardA,
    releaseRound,
    ownerShardA: draft.distribution === "private" ? ownerWrapped : undefined,
    ownerKeyWrapped: draft.distribution === "public" ? ownerWrapped : undefined,
    triggerAt: releaseAtMs,
    recipients: ctx.recipients,
    signers: [],
  })
  return { dropId, publicLink: draft.distribution === "public" ? `${window.location.origin}/p/${dropId}` : undefined }
}

/**
 * Fetch a signer's registered enc pubkey by the address the OWNER designated. Registration is now
 * once-per-wallet (not per-safe), so the lookup is by address. Slot-binding is inherent (review
 * finding "Vuln-2"): you can only get the key for the exact wallet you named, so a stranger who
 * registered a different wallet can never be dealt into this group.
 */
async function fetchSignerEncPubkey(expectedAddress: string): Promise<string> {
  const res = await fetch(`/api/register-signer?address=${encodeURIComponent(expectedAddress)}`)
  const body = (await res.json()) as { registered: boolean; encPublicKey?: string }
  if (!body.registered || !body.encPublicKey) {
    throw new Error(
      "Every signer must register once before you can arm. Send each signer their registration link.",
    )
  }
  return body.encPublicKey
}

async function armMultisig(ctx: ArmCtx): Promise<ArmResult> {
  const { draft, dropId, toGate } = ctx
  const contractAddress = process.env.NEXT_PUBLIC_DEADDROP_CONTRACT_ADDRESS
  if (!contractAddress) throw new Error("Multisig isn't configured (no contract address).")
  const signAndSubmit = useWalletStore.getState().signAndSubmitFn
  if (!signAndSubmit) throw new Error("Connect your wallet first")
  if (draft.signers.length < 2 || draft.threshold < 1 || draft.threshold > draft.signers.length) {
    throw new Error("Add at least two signers and a valid threshold.")
  }

  // Each signer's registered enc pubkey (gates arming until everyone registered + binds the slot to
  // the owner-designated address).
  const encPubkeys = await Promise.all(draft.signers.map((s) => fetchSignerEncPubkey(s.address)))

  // 1. Deal the group key + ECIES-seal each signer's share to their enc pubkey.
  const group = setupSignerGroup({ signerCount: draft.signers.length, threshold: draft.threshold })
  const encKeyShares = await Promise.all(
    group.signers.map((s, i) => eciesEncryptToSigner(unb64(encPubkeys[i]), unb64(s.shareScalar))),
  )

  // 2. IBE-encrypt the gated secret to identity=dropId under the group key.
  const ibeHeader = await ibeEncryptToGroup({ secret: toGate, dropId, groupPubkey: group.groupPubkey })

  // 3. create_drop on chain (group pubkey, signer BLS pubkeys, enc'd shares, IBE header).
  const client = walletContractClient(contractAddress, signAndSubmit)
  const { contractRef } = await client.createDrop({
    dropId,
    owner: ctx.ownerAddress,
    mode: "multisig",
    distribution: draft.distribution,
    threshold: draft.threshold,
    signers: draft.signers.map((s) => s.address),
    signerBlsPubkeys: group.signers.map((s) => s.blsPubkey),
    groupPubkey: group.groupPubkey,
    encKeyShares,
    ibeHeader,
  })

  // 4. POST — no owner copy (the master was discarded). Signers recorded for the notifier.
  await postDrop({
    dropId,
    ownerAddress: ctx.ownerAddress,
    mode: "multisig",
    distribution: draft.distribution,
    blobName: ctx.blobName,
    iv: b64(ctx.iv),
    fingerprint: ctx.fingerprint,
    encryptedTitle: ctx.encryptedTitle,
    expirationMicros: chooseExpiration(undefined),
    contractRef,
    ibeHeader,
    recipients: ctx.recipients,
    signers: draft.signers.map((s, i) => ({
      id: s.id,
      name: s.name,
      walletAddress: s.address,
      walletChain: "aptos" as const,
      blsPubkey: group.signers[i].blsPubkey,
      email: s.email,
    })),
  })

  return { dropId, publicLink: draft.distribution === "public" ? `${window.location.origin}/p/${dropId}` : undefined }
}

// Re-exported so the encrypt page can produce ciphertext with the same primitives.
export { generateKey, encryptBytes, exportKey, fingerprintOf, importKey }
