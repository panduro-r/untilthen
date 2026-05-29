import { describe, it, expect, beforeEach } from "vitest"
import { ed25519 } from "@noble/curves/ed25519.js"
import { dropId, recipientId, signerId, formatAddress, base64UrlEncode, base64UrlDecode } from "../ids"
import { verifySignature, aptosAddressFromPublicKey } from "../aptos"
import {
  uploadCiphertext,
  downloadCiphertext,
  listBlobs,
  chooseExpiration,
  type ShelbySigner,
} from "../shelby"
import { __resetMockStore } from "../shelby.mock"
import {
  setupSignerGroup,
  ibeEncryptToGroup,
  produceSignatureShare,
  ibeDecryptWithShares,
  MockMoveContractClient,
} from "../contract"
import { randomBytes } from "../crypto"

const hex = (b: Uint8Array) => Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("")

describe("ids", () => {
  it("generates correctly-prefixed unique ids", () => {
    expect(dropId()).toMatch(/^drop_[0-9a-f]{8}$/)
    expect(recipientId()).toMatch(/^rcpt_[0-9a-f]{8}$/)
    expect(signerId()).toMatch(/^sgnr_[0-9a-f]{8}$/)
    expect(dropId()).not.toBe(dropId())
  })
  it("formats addresses", () => {
    expect(formatAddress("0x7f3a2c81b9d4e5f6a7c8b9d0e1f2a3b4")).toBe("0x7f3a…a3b4")
  })
  it("base64url round-trips and is URL-safe (no +/= )", () => {
    const bytes = randomBytes(32)
    const encoded = base64UrlEncode(bytes)
    expect(encoded).not.toMatch(/[+/=]/)
    expect([...base64UrlDecode(encoded)]).toEqual([...bytes])
  })
})

describe("aptos signature verification", () => {
  it("verifies a valid Ed25519 signature bound to the derived address", async () => {
    const sk = ed25519.utils.randomSecretKey()
    const pk = ed25519.getPublicKey(sk)
    const publicKey = hex(pk)
    const address = aptosAddressFromPublicKey(publicKey)
    const message = "deaddrop:register:drop_abcd1234"
    const signature = hex(ed25519.sign(new TextEncoder().encode(message), sk))

    expect(await verifySignature({ address, chain: "aptos", message, signature, publicKey })).toBe(true)
  })

  it("rejects a tampered message", async () => {
    const sk = ed25519.utils.randomSecretKey()
    const publicKey = hex(ed25519.getPublicKey(sk))
    const address = aptosAddressFromPublicKey(publicKey)
    const signature = hex(ed25519.sign(new TextEncoder().encode("real message"), sk))
    expect(
      await verifySignature({ address, chain: "aptos", message: "forged message", signature, publicKey }),
    ).toBe(false)
  })

  it("rejects pubkey substitution (pubkey not bound to the registered address)", async () => {
    const sk = ed25519.utils.randomSecretKey()
    const publicKey = hex(ed25519.getPublicKey(sk))
    const message = "deaddrop:register:drop_x"
    const signature = hex(ed25519.sign(new TextEncoder().encode(message), sk))
    // valid signature, but the claimed address belongs to someone else
    const otherAddress = aptosAddressFromPublicKey(hex(ed25519.getPublicKey(ed25519.utils.randomSecretKey())))
    expect(
      await verifySignature({ address: otherAddress, chain: "aptos", message, signature, publicKey }),
    ).toBe(false)
  })

  it("returns false when pubkey is missing for aptos", async () => {
    expect(
      await verifySignature({ address: "0x1", chain: "aptos", message: "m", signature: "00" }),
    ).toBe(false)
  })

  it("throws for not-yet-supported chains", async () => {
    await expect(
      verifySignature({ address: "x", chain: "solana", message: "m", signature: "s" }),
    ).rejects.toThrow(/not supported/)
  })
})

