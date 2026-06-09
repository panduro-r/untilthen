// The byte analyzer behind the "Verify encryption" button: ciphertext vs plaintext.

import { describe, it, expect } from "vitest"
import { analyzeBytes } from "../verifyEncryption"
import { randomBytes } from "../crypto"

describe("analyzeBytes", () => {
  it("flags high-entropy random bytes (ciphertext) as encrypted", () => {
    const a = analyzeBytes(randomBytes(8192))
    expect(a.looksEncrypted).toBe(true)
    expect(a.fileHeader).toBeNull()
    expect(a.entropyBitsPerByte).toBeGreaterThan(7.5)
    expect(a.printableRatio).toBeLessThan(0.4)
  })

  it("detects a plaintext PDF header and does NOT call it encrypted", () => {
    const pdf = new TextEncoder().encode("%PDF-1.4\n" + "readable invoice text ".repeat(200))
    const a = analyzeBytes(pdf)
    expect(a.fileHeader).toBe("PDF")
    expect(a.looksEncrypted).toBe(false)
  })

  it("does NOT call plain readable text encrypted (low entropy, high printable)", () => {
    const text = new TextEncoder().encode("The quick brown fox jumps over the lazy dog. ".repeat(200))
    const a = analyzeBytes(text)
    expect(a.looksEncrypted).toBe(false)
    expect(a.printableRatio).toBeGreaterThan(0.9)
  })
})
