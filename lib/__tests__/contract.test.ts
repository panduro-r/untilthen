import { describe, it, expect } from "vitest"
import {
  setupSignerGroup,
  ibeEncryptToGroup,
  produceSignatureShare,
  verifySignatureShare,
  ibeDecryptWithShares,
  type SignatureShare,
} from "../threshold"
import {
  generateKey,
  exportKey,
  importKey,
  encryptBytes,
  decryptBytes,
  randomBytes,
  xorBytes,
} from "../crypto"

const enc = (s: string) => new TextEncoder().encode(s)
const dropId = "drop_2of3abc"

function shareFor(group: ReturnType<typeof setupSignerGroup>, i: number): SignatureShare {
  return produceSignatureShare({
    dropId,
    shareScalar: group.signers[i].shareScalar,
    index: group.signers[i].index,
  })
}

describe("threshold BLS / IBE (multisig)", () => {
  it("exactly `threshold` shares recover the secret; the right combo decrypts", async () => {
    const group = setupSignerGroup({ signerCount: 3, threshold: 2 })
    const secret = randomBytes(32)
    const header = await ibeEncryptToGroup({ secret, dropId, groupPubkey: group.groupPubkey })

    const recovered = await ibeDecryptWithShares({
      ibeHeader: header,
      dropId,
      shares: [shareFor(group, 0), shareFor(group, 2)], // signers 1 and 3
    })
    expect([...recovered]).toEqual([...secret])
  })

  it("any threshold-sized subset of shares works (1+2, 2+3, 1+3)", async () => {
    const group = setupSignerGroup({ signerCount: 3, threshold: 2 })
    const secret = randomBytes(32)
    const header = await ibeEncryptToGroup({ secret, dropId, groupPubkey: group.groupPubkey })
    for (const [a, b] of [
      [0, 1],
      [1, 2],
      [0, 2],
    ]) {
      const out = await ibeDecryptWithShares({
        ibeHeader: header,
        dropId,
        shares: [shareFor(group, a), shareFor(group, b)],
      })
      expect([...out]).toEqual([...secret])
    }
  })

  it("fewer than `threshold` shares CANNOT decrypt", async () => {
    const group = setupSignerGroup({ signerCount: 3, threshold: 2 })
    const secret = randomBytes(32)
    const header = await ibeEncryptToGroup({ secret, dropId, groupPubkey: group.groupPubkey })
    await expect(
      ibeDecryptWithShares({ ibeHeader: header, dropId, shares: [shareFor(group, 0)] }),
    ).rejects.toThrow()
  })

  it("each signature share self-verifies against the signer's BLS pubkey", () => {
    const group = setupSignerGroup({ signerCount: 3, threshold: 2 })
    for (let i = 0; i < 3; i++) {
      const share = shareFor(group, i)
      expect(
        verifySignatureShare({ dropId, blsPubkey: group.signers[i].blsPubkey, share }),
      ).toBe(true)
    }
  })

  it("rejects a forged/non-signer share and a share for the wrong drop", () => {
    const group = setupSignerGroup({ signerCount: 3, threshold: 2 })
    // forged: an outsider's random scalar signed for signer 0's slot
    const outsider = setupSignerGroup({ signerCount: 1, threshold: 1 })
    const forged = produceSignatureShare({
      dropId,
      shareScalar: outsider.signers[0].shareScalar,
      index: group.signers[0].index,
    })
    expect(
      verifySignatureShare({ dropId, blsPubkey: group.signers[0].blsPubkey, share: forged }),
    ).toBe(false)

    // a valid share, but for a different drop id, must not verify here
    const wrongDrop = produceSignatureShare({
      dropId: "drop_other",
      shareScalar: group.signers[0].shareScalar,
      index: group.signers[0].index,
    })
    expect(
      verifySignatureShare({ dropId, blsPubkey: group.signers[0].blsPubkey, share: wrongDrop }),
    ).toBe(false)
  })

  it("wrong drop identity fails to decrypt even with enough shares", async () => {
    const group = setupSignerGroup({ signerCount: 3, threshold: 2 })
    const secret = randomBytes(32)
    const header = await ibeEncryptToGroup({ secret, dropId, groupPubkey: group.groupPubkey })
    const wrongShares = [
      produceSignatureShare({ dropId: "drop_wrong", shareScalar: group.signers[0].shareScalar, index: 1 }),
      produceSignatureShare({ dropId: "drop_wrong", shareScalar: group.signers[1].shareScalar, index: 2 }),
    ]
    await expect(
      ibeDecryptWithShares({ ibeHeader: header, dropId, shares: wrongShares }),
    ).rejects.toThrow()
  })

  it("duplicate signer indices are rejected (no count forgery)", async () => {
    const group = setupSignerGroup({ signerCount: 3, threshold: 2 })
    const secret = randomBytes(32)
    const header = await ibeEncryptToGroup({ secret, dropId, groupPubkey: group.groupPubkey })
    const dup = shareFor(group, 0)
    await expect(
      ibeDecryptWithShares({ ibeHeader: header, dropId, shares: [dup, dup] }),
    ).rejects.toThrow()
  })
})

describe("end-to-end multisig drops", () => {
  it("PRIVATE multisig: secret is shardA, recover K via shardA ⊕ shardB", async () => {
    const group = setupSignerGroup({ signerCount: 3, threshold: 2 })
    const key = await generateKey()
    const keyBytes = await exportKey(key)
    const shardB = randomBytes(32)
    const shardA = xorBytes(keyBytes, shardB) // gated secret
    const header = await ibeEncryptToGroup({ secret: shardA, dropId, groupPubkey: group.groupPubkey })
    const { ciphertext, iv } = await encryptBytes(enc("private multisig file").buffer as ArrayBuffer, key)

    const recoveredShardA = await ibeDecryptWithShares({
      ibeHeader: header,
      dropId,
      shares: [shareFor(group, 0), shareFor(group, 1)],
    })
    const recoveredKey = await importKey(xorBytes(recoveredShardA, shardB))
    expect(new TextDecoder().decode(await decryptBytes(ciphertext, iv, recoveredKey))).toBe(
      "private multisig file",
    )
  })

  it("PUBLIC multisig: secret IS K, no shardB", async () => {
    const group = setupSignerGroup({ signerCount: 5, threshold: 3 })
    const key = await generateKey()
    const keyBytes = await exportKey(key)
    const header = await ibeEncryptToGroup({ secret: keyBytes, dropId, groupPubkey: group.groupPubkey })
    const { ciphertext, iv } = await encryptBytes(enc("public multisig file").buffer as ArrayBuffer, key)

    const recoveredK = await ibeDecryptWithShares({
      ibeHeader: header,
      dropId,
      shares: [shareFor(group, 0), shareFor(group, 2), shareFor(group, 4)],
    })
    const recoveredKey = await importKey(recoveredK)
    expect(new TextDecoder().decode(await decryptBytes(ciphertext, iv, recoveredKey))).toBe(
      "public multisig file",
    )
  })
})
