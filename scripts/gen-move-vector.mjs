// Generates the BLS test vector embedded in contracts/deaddrop/sources/DeadDrop.move
// (test_verify_share_matches_offchain_vector). Run: `node scripts/gen-move-vector.mjs`
//
// It reproduces the EXACT off-chain signature path used by lib/threshold.ts — noble BLS12-381,
// MinPK (pubkey G1 / sig G2), the NUL hash-to-G2 DST, and the "deaddrop:approve:" identity prefix —
// so the on-chain Move `verify_share` (Aptos crypto_algebra hash-to-G2) can be asserted to agree
// with it. If you change the DST or identity prefix in lib/threshold.ts, regenerate and update the
// vector in the Move test.

import { bls12_381 as bls } from "@noble/curves/bls12-381.js"

const G1 = bls.G1.Point
const G2 = bls.G2.Point
const Fr = bls.fields.Fr
const DST = "BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_"
const PREFIX = "deaddrop:approve:"
const id = "drop_testvec"

const hex = (b) => Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("")

// Deterministic 1-of-1 group: a fixed group secret s. pubkey = s·G1, sig = s·hash_to_G2(prefix||id).
const s = Fr.create(0x515ec0deebadc0ffee1234567890abcdef1234567890abcdef1234567890abcdn % Fr.ORDER)
const pubkey = G1.BASE.multiply(s).toBytes(true)
const Q = bls.G2.hashToCurve(new TextEncoder().encode(PREFIX + id), { DST })
const sig = Q.multiply(s).toBytes(true)

// Self-check the pairing equation the Move verify_share computes: e(P, Q) == e(g1, sig).
const ok = bls.fields.Fp12.eql(bls.pairing(G1.BASE.multiply(s), Q), bls.pairing(G1.BASE, G2.fromBytes(sig)))

console.log("pairing self-check:", ok)
console.log("id:           ", id)
console.log("pubkey (G1):  ", hex(pubkey), `(${pubkey.length} bytes)`)
console.log("sig    (G2):  ", hex(sig), `(${sig.length} bytes)`)

// --- multisig vector: 3 signers over "drop_multisig" (for the Move entry-function test) ---
// On-chain verification is per-signer and threshold is just a count, so three independent fixed
// scalars suffice (the Shamir aggregation that needs related scalars is an off-chain concern,
// already covered by lib/__tests__/contract.test.ts).
const mid = "drop_multisig"
const Qm = bls.G2.hashToCurve(new TextEncoder().encode(PREFIX + mid), { DST })
const scalars = [0x11aa_bb01n, 0x22cc_dd02n, 0x33ee_ff03n].map((v) => Fr.create(v))
console.log("\nmultisig id:", mid)
scalars.forEach((v, i) => {
  console.log(`signer${i} pubkey:`, hex(G1.BASE.multiply(v).toBytes(true)))
  console.log(`signer${i} sig:   `, hex(Qm.multiply(v).toBytes(true)))
})
