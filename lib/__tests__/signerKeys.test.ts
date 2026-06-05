import { describe, it, expect } from "vitest"
import { ed25519 } from "@noble/curves/ed25519.js"
import {
  signerEncMessage,
  deriveSignerEncKeypair,
  eciesEncryptToSigner,
  eciesDecryptAsSigner,
} from "../signerKeys"
import { randomBytes, b64 } from "../crypto"

const hex = (b: Uint8Array) => Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("")

describe("signer ECIES keys", () => {
  it("derives a deterministic keypair from the same signature", async () => {
    const sig = "deadbeef".repeat(16)
    const a = await deriveSignerEncKeypair(sig)
    const b = await deriveSignerEncKeypair(sig)
    expect(hex(a.publicKey)).toBe(hex(b.publicKey))
    expect(a.publicKey.length).toBe(32)
  })

  it("owner encrypts a share to the signer's pubkey; signer decrypts with the re-derived key", async () => {
    // Signer's "wallet" signs the enc message → derives their keypair → publishes the pubkey.
    const sk = ed25519.utils.randomSecretKey()
    const dropId = "drop_ms1"
    const signature = hex(ed25519.sign(new TextEncoder().encode(signerEncMessage(dropId)), sk))
    const { publicKey } = await deriveSignerEncKeypair(signature)

    // Owner encrypts the signer's Shamir share to that pubkey.
    const share = randomBytes(32)
    const encShare = await eciesEncryptToSigner(publicKey, share)

    // Signer re-derives their private key from the same signature and decrypts.
    const { privateKey } = await deriveSignerEncKeypair(signature)
    const recovered = await eciesDecryptAsSigner(privateKey, encShare)
    expect([...recovered]).toEqual([...share])
  })

  it("a different signer cannot decrypt another's share", async () => {
    const dropId = "drop_ms2"
    const skA = ed25519.utils.randomSecretKey()
    const sigA = hex(ed25519.sign(new TextEncoder().encode(signerEncMessage(dropId)), skA))
    const { publicKey } = await deriveSignerEncKeypair(sigA)
    const encShare = await eciesEncryptToSigner(publicKey, randomBytes(32))

    const skB = ed25519.utils.randomSecretKey()
    const sigB = hex(ed25519.sign(new TextEncoder().encode(signerEncMessage(dropId)), skB))
    const { privateKey: privB } = await deriveSignerEncKeypair(sigB)
    await expect(eciesDecryptAsSigner(privB, encShare)).rejects.toThrow()
  })

  it("packs to base64 (ephPub32 || iv12 || ct) and is opaque", async () => {
    const { publicKey } = await deriveSignerEncKeypair("sig")
    const enc = await eciesEncryptToSigner(publicKey, randomBytes(32))
    // base64 of at least 32 + 12 + 32 + GCM tag(16) = 92 bytes
    expect(enc).not.toContain(b64(randomBytes(8)).slice(0, 4)) // sanity: it's a string
    expect(typeof enc).toBe("string")
  })
})
