// lib/threshold.ts — threshold BLS + Boneh–Franklin IBE for multisig drops.
//
// This is the SAME primitive as timelock (ARCHITECTURE.md "Aptos / Move integration"): a secret is
// IBE-encrypted to identity = dropId; a threshold of signer BLS signature shares over that identity
// aggregate into the IBE decryption key. We REUSE tlock-js's Kudelski-audited IBE
// (encryptOnG1/decryptOnG1) for the encrypt/decrypt and only add the threshold-BLS layer here.
//
// Scheme (minimal-pubkey BLS on BLS12-381):
//   - group secret  s ∈ Fr          (dealt by the owner, then discarded)
//   - group pubkey  P = s·G1         (48-byte compressed G1 = the IBE "master")
//   - signer i      share scalar s_i = poly(i+1), pubkey P_i = s_i·G1
//   - identity      Q = hashToG2("deaddrop:approve:"+dropId)   (DST below MUST match tlock's IBE)
//   - approval      sig_i = s_i·Q    (96-byte compressed G2 BLS signature share)
//   - aggregate     Σ λ_i·sig_i = s·Q  = the IBE decryption key for the identity
//
// IMPORTANT (correctness): the `shamir-secret-sharing` npm package splits over GF(256) bytewise,
// which is NOT additively homomorphic in Fr and so cannot support signature-share aggregation.
// Threshold BLS requires Shamir over the BLS scalar field Fr — implemented here.

import { bls12_381 as bls } from "@noble/curves/bls12-381.js"
import { encryptOnG1, decryptOnG1, type Ciphertext } from "tlock-js/crypto/ibe.js"
import { b64, unb64, randomBytes } from "./crypto"

// DST MUST equal the one hardcoded inside tlock-js encryptOnG1 (it hashes the identity to G2 with
// this tag), otherwise sig = s·Q won't be a valid IBE decryption key. Domain separation from drand
// comes from (a) the different target group and (b) the "deaddrop:approve:" identity prefix.
const IDENTITY_DST = "BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_"
const IDENTITY_PREFIX = "deaddrop:approve:"

const Fr = bls.fields.Fr
const G1 = bls.G1.Point
const G2 = bls.G2.Point
const ORDER = Fr.ORDER

export type SignerKeyMaterial = {
  index: number // Shamir x-coordinate (signer position + 1)
  shareScalar: string // base64 of the 32-byte secret share s_i (encrypted to the signer in prod)
  blsPubkey: string // base64 compressed G1 of P_i = s_i·G1 (used to verify approvals)
}

export type GroupSetup = {
  groupPubkey: string // base64 compressed G1 (the IBE master). The group secret is discarded.
  threshold: number
  signers: SignerKeyMaterial[]
}

export type SignatureShare = {
  index: number // which signer (Shamir x-coordinate)
  sig: string // base64 compressed G2 signature share over the identity
}

// --- group setup (owner-dealt) ---

/**
 * Generate a t-of-n signer group: a group BLS keypair, Shamir-split the secret over Fr across the
 * n signers, and return each signer's secret share + verification pubkey. The caller encrypts each
 * shareScalar to its signer and discards the master (we never return the group secret).
 */
export function setupSignerGroup(args: { signerCount: number; threshold: number }): GroupSetup {
  const { signerCount: n, threshold: t } = args
  if (t < 1 || t > n) throw new Error("threshold must be between 1 and signerCount")

  // poly(x) = s + a_1 x + ... + a_{t-1} x^{t-1}, all coeffs in Fr. a_0 = s = group secret.
  const coeffs: bigint[] = [randomScalar()]
  for (let i = 1; i < t; i++) coeffs.push(randomScalar())
  const s = coeffs[0]

  const groupPubkey = b64(G1.BASE.multiply(s).toBytes(true))

  const signers: SignerKeyMaterial[] = []
  for (let i = 0; i < n; i++) {
    const x = BigInt(i + 1) // never 0 (that's the secret)
    const si = evalPoly(coeffs, x)
    signers.push({
      index: i + 1,
      shareScalar: b64(scalarTo32(si)),
      blsPubkey: b64(G1.BASE.multiply(si).toBytes(true)),
    })
  }
  // s and coeffs fall out of scope here — the master is discarded.
  return { groupPubkey, threshold: t, signers }
}

// --- IBE encrypt to the group (same primitive as timelock) ---

/** IBE-encrypt a ≤32-byte secret (shardA or K) to identity = dropId under the group pubkey. */
export async function ibeEncryptToGroup(args: {
  secret: Uint8Array
  dropId: string
  groupPubkey: string
}): Promise<string> {
  const ct = await encryptOnG1(unb64(args.groupPubkey), identityBytes(args.dropId), args.secret)
  return serializeCiphertext(ct)
}

// --- signer approval ---