describe("shelby mock storage", () => {
  const signer: ShelbySigner = { accountAddress: "0xowner" }
  beforeEach(() => __resetMockStore())

  it("uploads then downloads identical ciphertext", async () => {
    const ct = randomBytes(1024)
    await uploadCiphertext({ signer, ciphertext: ct, blobName: "deaddrop_drop_1", expirationMicros: chooseExpiration() })
    expect([...(await downloadCiphertext("deaddrop_drop_1"))]).toEqual([...ct])
  })

  it("blobs are immutable (re-upload same name throws)", async () => {
    await uploadCiphertext({ signer, ciphertext: randomBytes(8), blobName: "deaddrop_x", expirationMicros: chooseExpiration() })
    await expect(
      uploadCiphertext({ signer, ciphertext: randomBytes(8), blobName: "deaddrop_x", expirationMicros: chooseExpiration() }),
    ).rejects.toThrow(/immutable|already exists/)
  })

  it("lists blobs by account", async () => {
    await uploadCiphertext({ signer, ciphertext: randomBytes(8), blobName: "a", expirationMicros: chooseExpiration() })
    await uploadCiphertext({ signer: { accountAddress: "0xother" }, ciphertext: randomBytes(8), blobName: "b", expirationMicros: chooseExpiration() })
    const mine = await listBlobs({ account: "0xowner" })
    expect(mine.map((b) => b.name)).toEqual(["a"])
  })

  it("chooseExpiration overshoots the release time by >= 30 days", () => {
    const releaseAtMs = Date.now() + 60 * 86_400_000
    const exp = chooseExpiration(releaseAtMs)
    expect(exp).toBeGreaterThanOrEqual((releaseAtMs + 30 * 86_400_000) * 1000)
  })
})

describe("MoveContractClient mock (multisig release)", () => {
  it("end-to-end: createDrop → threshold approvals flip released → aggregate decrypts", async () => {
    const group = setupSignerGroup({ signerCount: 3, threshold: 2 })
    const did = "drop_chain01"
    const signers = ["0xs1", "0xs2", "0xs3"]
    const secret = randomBytes(32)
    const ibeHeader = await ibeEncryptToGroup({ secret, dropId: did, groupPubkey: group.groupPubkey })

    const client = new MockMoveContractClient()
    await client.createDrop({
      dropId: did,
      owner: "0xowner",
      mode: "multisig",
      distribution: "public",
      threshold: 2,
      signers,
      signerBlsPubkeys: group.signers.map((s) => s.blsPubkey),
      groupPubkey: group.groupPubkey,
      encKeyShares: group.signers.map((s) => s.shareScalar),
      ibeHeader,
    })

    // one approval — below threshold
    await client.approveRelease(did, "0xs1", produceSignatureShare({ dropId: did, shareScalar: group.signers[0].shareScalar, index: 1 }))
    expect((await client.getReleaseMaterial(did)).released).toBe(false)

    // second approval — threshold met
    await client.approveRelease(did, "0xs3", produceSignatureShare({ dropId: did, shareScalar: group.signers[2].shareScalar, index: 3 }))
    const material = await client.getReleaseMaterial(did)
    expect(material.released).toBe(true)

    const recovered = await ibeDecryptWithShares({ ibeHeader, dropId: did, shares: material.sigShares })
    expect([...recovered]).toEqual([...secret])
  })

  it("rejects an approval whose share fails BLS verification", async () => {
    const group = setupSignerGroup({ signerCount: 3, threshold: 2 })
    const outsider = setupSignerGroup({ signerCount: 1, threshold: 1 })
    const did = "drop_chain02"
    const client = new MockMoveContractClient()
    await client.createDrop({
      dropId: did,
      owner: "0xo",
      mode: "multisig",
      distribution: "private",
      threshold: 2,
      signers: ["0xs1", "0xs2", "0xs3"],
      signerBlsPubkeys: group.signers.map((s) => s.blsPubkey),
      groupPubkey: group.groupPubkey,
      encKeyShares: group.signers.map((s) => s.shareScalar),
      ibeHeader: await ibeEncryptToGroup({ secret: randomBytes(32), dropId: did, groupPubkey: group.groupPubkey }),
    })
    // forged: outsider's scalar in signer 0's slot
    const forged = produceSignatureShare({ dropId: did, shareScalar: outsider.signers[0].shareScalar, index: 1 })
    await expect(client.approveRelease(did, "0xs1", forged)).rejects.toThrow(/invalid signature share/)
  })

  it("rejects approval from a non-designated signer", async () => {
    const group = setupSignerGroup({ signerCount: 3, threshold: 2 })
    const did = "drop_chain03"
    const client = new MockMoveContractClient()
    await client.createDrop({
      dropId: did,
      owner: "0xo",
      mode: "multisig",
      distribution: "public",
      threshold: 2,
      signers: ["0xs1", "0xs2", "0xs3"],
      signerBlsPubkeys: group.signers.map((s) => s.blsPubkey),
      groupPubkey: group.groupPubkey,
      encKeyShares: group.signers.map((s) => s.shareScalar),
      ibeHeader: await ibeEncryptToGroup({ secret: randomBytes(32), dropId: did, groupPubkey: group.groupPubkey }),
    })
    await expect(
      client.approveRelease(did, "0xstranger", produceSignatureShare({ dropId: did, shareScalar: group.signers[0].shareScalar, index: 1 })),
    ).rejects.toThrow(/not a designated signer/)
  })
})
