// lib/crypto.ts — the most security-critical file.
//
// All Web Crypto API calls, XOR splitting, HKDF derivation, signature wrapping, and fingerprint
// generation live here. Components/routes call these named functions; they never inline crypto.
// See ARCHITECTURE.md "Encryption architecture". Plaintext is handled ONLY in the browser.

const REGISTER_MESSAGE_PREFIX = "deaddrop:register:"

// --- core symmetric ops (AES-256-GCM) ---

export async function generateKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ])
}

export async function encryptBytes(
  plaintext: ArrayBuffer,
  key: CryptoKey,
): Promise<{ ciphertext: Uint8Array; iv: Uint8Array }> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const buffer = await crypto.subtle.encrypt({ name: "AES-GCM", iv: bufferSource(iv) }, key, plaintext)
  return { ciphertext: new Uint8Array(buffer), iv }
}

export async function decryptBytes(
  ciphertext: Uint8Array,
  iv: Uint8Array,
  key: CryptoKey,
): Promise<Uint8Array> {
  const buffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bufferSource(iv) },
    key,
    bufferSource(ciphertext),
  )
  return new Uint8Array(buffer)
}

export async function exportKey(key: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.exportKey("raw", key))
}

export async function importKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", bufferSource(raw), { name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ])
}

// --- shard wrapping / combining ---

/** 32-byte (or any equal-length) XOR — used everywhere we wrap or unwrap a shard. */
export function xorBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length !== b.length) throw new Error("length mismatch")
  const out = new Uint8Array(a.length)
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i]
  return out
}

/** Random bytes (shardB, per-recipient secrets, IVs). */
export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n))
}

/** HKDF-Expand: turn a secret into a fixed-length key with a domain separator. */
export async function hkdfExpand(
  secret: Uint8Array,
  info: string,
  outputBytes: number,
): Promise<Uint8Array> {
  const ikm = await crypto.subtle.importKey("raw", bufferSource(secret), "HKDF", false, [
    "deriveBits",
  ])
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: bufferSource(new TextEncoder().encode(info)),
    },
    ikm,
    outputBytes * 8,
  )
  return new Uint8Array(bits)
}

/** Wallet path: derive a 32-byte unwrap key from a registration signature string. */
export async function deriveWalletWrapKey(signature: string): Promise<Uint8Array> {
  const sigBytes = new TextEncoder().encode(signature)
  const hash = await crypto.subtle.digest("SHA-256", bufferSource(sigBytes))
  return new Uint8Array(hash)
}

/** The deterministic message a wallet recipient signs during registration. */
export function registerMessage(dropId: string): string {
  return `${REGISTER_MESSAGE_PREFIX}${dropId}`
}

// --- fingerprint ---

export async function fingerprintOf(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", bufferSource(data))
  const hex = Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
  // 4 groups of 8 chars: "3f2a9c81 b9d4e5f6 a7c8b9d0 e1f2a3b4"
  return hex.match(/.{1,8}/g)!.slice(0, 4).join(" ")
}

// --- base64 helpers (all binary fields are base64 at the API/DB boundary) ---

export function b64(bytes: Uint8Array): string {
  let bin = ""
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  // btoa exists in browsers and modern Node globals.
  return btoa(bin)
}

export function unb64(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// --- metadata minimization: owner title encryption ---
//
// CRITICAL UX CONSTRAINT: the dashboard decrypts MANY titles at once, so the title key must NOT
// be per-drop (that would be one wallet-signature popup per drop). We derive ONE drop-independent
// owner title key from a single fixed-message signature (the message lives in lib/titleKey.ts,
// TITLE_KEY_MESSAGE — the single source of truth), cache it in memory for the session, and use it for
// all titles. dropId is used only as AES-GCM additional data, not in the key.

/** Derive the session-wide owner title key from the fixed-message signature. */
export async function deriveOwnerTitleKey(signature: string): Promise<CryptoKey> {
  const raw = await hkdfExpand(
    new TextEncoder().encode(signature),
    "deaddrop-title-key",
    32,
  )
  return crypto.subtle.importKey("raw", bufferSource(raw), { name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ])
}

export async function encryptTitleForOwner(
  title: string,
  titleKey: CryptoKey,
  dropId: string,
): Promise<string> {
  const iv = randomBytes(12)
  const buffer = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: bufferSource(iv),
      additionalData: bufferSource(new TextEncoder().encode(dropId)),
    },
    titleKey,
    bufferSource(new TextEncoder().encode(title)),
  )
  // Pack iv || ciphertext into one base64 blob.
  const ct = new Uint8Array(buffer)
  const packed = new Uint8Array(iv.length + ct.length)
  packed.set(iv, 0)
  packed.set(ct, iv.length)
  return b64(packed)
}

export async function decryptTitleForOwner(
  encryptedTitle: string,
  titleKey: CryptoKey,
  dropId: string,
): Promise<string> {
  const packed = unb64(encryptedTitle)
  const iv = packed.slice(0, 12)
  const ct = packed.slice(12)
  const buffer = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: bufferSource(iv),
      additionalData: bufferSource(new TextEncoder().encode(dropId)),
    },
    titleKey,
    bufferSource(ct),
  )
  return new TextDecoder().decode(buffer)
}

// --- internal ---

// Web Crypto's BufferSource requires an ArrayBuffer-backed view (lib.dom excludes SharedArrayBuffer
// and resizable buffers). Our bytes always originate from getRandomValues / new Uint8Array / atob —
// never shared memory — so a tight ArrayBuffer-backed view is correct. The `as` narrows the
// statically-widened ArrayBufferLike to ArrayBuffer, justified by the runtime instanceof check.
function bufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (
    bytes.buffer instanceof ArrayBuffer &&
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength
  ) {
    return bytes as Uint8Array<ArrayBuffer>
  }
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy
}
