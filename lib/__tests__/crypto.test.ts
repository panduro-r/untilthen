import { describe, it, expect } from "vitest"
import {
  generateKey,
  encryptBytes,
  decryptBytes,
  exportKey,
  importKey,
  xorBytes,
  randomBytes,
  hkdfExpand,
  deriveWalletWrapKey,
  registerMessage,
  fingerprintOf,
  b64,
  unb64,
  deriveOwnerTitleKey,
  encryptTitleForOwner,
  decryptTitleForOwner,
} from "../crypto"

const enc = (s: string) => new TextEncoder().encode(s)

describe("symmetric round-trip", () => {
  it("encryptBytes → decryptBytes preserves bytes exactly", async () => {
    const key = await generateKey()
    const data = enc("the owner's secret file contents 🔐")
    const { ciphertext, iv } = await encryptBytes(data.buffer as ArrayBuffer, key)
    const out = await decryptBytes(ciphertext, iv, key)
    expect(new TextDecoder().decode(out)).toBe("the owner's secret file contents 🔐")
  })

  it("export/import key round-trips", async () => {
    const key = await generateKey()
    const raw = await exportKey(key)
    expect(raw.length).toBe(32)
    const reimported = await importKey(raw)
    const data = enc("hello")
    const { ciphertext, iv } = await encryptBytes(data.buffer as ArrayBuffer, key)
    const out = await decryptBytes(ciphertext, iv, reimported)
    expect(new TextDecoder().decode(out)).toBe("hello")
  })

  it("AES-GCM tampering: flipping one ciphertext byte throws", async () => {
    const key = await generateKey()
    const { ciphertext, iv } = await encryptBytes(enc("integrity").buffer as ArrayBuffer, key)
    ciphertext[0] ^= 0x01
    await expect(decryptBytes(ciphertext, iv, key)).rejects.toThrow()
  })

  it("wrong key → GCM auth fails", async () => {
    const k1 = await generateKey()
    const k2 = await generateKey()
    const { ciphertext, iv } = await encryptBytes(enc("secret").buffer as ArrayBuffer, k1)
    await expect(decryptBytes(ciphertext, iv, k2)).rejects.toThrow()
  })
})

describe("fingerprint", () => {
  it("is stable across calls", async () => {
    const data = randomBytes(64)
    expect(await fingerprintOf(data)).toBe(await fingerprintOf(data))
  })
  it("formats as 4 groups of 8 hex chars", async () => {
    const fp = await fingerprintOf(enc("x"))
    expect(fp).toMatch(/^[0-9a-f]{8} [0-9a-f]{8} [0-9a-f]{8} [0-9a-f]{8}$/)
  })
})

describe("XOR shard math", () => {
  it("round-trips: xor(xor(a,b),b) === a", () => {
    const a = randomBytes(32)
    const b = randomBytes(32)
    expect([...xorBytes(xorBytes(a, b), b)]).toEqual([...a])
  })
  it("throws on length mismatch", () => {
    expect(() => xorBytes(randomBytes(32), randomBytes(16))).toThrow()
  })
})

describe("HKDF", () => {
  it("is deterministic for same secret+info", async () => {
    const secret = randomBytes(32)
    const a = await hkdfExpand(secret, "deaddrop-shardB", 32)
    const b = await hkdfExpand(secret, "deaddrop-shardB", 32)
    expect([...a]).toEqual([...b])
  })
  it("differs across info (domain separation)", async () => {
    const secret = randomBytes(32)
    const a = await hkdfExpand(secret, "info-a", 32)
    const b = await hkdfExpand(secret, "info-b", 32)
    expect([...a]).not.toEqual([...b])
  })
})

