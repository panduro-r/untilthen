// End-to-end orchestration test: drives the REAL owner-arm flow (lib/armDrop) and the REAL recipient
// retrieval (lib/decrypt) through the actual API route handlers, the Shelby mock, the crypto layer,
// and live drand — with a stubbed wallet (ed25519) instead of Petra. This covers the page-level glue
// that unit tests only exercise piece-by-piece. Hits drand; skips if offline.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"

// armDrop authorizes /api/drops from the SIWA session now (not a per-action signature). Stub the
// session; the address is filled in beforeAll to match the stub wallet so the create route's
// owner-match check passes. The route also requires same-origin, so the fetch router sets Origin.
const sessionStub = vi.hoisted(() => ({ address: "0xowner" }))
vi.mock("@/lib/session", () => ({ getSession: async () => ({ address: sessionStub.address }) }))
import { ed25519 } from "@noble/curves/ed25519.js"
import { armDrop } from "../armDrop"
import { retrievePrivate, fetchPublicMeta, retrievePublic } from "../decrypt"
import { useWalletStore } from "@/store/wallet"
import { __setDb, getDb } from "../db"
import { MockDb } from "../db.mock"
import { __resetMockStore } from "../shelby.mock"
import { generateKey, encryptBytes, exportKey, fingerprintOf, unb64 } from "../crypto"
import { base64UrlEncode } from "../ids"
import { aptosAddressFromPublicKey } from "../aptos"
import { latestRound } from "../timelock"
import type { Draft } from "@/store/draft"

process.env.EMAIL_ENC_KEY = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"
process.env.NEXT_PUBLIC_APP_URL = "http://test" // so the create route's same-origin check accepts the stub Origin

import { POST as createDrop } from "@/app/api/drops/route"
import { GET as retrieve } from "@/app/api/retrieve/[dropId]/[recipientId]/route"
import { GET as publicGet } from "@/app/api/public/[dropId]/route"

const hex = (b: Uint8Array) => Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("")
const PLAINTEXT = "Estate password: correct-horse-battery-staple 🔐"

let online = false
const realFetch = global.fetch

beforeAll(async () => {
  try {
    online = (await latestRound()) > 0
  } catch {
    online = false
  }

  // Minimal window for armDrop's public-link return.
  ;(globalThis as { window?: unknown }).window = { location: { origin: "http://test" } }

  // Route fetch("/api/...") calls to the real handlers; pass everything else (drand) through.
  global.fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    const parsed = new URL(url, "http://test")
    const path = parsed.pathname
    const abs = `http://test${path}${parsed.search}` // route handlers need an absolute URL
    const method = init?.method ?? "GET"
    if (path === "/api/drops" && method === "POST") {
      const headers = new Headers(init?.headers)
      headers.set("origin", "http://test") // same-origin check
      return createDrop(new Request(abs, { ...init, headers }))
    }
    let m: RegExpMatchArray | null
    if ((m = path.match(/^\/api\/retrieve\/([^/]+)\/([^/]+)$/))) {
      return retrieve(new Request(abs), { params: Promise.resolve({ dropId: m[1], recipientId: m[2] }) })
    }
    if ((m = path.match(/^\/api\/public\/([^/]+)$/))) {
      return publicGet(new Request(abs), { params: Promise.resolve({ dropId: m[1] }) })
    }
    return realFetch(input, init)
  }) as typeof fetch

  // Stub wallet (ed25519). signMessage mirrors an Aptos wallet: a deterministic fullMessage signature.
  const sk = ed25519.utils.randomSecretKey()
  const pub = hex(ed25519.getPublicKey(sk))
  const address = aptosAddressFromPublicKey(pub)
  sessionStub.address = address // make the stubbed session's owner match the arming wallet
  useWalletStore.getState().setConnected({
    address,
    publicKey: pub,
    walletName: "Stub",
    signMessageFn: async (message: string) => {
      const fullMessage = `APTOS\nmessage: ${message}\nnonce: deaddrop`
      return { signatureHex: hex(ed25519.sign(new TextEncoder().encode(fullMessage), sk)), fullMessage }
    },
    signAndSubmitFn: async () => ({ hash: "0xstub" }),
    disconnectFn: () => {},
  })
})

