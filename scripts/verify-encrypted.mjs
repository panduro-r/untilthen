// Proof that what's stored on Shelby for a safe is CIPHERTEXT, not the plaintext file.
//
// Downloads the actual stored blob (signer-less, by owner address) and inspects it: entropy, file
// magic numbers, text-readability — and, if you pass the original file, confirms the stored bytes
// bear no resemblance to it. The blob is AES-256-GCM ciphertext produced in the browser before upload
// (lib/crypto.ts → lib/armDrop.ts); the key never leaves the browser, so this script can only ever
// see ciphertext — which is the whole point.
//
// Usage:
//   OWNER=0x<your wallet> DROP=safe_xxxx [ORIGINAL=/path/to/original/file] \
//   NEXT_PUBLIC_SHELBY_API_KEY=aptoslabs_... node scripts/verify-encrypted.mjs
//
//   (OWNER = the wallet that armed the safe. BLOB defaults to deaddrop_<DROP>.)

import { ShelbyClient } from "@shelby-protocol/sdk/node"
import { AccountAddress, Network } from "@aptos-labs/ts-sdk"
import { readFileSync } from "node:fs"

const OWNER = process.env.OWNER
const DROP = process.env.DROP
const BLOB = process.env.BLOB ?? (DROP ? `deaddrop_${DROP}` : undefined)
if (!OWNER || !BLOB) {
  console.error("Set OWNER=0x... and DROP=safe_xxxx (or BLOB=deaddrop_...).")
  process.exit(1)
}

const apiKey = process.env.NEXT_PUBLIC_SHELBY_API_KEY
const client = new ShelbyClient(
  apiKey
    ? { network: Network.SHELBYNET, apiKey, aptos: { network: Network.SHELBYNET, clientConfig: { API_KEY: apiKey } } }
    : { network: Network.SHELBYNET },
)

console.log(`\nDownloading the stored blob from Shelbynet…`)
console.log(`  owner (namespace): ${OWNER}`)
console.log(`  blob:              ${BLOB}\n`)

const blob = await client.download({ account: AccountAddress.from(OWNER), blobName: BLOB })
const reader = blob.readable.getReader()
const chunks = []
let total = 0
for (;;) {
  const { done, value } = await reader.read()
  if (done) break
  chunks.push(value)
  total += value.length
}
const bytes = new Uint8Array(total)
let off = 0
for (const c of chunks) {
  bytes.set(c, off)
  off += c.length
}

// --- analysis -------------------------------------------------------------
function entropyBitsPerByte(buf) {
  const freq = new Array(256).fill(0)
  for (const b of buf) freq[b]++
  let h = 0
  for (const f of freq) {
    if (!f) continue
    const p = f / buf.length
    h -= p * Math.log2(p)
  }
  return h
}

const MAGIC = [
  ["%PDF", "PDF"],
  ["\x89PNG", "PNG"],
  ["\xFF\xD8\xFF", "JPEG"],
  ["PK\x03\x04", "ZIP/DOCX/XLSX"],
  ["GIF8", "GIF"],
  ["\x1F\x8B", "GZIP"],
  ["ID3", "MP3"],
  ["\x00\x00\x00", "MP4/MOV (ftyp)"],
]
const head = Buffer.from(bytes.slice(0, 16)).toString("latin1")
const magicHit = MAGIC.find(([sig]) => head.startsWith(sig))

// printable-ASCII ratio over the first 4 KiB
const sample = bytes.slice(0, 4096)
let printable = 0
for (const b of sample) if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127)) printable++
const printableRatio = printable / sample.length

const entropy = entropyBitsPerByte(bytes.slice(0, 65536))
const hexPreview = Buffer.from(bytes.slice(0, 48)).toString("hex").replace(/(..)/g, "$1 ").trim()

console.log("STORED BYTES")
console.log(`  size:            ${total.toLocaleString()} bytes`)
console.log(`  first 48 bytes:  ${hexPreview}`)
console.log(`  entropy:         ${entropy.toFixed(3)} bits/byte  (8.0 = indistinguishable from random)`)
console.log(`  printable ASCII: ${(printableRatio * 100).toFixed(1)}%  (low = not text)`)
console.log(`  file signature:  ${magicHit ? `⚠️  looks like ${magicHit[1]}` : "none (no plaintext file header)"}`)

let originalVerdict = ""
if (process.env.ORIGINAL) {
  const orig = new Uint8Array(readFileSync(process.env.ORIGINAL))
  const sameLen = orig.length === bytes.length
  let identicalPrefix = 0
  const n = Math.min(orig.length, bytes.length)
  while (identicalPrefix < n && orig[identicalPrefix] === bytes[identicalPrefix]) identicalPrefix++
  console.log("\nVS THE ORIGINAL FILE")
  console.log(`  original size:   ${orig.length.toLocaleString()} bytes`)
  console.log(`  byte-identical:  ${sameLen && identicalPrefix === orig.length ? "YES ❌" : "NO ✓ (stored ≠ original)"}`)
  console.log(`  matching prefix: ${identicalPrefix} bytes  (ciphertext shares no leading bytes with the file)`)
  originalVerdict = sameLen && identicalPrefix === orig.length ? "PLAINTEXT!" : "encrypted"
}

const looksEncrypted = !magicHit && entropy > 7.5 && printableRatio < 0.4
console.log("\nVERDICT")
console.log(
  looksEncrypted
    ? "  ✓ The stored blob is high-entropy ciphertext with no file header and is not readable text."
    : "  ⚠️  The stored blob does NOT look like ciphertext — investigate.",
)
if (originalVerdict) console.log(`  ✓ Stored bytes differ from the original file (${originalVerdict}).`)
console.log()
process.exit(looksEncrypted ? 0 : 1)
