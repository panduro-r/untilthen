import { describe, it, expect, beforeAll } from "vitest"
import {
  roundForTime,
  timelockEncryptShardA,
  timelockDecryptShardA,
  latestRound,
} from "../timelock"
import { randomBytes } from "../crypto"

// These tests hit the live drand mainnet network. If it's unreachable, skip rather than fail —
// confidentiality logic is exercised; the network is drand's, not ours.
let online = false
let current = 0

beforeAll(async () => {
  try {
    current = await latestRound()
    online = current > 0
  } catch {
    online = false
  }
})

describe("timelock (drand)", () => {
  it("decrypting a PAST round succeeds and recovers the secret exactly", async () => {
    if (!online) return
    const secret = randomBytes(32)
    const pastRound = Math.max(1, current - 100) // definitely published
    const ct = await timelockEncryptShardA(secret, pastRound)
    const out = await timelockDecryptShardA(ct)
    expect([...out]).toEqual([...secret])
  })

  it("decrypting a FUTURE round throws (the lock working)", async () => {
    if (!online) return
    const secret = randomBytes(32)
    const futureRound = current + 10_000_000 // ~year+ away at 3s/round
    const ct = await timelockEncryptShardA(secret, futureRound)
    await expect(timelockDecryptShardA(ct)).rejects.toThrow()
  })

  it("roundForTime maps a future wall-clock time to a future round", async () => {
    if (!online) return
    const round = await roundForTime(Date.now() + 30 * 86_400_000) // 30 days out
    expect(round).toBeGreaterThan(current)
  })
})
