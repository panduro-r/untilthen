// lib/aptos.ts — Aptos wallet bridge + cross-chain signature verification.
// All wallet-adapter interactions go through here (CLAUDE.md rule #6); components never touch
// window.aptos or adapter hooks directly.
//
// Signature-verification scope at launch: only Aptos (Petra) is functional. Solana/EVM recipient
// wallets are "Coming Soon" (ARCHITECTURE.md "Launch scope"), so their verifiers throw rather than
// ship an unbound/weak check. The Aptos path verifies Ed25519 AND binds the pubkey to the
// registered address (the address is derived from the pubkey), preventing pubkey substitution.

import { ed25519 } from "@noble/curves/ed25519.js"
import { sha3_256 } from "@noble/hashes/sha3.js"
import type { WalletChain } from "@/types"
import type { ShelbySigner } from "./shelby"

// --- hex helpers ---

function stripHex(s: string): string {
  return (s.startsWith("0x") || s.startsWith("0X") ? s.slice(2) : s).toLowerCase()
}

function hexToBytes(hex: string): Uint8Array {
  const clean = stripHex(hex)
  if (clean.length % 2 !== 0) throw new Error("odd-length hex")
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return out
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = ""
  for (const b of bytes) hex += b.toString(16).padStart(2, "0")
  return hex
}

// --- Aptos address derivation ---

/**
 * Aptos single-signer Ed25519 authentication key / address: sha3_256(pubkey || 0x00), hex with 0x.
 * (Scheme byte 0x00 = single Ed25519.)
 */
export function aptosAddressFromPublicKey(publicKeyHex: string): string {
  const pub = hexToBytes(publicKeyHex)
  const input = new Uint8Array(pub.length + 1)
  input.set(pub, 0)
  input[pub.length] = 0x00
  return "0x" + bytesToHex(sha3_256(input))
}

function normalizeAddress(addr: string): string {
  // Aptos addresses may be stored with leading-zero variation; compare on the stripped hex,
  // left-padded to 64 chars.
  return stripHex(addr).padStart(64, "0")
}

// --- signature verification ---

export type VerifyArgs = {
  address: string
  chain: WalletChain
  message: string
  signature: string
  /** Required for Ed25519 chains (Aptos). The adapter returns it alongside the signature. */
  publicKey?: string
}

/**
 * Verify a wallet signature over `message`. Used by /api/register and /api/register-signer to
 * validate that a registrant controls the claimed wallet.
 */
export async function verifySignature(args: VerifyArgs): Promise<boolean> {
  switch (args.chain) {
    case "aptos": {
      if (!args.publicKey) return false // Ed25519 verification needs the pubkey
      try {
        // Bind the pubkey to the registered address first — reject pubkey substitution.
        if (normalizeAddress(aptosAddressFromPublicKey(args.publicKey)) !== normalizeAddress(args.address)) {
          return false
        }
        return ed25519.verify(
          hexToBytes(args.signature),
          new TextEncoder().encode(args.message),
          hexToBytes(args.publicKey),
        )
      } catch {
        return false
      }
    }
    case "solana":
    case "ethereum":
      // Recipient wallets on these chains are Coming Soon at launch (Petra/Aptos only). Their
      // verifiers (Solana base58 binding, EVM ecrecover) land when those wallets are wired.
      throw new Error(`signature verification for ${args.chain} is not supported at launch`)
  }
}

/**
 * Verify an Aptos wallet signature over the EXACT message the wallet signed (`signedMessage` —
 * Aptos wraps the logical message with a prefix + nonce as `fullMessage`). Binds the pubkey to the
 * claimed address and requires `mustContain` to appear in the signed message, so the signer can't be
 * tricked into signing a different challenge. Used by owner-auth and the registration routes.
 */
export function verifyAptosSignedMessage(args: {
  address: string
  publicKey: string
  signedMessage: string
  signature: string
  mustContain: string
}): boolean {
  try {
    if (normalizeAddress(aptosAddressFromPublicKey(args.publicKey)) !== normalizeAddress(args.address)) {
      return false
    }
    if (!args.signedMessage.includes(args.mustContain)) return false
    return ed25519.verify(
      hexToBytes(args.signature),
      new TextEncoder().encode(args.signedMessage),
      hexToBytes(args.publicKey),
    )
  } catch {
    return false
  }
}

// --- wallet-adapter bridges (read live callbacks from the wallet store, populated by
//     WalletStateProvider from useWallet()). These are only meaningful client-side. ---

import { useWalletStore, type WalletSignResult } from "@/store/wallet"

const NOT_CONNECTED = "No wallet connected"

/**
 * Sign a message with the connected wallet. Returns lowercase hex, no 0x — STABLE across calls
 * (the bridge uses a fixed nonce), so it's a reproducible input to deriveWalletWrapKey.
 */
export async function signMessage(message: string): Promise<string> {
  const fn = useWalletStore.getState().signMessageFn
  if (!fn) throw new Error(NOT_CONNECTED)
  return (await fn(message)).signatureHex
}

/**
 * Like signMessage but also returns the `fullMessage` the wallet actually signed. Server-side
 * verification must verify the signature over `fullMessage` (Aptos wraps the message with a prefix
 * + nonce), not the bare message — see lib/auth + the register routes.
 */
export async function signMessageFull(message: string): Promise<WalletSignResult> {
  const fn = useWalletStore.getState().signMessageFn
  if (!fn) throw new Error(NOT_CONNECTED)
  return fn(message)
}

/** The signer for Shelby uploads — the connected wallet's signer, NOT a private-key Account. */
export function getWalletSigner(): ShelbySigner {
  const s = useWalletStore.getState()
  if (!s.address || !s.signAndSubmitFn) throw new Error(NOT_CONNECTED)
  return { accountAddress: s.address, signAndSubmitTransaction: s.signAndSubmitFn }
}

export async function disconnectWallet(): Promise<void> {
  useWalletStore.getState().disconnectFn?.()
}
