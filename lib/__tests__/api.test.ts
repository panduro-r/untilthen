import { describe, it, expect, beforeEach } from "vitest"
import { ed25519 } from "@noble/curves/ed25519.js"

// EMAIL_ENC_KEY must be set before the routes (via serverCrypto) run.
process.env.EMAIL_ENC_KEY = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"

import { __setDb, getDb } from "../db"
import { MockDb } from "../db.mock"
import { ownerAuthMessage } from "../auth"
import { aptosAddressFromPublicKey } from "../aptos"
import { POST as createDrop } from "@/app/api/drops/route"
import { GET as retrieve } from "@/app/api/retrieve/[dropId]/[recipientId]/route"
import { GET as publicGet } from "@/app/api/public/[dropId]/route"
import { POST as reset } from "@/app/api/drops/[dropId]/reset/route"

const hex = (b: Uint8Array) => Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("")

// A deterministic owner wallet for auth.
const ownerSk = ed25519.utils.randomSecretKey()
const ownerPub = hex(ed25519.getPublicKey(ownerSk))
const ownerAddr = aptosAddressFromPublicKey(ownerPub)

function ownerAuth(dropId: string) {
  const signature = hex(ed25519.sign(new TextEncoder().encode(ownerAuthMessage(dropId)), ownerSk))
  return { address: ownerAddr, chain: "aptos" as const, publicKey: ownerPub, signature }
}

function jsonReq(body: unknown): Request {
  return new Request("http://test/api", { method: "POST", body: JSON.stringify(body) })
}

function baseDrop(dropId: string) {
  return {
    dropId,
    ownerAddress: ownerAddr,
    auth: ownerAuth(dropId),
    mode: "timelock" as const,
    distribution: "private" as const,
    blobName: `deaddrop_${dropId}`,
    iv: "aXY=",
    fingerprint: "3f2a9c81 b9d4e5f6 a7c8b9d0 e1f2a3b4",
    encryptedTitle: "ZW5jVGl0bGU=",
    expirationMicros: Date.now() * 1000 + 30 * 86_400_000_000,
    tlockShardA: "tlock-armored-ciphertext",
    releaseRound: 1000,
    recipients: [
      { id: "rcpt_a1", type: "email", email: "alice@example.com", wrappedShardB: "d3JhcA==", secret: "c2VjcmV0" },
    ],
  }
}

let db: MockDb
beforeEach(() => {
  db = new MockDb()
  __setDb(db)
})

describe("POST /api/drops", () => {
  it("creates a private timelock drop, encrypts the email, stores the secret", async () => {
    const res = await createDrop(jsonReq(baseDrop("drop_create1")))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ dropId: "drop_create1" })

    const r = db.__getRecipient("rcpt_a1")!
    expect(r.encryptedEmail).not.toContain("alice") // encrypted at rest
    expect(db.__hasSecret("rcpt_a1")).toBe(true)
  })

  it("rejects a payload carrying a raw secret (invariant guard)", async () => {
    const body = { ...baseDrop("drop_raw"), shardA: "AAAA" }
    const res = await createDrop(jsonReq(body))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/raw secret/)
  })

  it("rejects a public drop that carries recipients", async () => {
    const body = { ...baseDrop("drop_pub"), distribution: "public" }
    const res = await createDrop(jsonReq(body))
    expect(res.status).toBe(400)
  })

  it("rejects a timelock drop missing tlockShardA", async () => {
    const body = { ...baseDrop("drop_nogate"), tlockShardA: undefined }
    const res = await createDrop(jsonReq(body))
    expect(res.status).toBe(400)
  })

  it("rejects a bad owner signature", async () => {
    const body = baseDrop("drop_badauth")
    body.auth.signature = hex(new Uint8Array(64)) // not a valid signature
    const res = await createDrop(jsonReq(body))
    expect(res.status).toBe(401)
  })
})

