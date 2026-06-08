// Real Shelby network round-trip. Skipped unless RUN_SHELBY=1, because it needs a funded uploader
// account on Shelbynet (APT + ShelbyUSD) — gated during Early Access. Run:
//
//   RUN_SHELBY=1 \
//   NEXT_PUBLIC_USE_SHELBY_MOCK=false \
//   NEXT_PUBLIC_SHELBY_NETWORK=shelbynet \
//   NEXT_PUBLIC_SHELBY_UPLOADER_ADDRESS=0x... \
//   SHELBY_UPLOADER_PRIVATE_KEY=ed25519-priv-0x... \
//   npx vitest run lib/__tests__/shelby-real.test.ts
//
// Verifies the same ciphertext we upload (via the server uploader account) comes back byte-identical
// through the signer-less download path.

import { describe, it, expect } from "vitest"
import { randomBytes } from "../crypto"
import { Account, Ed25519PrivateKey, PrivateKey, PrivateKeyVariants } from "@aptos-labs/ts-sdk"

const RUN = !!process.env.RUN_SHELBY

describe.skipIf(!RUN)("Shelby real network round-trip", () => {
  // Upload via the real SDK wrapper directly (lib/shelby.real), download via the lib/shelby dispatch.
  // The /api/shelby/upload → lib/shelby.server chain (which imports "server-only", unimportable under
  // vitest) is exercised in the real Next runtime + scripts/shelby-smoke.mjs instead.
  it("uploads ciphertext and downloads it byte-identical", async () => {
    const { uploadWithAccount } = await import("../shelby.real")
    const { downloadCiphertext } = await import("../shelby")

    const formatted = PrivateKey.formatPrivateKey(
      process.env.SHELBY_UPLOADER_PRIVATE_KEY!,
      PrivateKeyVariants.Ed25519,
    )
    const account = Account.fromPrivateKey({ privateKey: new Ed25519PrivateKey(formatted) })

    const ciphertext = randomBytes(4096)
    const blobName = `deaddrop_test_${Date.now()}`

    await uploadWithAccount({
      account,
      ciphertext,
      blobName,
      expirationMicros: Date.now() * 1000 + 47 * 3_600_000_000, // ~47h, under the 48h cap
    })

    const got = await downloadCiphertext(blobName)
    expect([...got]).toEqual([...ciphertext])
  }, 120_000)
})