describe("email-recipient path (XOR wrap)", () => {
  it("wrap with HKDF(secret) then unwrap recovers shardB and the key", async () => {
    // arm
    const key = await generateKey()
    const keyBytes = await exportKey(key)
    const shardB = randomBytes(32)
    const shardA = xorBytes(keyBytes, shardB)
    const secret = randomBytes(32)
    const wrapKey = await hkdfExpand(secret, "deaddrop-shardB", 32)
    const wrappedShardB = xorBytes(shardB, wrapKey)

    // retrieve
    const wrapKey2 = await hkdfExpand(secret, "deaddrop-shardB", 32)
    const shardB2 = xorBytes(wrappedShardB, wrapKey2)
    const recovered = await importKey(xorBytes(shardA, shardB2))
    const { ciphertext, iv } = await encryptBytes(enc("payload").buffer as ArrayBuffer, key)
    const out = await decryptBytes(ciphertext, iv, recovered)
    expect(new TextDecoder().decode(out)).toBe("payload")
  })

  it("wrong secret → wrong key → decrypt throws", async () => {
    const key = await generateKey()
    const keyBytes = await exportKey(key)
    const shardB = randomBytes(32)
    const shardA = xorBytes(keyBytes, shardB)
    const wrapKey = await hkdfExpand(randomBytes(32), "deaddrop-shardB", 32)
    const wrappedShardB = xorBytes(shardB, wrapKey)

    const wrongWrap = await hkdfExpand(randomBytes(32), "deaddrop-shardB", 32)
    const badKey = await importKey(xorBytes(shardA, xorBytes(wrappedShardB, wrongWrap)))
    const { ciphertext, iv } = await encryptBytes(enc("x").buffer as ArrayBuffer, key)
    await expect(decryptBytes(ciphertext, iv, badKey)).rejects.toThrow()
  })
})

describe("wallet-recipient path (signature wrap)", () => {
  it("wrap with signature then unwrap with same signature recovers the key", async () => {
    const key = await generateKey()
    const keyBytes = await exportKey(key)
    const shardB = randomBytes(32)
    const shardA = xorBytes(keyBytes, shardB)
    const sig = "deadbeef".repeat(16) // deterministic registration signature (hex)
    const wrapKey = await deriveWalletWrapKey(sig)
    const wrappedShardB = xorBytes(shardB, wrapKey)

    const wrapKey2 = await deriveWalletWrapKey(sig)
    const recovered = await importKey(xorBytes(shardA, xorBytes(wrappedShardB, wrapKey2)))
    const { ciphertext, iv } = await encryptBytes(enc("wallet payload").buffer as ArrayBuffer, key)
    expect(new TextDecoder().decode(await decryptBytes(ciphertext, iv, recovered))).toBe(
      "wallet payload",
    )
  })

  it("deriveWalletWrapKey is deterministic and 32 bytes", async () => {
    const a = await deriveWalletWrapKey("abc123")
    const b = await deriveWalletWrapKey("abc123")
    expect(a.length).toBe(32)
    expect([...a]).toEqual([...b])
  })

  it("registerMessage is the fixed format", () => {
    expect(registerMessage("drop_abcd1234")).toBe("deaddrop:register:drop_abcd1234")
  })
})

describe("owner reset path", () => {
  it("ownerShardA + owner signature recovers shardA exactly", async () => {
    const shardA = randomBytes(32)
    const ownerSig = "owner-signature-hex-string"
    const wrapKey = await deriveWalletWrapKey(ownerSig)
    const ownerShardA = xorBytes(shardA, wrapKey)

    const recovered = xorBytes(ownerShardA, await deriveWalletWrapKey(ownerSig))
    expect([...recovered]).toEqual([...shardA])
  })
})

describe("base64 helpers", () => {
  it("round-trips arbitrary bytes", () => {
    const bytes = randomBytes(100)
    expect([...unb64(b64(bytes))]).toEqual([...bytes])
  })
})

describe("owner title key (metadata minimization)", () => {
  it("one drop-independent key decrypts many drops' titles", async () => {
    const titleKey = await deriveOwnerTitleKey("fixed-owner-signature")
    const e1 = await encryptTitleForOwner("Estate documents", titleKey, "drop_1111")
    const e2 = await encryptTitleForOwner("Emergency disclosure", titleKey, "drop_2222")
    expect(await decryptTitleForOwner(e1, titleKey, "drop_1111")).toBe("Estate documents")
    expect(await decryptTitleForOwner(e2, titleKey, "drop_2222")).toBe("Emergency disclosure")
  })

  it("wrong dropId (AAD) fails to decrypt", async () => {
    const titleKey = await deriveOwnerTitleKey("sig")
    const e1 = await encryptTitleForOwner("t", titleKey, "drop_aaaa")
    await expect(decryptTitleForOwner(e1, titleKey, "drop_bbbb")).rejects.toThrow()
  })

  it("ciphertext differs from plaintext and across drops", async () => {
    const titleKey = await deriveOwnerTitleKey("sig")
    const e1 = await encryptTitleForOwner("same", titleKey, "drop_a")
    const e2 = await encryptTitleForOwner("same", titleKey, "drop_b")
    expect(e1).not.toBe(e2)
    expect(e1).not.toContain("same")
  })
})
