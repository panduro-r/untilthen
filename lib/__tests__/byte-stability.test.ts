// Known-answer tests: pin the EXACT bytes of every derivation that existing safes depend on.
//
// The other crypto tests are round-trips (encrypt -> decrypt with the same code), so they still pass
// if a dependency upgrade or a refactor silently changes a derived key — and a changed key means every
// already-armed safe becomes unrecoverable, with no migration path (CLAUDE.md: key material must stay
// byte-stable forever). These vectors were generated with the libraries that armed the live safes
// (@noble/curves 2.2.0, tlock-js 0.9.0) before upgrading anything. The SHA-256 and HKDF vectors were
// additionally cross-checked against an independent RFC 5869 implementation. The randomized
// constructions (title AES-GCM, ECIES, IBE) pin a ciphertext produced by that code, so these tests
// prove today's code can still DECRYPT data written then.
//
// If one of these fails, do not update the vector: find what changed.

import { describe, it, expect } from "vitest"
import { deriveWalletWrapKey, hkdfExpand, deriveOwnerTitleKey, decryptTitleForOwner, b64 } from "../crypto"
import { deriveSignerEncKeypair, eciesDecryptAsSigner } from "../signerKeys"
import { produceSignatureShare, verifySignatureShare, ibeDecryptWithShares } from "../threshold"

const hex = (b: Uint8Array) => Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("")
const SIG = "a1".repeat(32) + "b2".repeat(32) // stands in for a 64-byte wallet signature (hex)
const DROP = "drop_kat"
const scalar = (n: number) => {
  const s = new Uint8Array(32)
  s[31] = n
  return b64(s)
}

describe("byte stability: wallet-signature-derived keys", () => {
  it("deriveWalletWrapKey (owner copy + signer ECIES private key) = SHA-256(utf8(signature))", async () => {
    expect(hex(await deriveWalletWrapKey(SIG))).toBe("ea20618bf8c89c9e8b0cab25d248d3963c6ea9c97c9940702f2ef5b2eca8ad99")
  })

  it("deriveSignerEncKeypair public key (X25519) — what every signer registered", async () => {
    expect(hex((await deriveSignerEncKeypair(SIG)).publicKey)).toBe("0ce17a6481e365eb31dc35a370c8b5ced44505f0268d77ac619e9e23ec9fe478")
  })

  it("owner title key: HKDF info 'deaddrop-title-key', and an existing title still decrypts", async () => {
    expect(hex(await hkdfExpand(new TextEncoder().encode(SIG), "deaddrop-title-key", 32))).toBe(
      "37b0bc77dea3f8eb13e5017a59bf4452d5cff208bb01821810b360a7795632b3",
    )
    const key = await deriveOwnerTitleKey(SIG)
    expect(await decryptTitleForOwner("JBhDzjPgIKE5msEWTM8oK9rE8TgIkIUmRvgUFpRWiccQiIFfmXugMYLwGo2uuN4=", key, DROP)).toBe("Letter to my sister")
  })
})

describe("byte stability: recipient + signer wrapping", () => {
  it("email recipient shardB wrap key: HKDF(urlSecret, 'deaddrop-shardB')", async () => {
    const urlSecret = new Uint8Array(32).map((_, i) => i)
    expect(hex(await hkdfExpand(urlSecret, "deaddrop-shardB", 32))).toBe("d8b131cb6669f38fb07a70718477d4d32c7c6dd00561d99e72403f2652c59ec4")
  })

  it("signer ECIES: a share sealed by the old code still opens", async () => {
    const { privateKey } = await deriveSignerEncKeypair(SIG)
    const pt = await eciesDecryptAsSigner(privateKey, "q/QPGettf1bSTNsgjaE146lFNiMB2xokV7MdsX62NUIoECJCxET3lnL9g5bpNKu2oVodP04DxuQnsA8TB7zBmi/JRQx1JA7AJvLSew==")
    expect(new TextDecoder().decode(pt)).toBe("share-scalar-kat")
  })
})

