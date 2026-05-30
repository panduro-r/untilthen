import { describe, it, expect, beforeEach } from "vitest"
import { ed25519 } from "@noble/curves/ed25519.js"

process.env.EMAIL_ENC_KEY = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"
process.env.CRON_SECRET = "test-cron-secret"

import { __setDb, getDb, type NewDropInput } from "../db"
import { MockDb } from "../db.mock"
import { registerMessage, b64, randomBytes } from "../crypto"
import { signerRegisterMessage } from "../auth"
import { aptosAddressFromPublicKey } from "../aptos"
import { setupSignerGroup } from "../threshold"
import { POST as registerPost, GET as registerGet } from "@/app/api/register/[dropId]/[recipientId]/route"
import { POST as signerPost } from "@/app/api/register-signer/[dropId]/[signerId]/route"
import { GET as cron } from "@/app/api/cron/release/route"

const hex = (b: Uint8Array) => Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("")
const jsonReq = (body: unknown) => new Request("http://t", { method: "POST", body: JSON.stringify(body) })

let db: MockDb
beforeEach(() => {
  db = new MockDb()
  __setDb(db)
})

describe("POST /api/register (wallet recipient)", () => {
  const ctx = (dropId: string, recipientId: string) => ({ params: Promise.resolve({ dropId, recipientId }) })

  it("stores a valid registration and the owner can read it back", async () => {
    const sk = ed25519.utils.randomSecretKey()
    const publicKey = hex(ed25519.getPublicKey(sk))
    const address = aptosAddressFromPublicKey(publicKey)
    const signature = hex(ed25519.sign(new TextEncoder().encode(registerMessage("drop_w1")), sk))

    const res = await registerPost(
      jsonReq({ walletAddress: address, walletChain: "aptos", registrationSignature: signature, publicKey }),
      ctx("drop_w1", "rcpt_w1"),
    )
    expect(res.status).toBe(200)

    const got = await registerGet(new Request("http://t"), ctx("drop_w1", "rcpt_w1"))
    expect((await got.json()).signature).toBe(signature)
  })

  it("rejects an invalid signature", async () => {
    const sk = ed25519.utils.randomSecretKey()
    const publicKey = hex(ed25519.getPublicKey(sk))
    const address = aptosAddressFromPublicKey(publicKey)
    const res = await registerPost(
      jsonReq({ walletAddress: address, walletChain: "aptos", registrationSignature: hex(new Uint8Array(64)), publicKey }),
      ctx("drop_w2", "rcpt_w2"),
    )
    expect(res.status).toBe(401)
  })

  it("is insert-once: a second (attacker) registration of the same slot is rejected (409)", async () => {
    // legitimate recipient registers
    const sk1 = ed25519.utils.randomSecretKey()
    const pub1 = hex(ed25519.getPublicKey(sk1))
    const addr1 = aptosAddressFromPublicKey(pub1)
    const sig1 = hex(ed25519.sign(new TextEncoder().encode(registerMessage("drop_w3")), sk1))
    const first = await registerPost(
      jsonReq({ walletAddress: addr1, walletChain: "aptos", registrationSignature: sig1, publicKey: pub1 }),
      ctx("drop_w3", "rcpt_w3"),
    )
    expect(first.status).toBe(200)

    // attacker, with a VALID signature for THEIR own wallet, tries to overwrite the slot
    const sk2 = ed25519.utils.randomSecretKey()
    const pub2 = hex(ed25519.getPublicKey(sk2))
    const addr2 = aptosAddressFromPublicKey(pub2)
    const sig2 = hex(ed25519.sign(new TextEncoder().encode(registerMessage("drop_w3")), sk2))
    const second = await registerPost(
      jsonReq({ walletAddress: addr2, walletChain: "aptos", registrationSignature: sig2, publicKey: pub2 }),
      ctx("drop_w3", "rcpt_w3"),
    )
    expect(second.status).toBe(409)

    // the original registration is intact (not overwritten)
    const got = await registerGet(new Request("http://t"), ctx("drop_w3", "rcpt_w3"))
    expect((await got.json()).walletAddress).toBe(addr1)
  })
})

