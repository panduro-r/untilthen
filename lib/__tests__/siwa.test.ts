// SIWA (Sign In With Aptos) verification + session token round-trip.

import { describe, it, expect, beforeAll } from "vitest"
import { ed25519 } from "@noble/curves/ed25519.js"
import { siwaMessage, verifySiwa } from "../auth"
import { aptosAddressFromPublicKey } from "../aptos"

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex")

// Mirror how an Aptos wallet wraps a signed message (prefix + nonce), like the e2e wallet stub.
function signAsWallet(sk: Uint8Array, message: string) {
  const fullMessage = `APTOS\nmessage: ${message}\nnonce: deaddrop`
  return { fullMessage, signatureHex: hex(ed25519.sign(new TextEncoder().encode(fullMessage), sk)) }
}

describe("SIWA verification", () => {
  const sk = ed25519.utils.randomSecretKey()
  const pub = hex(ed25519.getPublicKey(sk))
  const address = aptosAddressFromPublicKey(pub)

  it("accepts a fresh, valid sign-in and returns the lowercased address", () => {
    const issuedAtMs = Date.now()
    const { fullMessage, signatureHex } = signAsWallet(sk, siwaMessage(address, issuedAtMs))
    const got = verifySiwa({ address, publicKey: pub, signature: signatureHex, fullMessage, issuedAtMs })
    expect(got).toBe(address.toLowerCase())
  })

  it("rejects a stale signature (older than 5 minutes)", () => {
    const issuedAtMs = Date.now() - 6 * 60 * 1000
    const { fullMessage, signatureHex } = signAsWallet(sk, siwaMessage(address, issuedAtMs))
    expect(verifySiwa({ address, publicKey: pub, signature: signatureHex, fullMessage, issuedAtMs })).toBeNull()
  })

  it("rejects a tampered signature", () => {
    const issuedAtMs = Date.now()
    const { fullMessage, signatureHex } = signAsWallet(sk, siwaMessage(address, issuedAtMs))
    const tampered = (signatureHex[0] === "a" ? "b" : "a") + signatureHex.slice(1)
    expect(verifySiwa({ address, publicKey: pub, signature: tampered, fullMessage, issuedAtMs })).toBeNull()
  })

  it("rejects when the claimed address doesn't match the public key", () => {
    const issuedAtMs = Date.now()
    const other = aptosAddressFromPublicKey(hex(ed25519.getPublicKey(ed25519.utils.randomSecretKey())))
    const { fullMessage, signatureHex } = signAsWallet(sk, siwaMessage(other, issuedAtMs))
    expect(verifySiwa({ address: other, publicKey: pub, signature: signatureHex, fullMessage, issuedAtMs })).toBeNull()
  })

  it("rejects a signature reused with a different issuedAt (message no longer matches)", () => {
    const issuedAtMs = Date.now()
    const { fullMessage, signatureHex } = signAsWallet(sk, siwaMessage(address, issuedAtMs))
    // Same signature, but claim a different timestamp → canonical message won't be contained.
    expect(verifySiwa({ address, publicKey: pub, signature: signatureHex, fullMessage, issuedAtMs: issuedAtMs + 1 })).toBeNull()
  })
})

describe("session token", () => {
  beforeAll(() => {
    process.env.AUTH_SESSION_SECRET ??= "test-session-secret-0123456789abcdef"
  })

  it("round-trips an address and rejects a garbage token", async () => {
    const { createSessionToken, verifySessionToken } = await import("../session")
    const token = await createSessionToken("0xABC123")
    expect(await verifySessionToken(token)).toBe("0xabc123")
    expect(await verifySessionToken("not-a-jwt")).toBeNull()
  })
})