describe("byte stability: BLS identity hashing + IBE (must match the on-chain verifier)", () => {
  it("hash-to-G2 of the approval identity (scalar 1 => the share IS H(id))", () => {
    expect(produceSignatureShare({ dropId: DROP, shareScalar: scalar(1), index: 1 }).sig).toBe(
      "tfDqGpgnVafi0fpLKBFeEtdbMhq+2jmZKZqZ7l4HiI3XRH/2J8qydMheG2By+suqBzho8l78QVEhXR53B/L5RVIZnNHnCjR1sxKRQGLfSB5PKURKJbq/aYRT3UrhzbgM",
    )
  })

  it("a signature share for a fixed scalar", () => {
    expect(produceSignatureShare({ dropId: DROP, shareScalar: scalar(7), index: 1 }).sig).toBe(
      "q/CRVnIYYHo7EtiiJkCQJKMSLlou4DAVrhLmh/fBfWkht/iV0V2iFGZFOr7xXut5Df5/MnQBKhmhqwv7qjDox+ZeDkKm2bWZjHUcrQP/7fAOVqz3/kNONA+QBFtlQpdD",
    )
  })

  const shares = [
    { index: 1, sig: "jpmXgDTMmuXg/z/lORbajb2YqMC3cQpXNDwZkgiWxOVdIrGo6sfcOnrqucU/GA8BFbZVnuUpr/aVDUCMkI+STT4K7tWbJzJGdug3bJwjuHJ7+s5gPSwBL4z4QpDe2PC6" },
    { index: 3, sig: "gcSLUqQrCld4t5XAiX2qgvqsOocn+sL83U/ZryTDU+1xE41VcK7tAzz74QIMpMg2GTBTY0SgNyOrk/4yvDMXZGCmYnTUhXpKkb7UjpnrRlCIZqj8W8OO+mEAWAfc9jqF" },
  ]

  it("pinned shares still verify against their signers' BLS pubkeys", () => {
    expect(verifySignatureShare({ dropId: DROP, blsPubkey: "uLZbO4AtwhDU4QEizHfWTgjIevL+D42RCCQqbdTgBeQpo/0B9W5GGLeJPItcDfCp", share: shares[0] })).toBe(true)
    expect(verifySignatureShare({ dropId: DROP, blsPubkey: "l3HHBj7xgEyJDITf/BV7JofpNk/NsFzNC18L0PofTCUYKZNS5PmrpW9NIE0OsOB6", share: shares[1] })).toBe(true)
  })

  it("an IBE header written by the old code still decrypts from a 2-of-3 quorum", async () => {
    const secret = await ibeDecryptWithShares({
      ibeHeader: "eyJVIjoiajIrQVIwdGJYOE9VS1lTcjl3UzV4UG1PeVBGVFJEcERCZ1FRTGRlUldwSDY0VFRzKzhhNXNOOW0xUFhoSTBEQyIsIlYiOiI0eU1veWw2d1ZUeEFXV2ljZlRqWkJYaWNoTllVQU9BRjI4SlpwQ2IyRDlVPSIsIlciOiJ2QUtRZ3VMQmVZRURKSlFWdjZqQ3pjeGpaMnZPb1JiWjNMdnU0NTUxSHpNPSJ9",
      dropId: DROP,
      shares,
    })
    expect(hex(secret)).toBe("fffefdfcfbfaf9f8f7f6f5f4f3f2f1f0efeeedecebeae9e8e7e6e5e4e3e2e1e0")
  })
})

// Not pinned here: the drand time-lock (tlock-js timelockEncrypt/Decrypt). Decrypting a pinned
// ciphertext needs the beacon for its round, i.e. a network call. Its IBE core is the same
// Boneh-Franklin construction exercised by the IBE vector above.
