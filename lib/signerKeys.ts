// lib/signerKeys.ts — multisig signer encryption keys (owner-dealt group key delivery).
//
// In the owner-dealt model, the owner Shamir-splits the group BLS secret and must hand each signer
// their share secretly. We do this with ECIES to an X25519 key that the signer DERIVES from their
// own wallet signature (same wallet-bound pattern as the recipient wrap keys) — so it's reproducible
// across devices with no extra private-key storage. The signer publishes only the X25519 public key
// at registration; the owner encrypts that signer's share to it; the signer re-derives the private
// key from the same signature to decrypt at approval time.

import { x25519 } from "@noble/curves/ed25519.js"
import {
  deriveWalletWrapKey,
  hkdfExpand,
  importKey,
  encryptBytes,
  decryptBytes,
  randomBytes,
  b64,
  unb64,
} from "./crypto"

/**
 * The message a signer signs to derive their (deterministic) encryption keypair. WALLET-SCOPED, not
 * per-safe: a signer registers their key once and it is reused for every safe that names them (the
 * owner ECIES-deals each safe's share to the same key). MUST be byte-stable forever — the signer
 * re-signs the exact same text at approval time to re-derive the key that decrypts their share. The
 * `[v3]` tag is the version (v1 was per-safe; v2 said "stays on your device", which misleadingly
 * implied device-lock — the key is re-derivable from the wallet on any device). Bumping the tag or
 * any byte of this string changes the derived key and invalidates existing registrations.
 */
export function signerEncMessage(): string {
  return `Until Then — create your private signer key (derived in your browser, never uploaded; no transaction, no fee) [v3]`
}

export type SignerEncKeypair = { privateKey: Uint8Array; publicKey: Uint8Array }

/** Derive the signer's X25519 keypair from their wallet signature over signerEncMessage(). */
export async function deriveSignerEncKeypair(signature: string): Promise<SignerEncKeypair> {
  // SHA-256 of the signature gives 32 bytes; x25519 clamps internally.
  const privateKey = await deriveWalletWrapKey(signature)
  const publicKey = x25519.getPublicKey(privateKey)
  return { privateKey, publicKey }
}

async function eciesKey(shared: Uint8Array): Promise<CryptoKey> {
  return importKey(await hkdfExpand(shared, "deaddrop-ecies-v1", 32))
}

/** ECIES-encrypt a share to a signer's X25519 public key. Returns base64(ephPub32 || iv12 || ct). */
export async function eciesEncryptToSigner(recipientPublicKey: Uint8Array, plaintext: Uint8Array): Promise<string> {
  const ephPriv = x25519.utils.randomSecretKey()
  const ephPub = x25519.getPublicKey(ephPriv)
  const shared = x25519.getSharedSecret(ephPriv, recipientPublicKey)
  const key = await eciesKey(shared)
  const { ciphertext, iv } = await encryptBytes(plaintext.slice().buffer as ArrayBuffer, key)
  const packed = new Uint8Array(ephPub.length + iv.length + ciphertext.length)
  packed.set(ephPub, 0)
  packed.set(iv, ephPub.length)
  packed.set(ciphertext, ephPub.length + iv.length)
  return b64(packed)
}

/** ECIES-decrypt a share with the signer's X25519 private key. */
export async function eciesDecryptAsSigner(privateKey: Uint8Array, packedB64: string): Promise<Uint8Array> {
  const packed = unb64(packedB64)
  const ephPub = packed.slice(0, 32)
  const iv = packed.slice(32, 44)
  const ciphertext = packed.slice(44)
  const shared = x25519.getSharedSecret(privateKey, ephPub)
  const key = await eciesKey(shared)
  return decryptBytes(ciphertext, iv, key)
}

// Re-export for callers that build deterministic vectors / tests.
export { randomBytes }
