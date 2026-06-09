// Real Shelbynet wallet-paid round-trip. Skipped unless RUN_SHELBY=1, because it needs a funded
// Shelbynet account (APT + ShelbyUSD). A raw Account stands in for the browser wallet's
// signAndSubmitTransaction. Run:
//
//   RUN_SHELBY=1 \
//   NEXT_PUBLIC_USE_SHELBY_MOCK=false \
//   NEXT_PUBLIC_SHELBY_NETWORK=shelbynet \
//   SHELBY_UPLOADER_PRIVATE_KEY=ed25519-priv-0x... \
//   npx vitest run lib/__tests__/shelby-real.test.ts
//
// Verifies: commitments + wallet-signed register_blob + address-only putBlob, then signer-less
// download (namespaced by the owner address) returns the same bytes.

import { describe, it, expect } from "vitest"
import { randomBytes } from "../crypto"
import {
  Account,
  Aptos,
  AptosConfig,
  Ed25519PrivateKey,
  Network,
  PrivateKey,
  PrivateKeyVariants,
} from "@aptos-labs/ts-sdk"

const RUN = !!process.env.RUN_SHELBY

describe.skipIf(!RUN)("Shelby real wallet-paid round-trip", () => {
  it("registers + uploads as the wallet, downloads byte-identical", async () => {
    const { uploadViaWallet } = await import("../shelby.real")
    const { downloadCiphertext } = await import("../shelby")

    const formatted = PrivateKey.formatPrivateKey(
      process.env.SHELBY_UPLOADER_PRIVATE_KEY!,
      PrivateKeyVariants.Ed25519,
    )
    const account = Account.fromPrivateKey({ privateKey: new Ed25519PrivateKey(formatted) })
    const aptos = new Aptos(new AptosConfig({ network: Network.SHELBYNET }))
    const ownerAddress = account.accountAddress.toString()

    // Stand in for the wallet adapter's signAndSubmitTransaction({ data }).
    const signAndSubmit = async (txn: { data: unknown }): Promise<{ hash: string }> => {
      const built = await aptos.transaction.build.simple({
        sender: account.accountAddress,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: txn.data as any,
      })
      const pending = await aptos.signAndSubmitTransaction({ signer: account, transaction: built })
      return { hash: pending.hash }
    }

    const ciphertext = randomBytes(4096)
    const blobName = `deaddrop_test_${Date.now()}`

    await uploadViaWallet({
      signAndSubmit,
      ownerAddress,
      ciphertext,
      blobName,
      expirationMicros: Date.now() * 1000 + 47 * 3_600_000_000, // ~47h, under the 48h cap
    })

    const got = await downloadCiphertext(blobName, ownerAddress)
    expect([...got]).toEqual([...ciphertext])
  }, 120_000)
})