describe("POST /api/register-signer", () => {
  const ctx = (dropId: string, signerId: string) => ({ params: Promise.resolve({ dropId, signerId }) })
  const group = setupSignerGroup({ signerCount: 1, threshold: 1 })
  const blsPubkey = group.signers[0].blsPubkey

  it("stores a valid signer registration binding the BLS pubkey to the wallet", async () => {
    const sk = ed25519.utils.randomSecretKey()
    const publicKey = hex(ed25519.getPublicKey(sk))
    const address = aptosAddressFromPublicKey(publicKey)
    const signature = hex(ed25519.sign(new TextEncoder().encode(signerRegisterMessage("drop_s1", blsPubkey)), sk))

    const res = await signerPost(
      jsonReq({ walletAddress: address, walletChain: "aptos", blsPubkey, proofSignature: signature, publicKey }),
      ctx("drop_s1", "sgnr_1"),
    )
    expect(res.status).toBe(200)
    expect((await db.getSignerRegistration("drop_s1", "sgnr_1"))!.blsPubkey).toBe(blsPubkey)
  })

  it("rejects a malformed BLS pubkey", async () => {
    const res = await signerPost(
      jsonReq({ walletAddress: "0x1", walletChain: "aptos", blsPubkey: b64(randomBytes(10)), proofSignature: "00", publicKey: "00" }),
      ctx("drop_s2", "sgnr_2"),
    )
    expect(res.status).toBe(400)
  })

  it("rejects a signature that doesn't bind the pubkey", async () => {
    const sk = ed25519.utils.randomSecretKey()
    const publicKey = hex(ed25519.getPublicKey(sk))
    const address = aptosAddressFromPublicKey(publicKey)
    // signs the wrong message (different pubkey binding)
    const signature = hex(ed25519.sign(new TextEncoder().encode(signerRegisterMessage("drop_s3", "other")), sk))
    const res = await signerPost(
      jsonReq({ walletAddress: address, walletChain: "aptos", blsPubkey, proofSignature: signature, publicKey }),
      ctx("drop_s3", "sgnr_3"),
    )
    expect(res.status).toBe(401)
  })
})

describe("GET /api/cron/release", () => {
  const authed = () => new Request("http://t/api/cron/release?round=2000", { headers: { authorization: "Bearer test-cron-secret" } })

  function privateTimelockDrop(id: string): NewDropInput {
    return {
      id,
      ownerAddress: "0xowner",
      encryptedTitle: "t",
      blobName: `deaddrop_${id}`,
      iv: "aXY=",
      ciphertextFingerprint: "fp",
      mode: "timelock",
      distribution: "private",
      tlockShardA: "ct",
      releaseRound: 1000,
      contractRef: null,
      ibeHeader: null,
      ownerShardA: "owner",
      ownerKeyWrapped: null,
      checkInIntervalDays: 30,
      gracePeriodDays: 7,
      triggerAt: Date.now(),
      expirationMicros: Date.now() * 1000,
      recipients: [
        {
          id: "rcpt_c1",
          dropId: id,
          name: null,
          type: "email",
          encryptedEmail: "enc",
          encryptedBackupEmail: "encBackup", // → backup counts as a second email
          walletAddress: null,
          walletChain: null,
          wrappedShardB: "w",
        },
      ],
      recipientSecrets: [{ recipientId: "rcpt_c1", secret: b64(randomBytes(32)) }],
      signers: [],
    }
  }

  it("401 without the CRON_SECRET", async () => {
    const res = await cron(new Request("http://t/api/cron/release?round=2000"))
    expect(res.status).toBe(401)
  })

  it("releases a timelock private drop, sends primary+backup, deletes the secret, and is idempotent", async () => {
    await db.createDrop(privateTimelockDrop("drop_c1"))
    expect(db.__hasSecret("rcpt_c1")).toBe(true)

    const res = await cron(authed())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ released: 1, emailsSent: 2 })

    // secret deleted; drop stamped released + notified
    expect(db.__hasSecret("rcpt_c1")).toBe(false)
    expect((await getDb().getDrop("drop_c1"))!.releasedAt).not.toBeNull()

    // second run releases nothing (idempotent)
    expect(await (await cron(authed())).json()).toEqual({ released: 0, emailsSent: 0 })
  })

  it("does not release a timelock drop whose round hasn't published", async () => {
    const drop = privateTimelockDrop("drop_c2")
    drop.releaseRound = 9_999_999 // far future
    await db.createDrop(drop)
    expect((await (await cron(authed())).json()).released).toBe(0)
  })

  it("stamps a public drop released but sends no email", async () => {
    const drop = privateTimelockDrop("drop_c3")
    drop.distribution = "public"
    drop.recipients = []
    drop.recipientSecrets = []
    await db.createDrop(drop)
    expect(await (await cron(authed())).json()).toEqual({ released: 1, emailsSent: 0 })
  })
})
