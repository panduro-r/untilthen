// lib/verifyEncryption.ts — in-browser proof that what's stored on Shelby is ciphertext.
//
// Downloads the actual stored blob (signer-less, by owner address — exactly what anyone could do) and
// inspects it: Shannon entropy, file-format header, text readability. AES-GCM ciphertext is
// high-entropy, header-less and unreadable; a real file would show a recognizable header and far
// lower entropy. This sees only ciphertext because the key never leaves the browser.

import { downloadCiphertext } from "@/lib/shelby"
import type { AppNetwork } from "@/lib/networks"

export type EncryptionCheck = {
  size: number
  entropyBitsPerByte: number // ~8.0 ⇒ indistinguishable from random
  printableRatio: number // 0..1, fraction of readable ASCII in a sample
  fileHeader: string | null // detected plaintext file type, or null
  hexPreview: string // first 32 bytes, hex
  looksEncrypted: boolean
}

function entropyBitsPerByte(buf: Uint8Array): number {
  const freq = new Array<number>(256).fill(0)
  for (const b of buf) freq[b]++
  let h = 0
  for (const f of freq) {
    if (!f) continue
    const p = f / buf.length
    h -= p * Math.log2(p)
  }
  return h
}

const MAGIC: [number[], string][] = [
  [[0x25, 0x50, 0x44, 0x46], "PDF"],
  [[0x89, 0x50, 0x4e, 0x47], "PNG"],
  [[0xff, 0xd8, 0xff], "JPEG"],
  [[0x50, 0x4b, 0x03, 0x04], "ZIP / DOCX / XLSX"],
  [[0x47, 0x49, 0x46, 0x38], "GIF"],
  [[0x1f, 0x8b], "GZIP"],
  [[0x49, 0x44, 0x33], "MP3"],
  [[0x52, 0x61, 0x72, 0x21], "RAR"],
]

export function analyzeBytes(bytes: Uint8Array): EncryptionCheck {
  const head = bytes.slice(0, 8)
  const fileHeader =
    MAGIC.find(([sig]) => sig.every((b, i) => head[i] === b))?.[1] ?? null

  const sample = bytes.slice(0, 4096)
  let printable = 0
  for (const b of sample) if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127)) printable++
  const printableRatio = sample.length ? printable / sample.length : 0

  const entropy = entropyBitsPerByte(bytes.slice(0, 65536))
  const hexPreview = Array.from(bytes.slice(0, 32))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ")

  const looksEncrypted = !fileHeader && entropy > 7.5 && printableRatio < 0.4
  return { size: bytes.length, entropyBitsPerByte: entropy, printableRatio, fileHeader, hexPreview, looksEncrypted }
}

/** Download the safe's stored blob from Shelby, analyze it, and return the raw bytes too. */
export async function verifyStoredEncryption(
  blobName: string,
  ownerAddress: string,
  network?: AppNetwork,
): Promise<{ check: EncryptionCheck; bytes: Uint8Array }> {
  const bytes = await downloadCiphertext(blobName, ownerAddress, network)
  return { check: analyzeBytes(bytes), bytes }
}