/** A signer produces their BLS signature share over the drop identity: sig_i = s_i·Q. */
export function produceSignatureShare(args: {
  dropId: string
  shareScalar: string
  index: number
}): SignatureShare {
  const si = scalarFrom(unb64(args.shareScalar))
  const Q = hashIdentityToG2(args.dropId)
  return { index: args.index, sig: b64(Q.multiply(si).toBytes(true)) }
}

/** Verify a signature share against the signer's registered BLS pubkey (the contract's check). */
export function verifySignatureShare(args: {
  dropId: string
  blsPubkey: string
  share: SignatureShare
}): boolean {
  try {
    const Pi = G1.fromBytes(unb64(args.blsPubkey))
    const sig = G2.fromBytes(unb64(args.share.sig))
    const Q = hashIdentityToG2(args.dropId)
    // e(P_i, Q) == e(G1, sig)  ⇔  sig = s_i·Q with P_i = s_i·G1
    const lhs = bls.pairing(Pi, Q)
    const rhs = bls.pairing(G1.BASE, sig)
    return bls.fields.Fp12.eql(lhs, rhs)
  } catch {
    return false
  }
}

// --- threshold decrypt ---

/**
 * Aggregate ≥ threshold signature shares into the IBE decryption key (s·Q) and IBE-decrypt the
 * header back to the secret. Uses the SAME decrypt routine as timelock.
 */
export async function ibeDecryptWithShares(args: {
  ibeHeader: string
  dropId: string
  shares: SignatureShare[]
}): Promise<Uint8Array> {
  const aggregated = aggregateShares(args.shares)
  return decryptOnG1(aggregated.toBytes(true), deserializeCiphertext(args.ibeHeader))
}

/** Lagrange-combine the shares at x=0 in the exponent: Σ λ_i·sig_i = s·Q. */
function aggregateShares(shares: SignatureShare[]) {
  if (shares.length === 0) throw new Error("no signature shares")
  const xs = shares.map((s) => BigInt(s.index))
  // reject duplicate indices (would make Lagrange singular / forge the count)
  if (new Set(xs.map(String)).size !== xs.length) throw new Error("duplicate signer indices")

  let acc = G2.ZERO
  for (const share of shares) {
    const lambda = lagrangeAtZero(xs, BigInt(share.index))
    const sig = G2.fromBytes(unb64(share.sig))
    // λ may be 0 only in degenerate inputs; multiply handles 1..r-1.
    acc = acc.add(sig.multiply(lambda))
  }
  return acc
}

// --- Shamir / Fr helpers ---

function evalPoly(coeffs: bigint[], x: bigint): bigint {
  // Horner's method in Fr.
  let acc = 0n
  for (let i = coeffs.length - 1; i >= 0; i--) {
    acc = Fr.add(Fr.mul(acc, x), coeffs[i])
  }
  return acc
}

/** Lagrange basis coefficient for x_i evaluated at 0: Π_{j≠i} x_j / (x_j - x_i), all in Fr. */
function lagrangeAtZero(xs: bigint[], xi: bigint): bigint {
  let num = 1n
  let den = 1n
  for (const xj of xs) {
    if (xj === xi) continue
    num = Fr.mul(num, xj)
    den = Fr.mul(den, Fr.sub(xj, xi))
  }
  return Fr.mul(num, Fr.inv(den))
}

function randomScalar(): bigint {
  // 48 bytes reduced mod ORDER → negligible modulo bias; reject 0.
  let v = scalarFrom(randomBytes(48))
  if (v === 0n) v = 1n
  return v
}

function scalarFrom(bytes: Uint8Array): bigint {
  let acc = 0n
  for (const b of bytes) acc = (acc << 8n) | BigInt(b)
  return Fr.create(acc % ORDER)
}

function scalarTo32(v: bigint): Uint8Array {
  const out = new Uint8Array(32)
  let n = v
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(n & 0xffn)
    n >>= 8n
  }
  return out
}

// --- identity ---

function identityBytes(dropId: string): Uint8Array {
  return new TextEncoder().encode(IDENTITY_PREFIX + dropId)
}

function hashIdentityToG2(dropId: string) {
  // hashToCurve lives on the curve object (bls.G2), not on the Point class.
  return bls.G2.hashToCurve(identityBytes(dropId), { DST: IDENTITY_DST })
}

// --- IBE ciphertext (de)serialization ---

function serializeCiphertext(ct: Ciphertext): string {
  return b64(
    new TextEncoder().encode(
      JSON.stringify({ U: b64(ct.U), V: b64(ct.V), W: b64(ct.W) }),
    ),
  )
}

function deserializeCiphertext(header: string): Ciphertext {
  const obj = JSON.parse(new TextDecoder().decode(unb64(header))) as {
    U: string
    V: string
    W: string
  }
  return { U: unb64(obj.U), V: unb64(obj.V), W: unb64(obj.W) }
}
