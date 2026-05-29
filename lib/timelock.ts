// lib/timelock.ts — thin wrapper over tlock-js (drand's Kudelski-audited timelock library).
// Kept separate from lib/crypto.ts so the drand dependency is isolated.
//
// tlock-js does hybrid encryption internally (only a small key is timelock-wrapped), so wrapping a
// 32-byte shardA/K is cheap. Works in-browser (drand's own timevault app proves this).

import { Buffer } from "buffer"
import {
  timelockEncrypt,
  timelockDecrypt,
  mainnetClient,
  roundAt,
  type ChainClient,
} from "tlock-js"

// drand mainnet timelock chain (G1 sigs, 3s frequency). The client carries the chain info.
const client: ChainClient = mainnetClient()

/**
 * Map a wall-clock release time (epoch ms) to a drand round number.
 * roundAt needs the chain info (genesis + period), which the client exposes.
 */
export async function roundForTime(releaseAtMs: number): Promise<number> {
  const info = await client.chain().info()
  return roundAt(releaseAtMs, info)
}

/**
 * Timelock-encrypt the gated secret (shardA or K) so it can only be recovered once `round`
 * publishes. Returns an armored string we store as tlockShardA.
 */
export async function timelockEncryptShardA(secret: Uint8Array, round: number): Promise<string> {
  return timelockEncrypt(round, Buffer.from(secret), client)
}

/**
 * Recover the gated secret. Throws if the round hasn't published yet — that's the lock working.
 */
export async function timelockDecryptShardA(tlockShardA: string): Promise<Uint8Array> {
  const plaintext = await timelockDecrypt(tlockShardA, client)
  return new Uint8Array(plaintext)
}

/** Latest published drand round (used by the notifier to detect release). */
export async function latestRound(): Promise<number> {
  const beacon = await client.latest()
  return beacon.round
}