afterAll(() => {
  global.fetch = realFetch
  useWalletStore.getState().clear()
})

async function makeDraft(over: Partial<Draft>): Promise<Draft> {
  const file = new TextEncoder().encode(PLAINTEXT)
  const key = await generateKey()
  const { ciphertext, iv } = await encryptBytes(file.slice().buffer as ArrayBuffer, key)
  const keyBytes = await exportKey(key)
  const fingerprint = await fingerprintOf(ciphertext)
  return {
    dropId: `drop_e2e_${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`,
    fileMeta: { name: "estate.txt", size: file.length, type: "text/plain" },
    ciphertext,
    iv,
    keyBytes,
    fingerprint,
    distribution: "private",
    mode: "timelock",
    checkInHours: -1, // releaseAt in the past → a published drand round → decryptable immediately
    graceDays: 0,
    signers: [],
    threshold: 2,
    title: "E2E estate docs",
    recipients: [],
    publicAck: false,
    ...over,
  }
}

describe("end-to-end owner→recipient (time-lock)", () => {
  beforeAll(() => {
    __setDb(new MockDb())
    __resetMockStore()
  })

  it("PRIVATE: arm a drop, then an email recipient retrieves and decrypts the exact plaintext", async () => {
    if (!online) return
    const draft = await makeDraft({
      distribution: "private",
      recipients: [{ id: "rcpt_e2e", type: "email", name: "Alice", email: "alice@example.com" }],
    })
    const result = await armDrop(draft)
    expect(result.dropId).toBe(draft.dropId!)

    const db = getDb() as MockDb
    const stored = await db.getDrop(draft.dropId!)
    expect(stored?.mode).toBe("timelock")
    expect(stored?.encryptedTitle).toBeTruthy()
    expect(stored?.encryptedTitle).not.toContain("estate") // title encrypted at rest

    // The email link's URL-fragment secret is what the notifier would send; read it from the DB.
    const recips = await db.getRecipientsWithSecrets(draft.dropId!)
    expect(recips[0].encryptedEmail).not.toContain("alice") // email encrypted at rest
    const urlSecretB64Url = base64UrlEncode(unb64(recips[0].secret!))

    // Notifier confirms the round published.
    await db.markReleased(draft.dropId!)

    const recovered = await retrievePrivate({
      dropId: draft.dropId!,
      recipientId: "rcpt_e2e",
      urlSecretB64Url,
    })
    expect(new TextDecoder().decode(recovered)).toBe(PLAINTEXT)
  })

  it("PUBLIC: arm a public drop, then anyone self-unlocks and decrypts after release", async () => {
    if (!online) return
    const draft = await makeDraft({ distribution: "public", recipients: [] })
    const result = await armDrop(draft)
    expect(result.publicLink).toContain(`/p/${draft.dropId!}`)

    const db = getDb() as MockDb
    await db.markReleased(draft.dropId!)

    const meta = await fetchPublicMeta(draft.dropId!)
    expect(meta.distribution).toBe("public")
    const recovered = await retrievePublic(meta)
    expect(new TextDecoder().decode(recovered)).toBe(PLAINTEXT)
  })

  it("the burned private link can't be used twice", async () => {
    if (!online) return
    const draft = await makeDraft({
      distribution: "private",
      recipients: [{ id: "rcpt_twice", type: "email", name: "Bob", email: "bob@example.com" }],
    })
    await armDrop(draft)
    const db = getDb() as MockDb
    const secret = (await db.getRecipientsWithSecrets(draft.dropId!))[0].secret!
    await db.markReleased(draft.dropId!)
    const args = { dropId: draft.dropId!, recipientId: "rcpt_twice", urlSecretB64Url: base64UrlEncode(unb64(secret)) }

    expect(new TextDecoder().decode(await retrievePrivate(args))).toBe(PLAINTEXT)
    await expect(retrievePrivate(args)).rejects.toThrow(/no longer valid/i)
  })
})
