// lib/serverCrypto.ts — SERVER-ONLY symmetric encryption for metadata-at-rest.
//
// Recipient/signer email addresses are encrypted before storage and decrypted only in the notifier
// at send time, under EMAIL_ENC_KEY (server-only env, never in the DB, never NEXT_PUBLIC_). A DB
// dump therefore does not reveal who the recipients are (ARCHITECTURE.md "Metadata minimization").
//
// Do NOT import this into a "use client" file — EMAIL_ENC_KEY must never reach the browser.

import { b64, unb64 } from "./crypto"

function emailKeyBytes(): Uint8Array {
  const raw = process.env.EMAIL_ENC_KEY
  if (!raw) throw new Error("EMAIL_ENC_KEY is not set")
  // Accept base64 or hex; must decode to 32 bytes.
  const bytes = /^[0-9a-fA-F]{64}$/.test(raw) ? hexToBytes(raw) : unb64(raw)
  if (bytes.length !== 32) throw new Error("EMAIL_ENC_KEY must be 32 bytes (base64 or hex)")
  return bytes
}

async function emailKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", asArrayBuffer(emailKeyBytes()), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ])
}

/** Encrypt a plaintext email (or any short string) for storage. Returns base64(iv || ciphertext). */
export async function encryptAtRest(plaintext: string): Promise<string> {
  const key = await emailKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: asArrayBuffer(iv) },
      key,
      asArrayBuffer(new TextEncoder().encode(plaintext)),
    ),
  )
  const packed = new Uint8Array(iv.length + ct.length)
  packed.set(iv, 0)
  packed.set(ct, iv.length)
  return b64(packed)
}

/** Decrypt a value produced by encryptAtRest. Used only by the notifier at send time. */
export async function decryptAtRest(packedB64: string): Promise<string> {
  const key = await emailKey()
  const packed = unb64(packedB64)
  const iv = packed.slice(0, 12)
  const ct = packed.slice(12)
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: asArrayBuffer(iv) },
    key,
    asArrayBuffer(ct),
  )
  return new TextDecoder().decode(pt)
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(ab).set(bytes)
  return ab
}