describe("GET /api/retrieve (atomic burn)", () => {
  async function arm(dropId: string) {
    await createDrop(jsonReq(baseDrop(dropId)))
  }
  const ctx = (dropId: string, recipientId: string) => ({
    params: Promise.resolve({ dropId, recipientId }),
  })

  it("returns 410 before the drop is released", async () => {
    await arm("drop_r1")
    const res = await retrieve(new Request("http://t"), ctx("drop_r1", "rcpt_a1"))
    expect(res.status).toBe(410)
  })

  it("returns locked material once released, then 410 on the second call (single-use)", async () => {
    await arm("drop_r2")
    await getDb().markReleased("drop_r2") // notifier confirmed the round published

    const first = await retrieve(new Request("http://t"), ctx("drop_r2", "rcpt_a1"))
    expect(first.status).toBe(200)
    const body = await first.json()
    expect(body.tlockShardA).toBe("tlock-armored-ciphertext")
    expect(body.wrappedShardB).toBe("d3JhcA==")
    // no raw secret in the response
    expect(JSON.stringify(body)).not.toMatch(/shardA"|"key"|rawSecret/)

    const second = await retrieve(new Request("http://t"), ctx("drop_r2", "rcpt_a1"))
    expect(second.status).toBe(410)
  })

  it("returns the same 410 for a nonexistent recipient (no oracle)", async () => {
    await arm("drop_r3")
    await getDb().markReleased("drop_r3")
    const res = await retrieve(new Request("http://t"), ctx("drop_r3", "rcpt_missing"))
    expect(res.status).toBe(410)
  })
})

describe("GET /api/public", () => {
  it("404 for a private drop; metadata for a public one", async () => {
    await createDrop(jsonReq(baseDrop("drop_priv")))
    const priv = await publicGet(new Request("http://t"), { params: Promise.resolve({ dropId: "drop_priv" }) })
    expect(priv.status).toBe(404)

    const pubBody = { ...baseDrop("drop_p1"), distribution: "public", recipients: [] }
    await createDrop(jsonReq(pubBody))
    const pub = await publicGet(new Request("http://t"), { params: Promise.resolve({ dropId: "drop_p1" }) })
    expect(pub.status).toBe(200)
    const body = await pub.json()
    expect(body.distribution).toBe("public")
    expect(body.tlockShardA).toBe("tlock-armored-ciphertext")
    expect(body.status).toBe("armed")
  })
})

describe("POST /api/drops/[dropId]/reset (optimistic concurrency)", () => {
  const ctx = (dropId: string) => ({ params: Promise.resolve({ dropId }) })

  it("resets when expectedOldRound matches, then 409 on a stale repeat", async () => {
    await createDrop(jsonReq(baseDrop("drop_reset1")))
    const body = (round: number) => ({
      tlockShardA: "new-ct",
      releaseRound: 5000,
      triggerAt: Date.now() + 86_400_000,
      expectedOldRound: round,
      auth: ownerAuth("drop_reset1"),
    })
    const ok = await reset(jsonReq(body(1000)), ctx("drop_reset1"))
    expect(ok.status).toBe(200)

    // stale expectedOldRound (still 1000, but the round is now 5000) → 409
    const stale = await reset(jsonReq(body(1000)), ctx("drop_reset1"))
    expect(stale.status).toBe(409)
  })

  it("409 when the drop is already released", async () => {
    await createDrop(jsonReq(baseDrop("drop_reset2")))
    await getDb().markReleased("drop_reset2")
    const res = await reset(
      jsonReq({
        tlockShardA: "x",
        releaseRound: 9000,
        triggerAt: Date.now(),
        expectedOldRound: 1000,
        auth: ownerAuth("drop_reset2"),
      }),
      ctx("drop_reset2"),
    )
    expect(res.status).toBe(409)
  })

  it("401 on a bad owner signature", async () => {
    await createDrop(jsonReq(baseDrop("drop_reset3")))
    const res = await reset(
      jsonReq({
        tlockShardA: "x",
        releaseRound: 9000,
        triggerAt: Date.now(),
        expectedOldRound: 1000,
        auth: { address: ownerAddr, chain: "aptos", publicKey: ownerPub, signature: hex(new Uint8Array(64)) },
      }),
      ctx("drop_reset3"),
    )
    expect(res.status).toBe(401)
  })
})
