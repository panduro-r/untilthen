// Live Shelbynet smoke test: generate an uploader account, fund it (APT + ShelbyUSD), upload a blob,
// download it back byte-identical, then exercise increase_expiration_time (renewal).
//   node scripts/shelby-smoke.mjs
// Prints the generated account's private key + address so it can be reused as SHELBY_UPLOADER_* env.
import { ShelbyClient, SHELBY_DEPLOYER } from "@shelby-protocol/sdk/node"
import { Account, Network } from "@aptos-labs/ts-sdk"
import { randomBytes } from "node:crypto"

const log = (...a) => console.log(...a)

const account = Account.generate()
log("uploader address:", account.accountAddress.toString())
log("uploader privkey :", account.privateKey.toString())

const client = new ShelbyClient({ network: Network.SHELBYNET })

log("\nfunding APT…")
log("  apt tx:", await client.fundAccountWithAPT({ address: account.accountAddress, amount: 100_000_000 }))
log("funding ShelbyUSD…")
log("  usd tx:", await client.fundAccountWithShelbyUSD({ address: account.accountAddress, amount: 1_000_000_000 }))

const data = new Uint8Array(randomBytes(4096))
const blobName = `deaddrop_smoke_${Date.now()}`
const expirationMicros = Date.now() * 1000 + 47 * 3_600_000_000 // ~47h, under the 48h cap

log("\nuploading", data.length, "bytes as", blobName, "…")
await client.upload({ blobData: data, signer: account, blobName, expirationMicros })
log("  upload OK")

log("downloading…")
const blob = await client.download({ account: account.accountAddress, blobName })
const reader = blob.readable.getReader()
const chunks = []
let total = 0
for (;;) {
  const { done, value } = await reader.read()
  if (done) break
  chunks.push(value); total += value.length
}
const out = new Uint8Array(total); let o = 0
for (const c of chunks) { out.set(c, o); o += c.length }
const identical = out.length === data.length && out.every((b, i) => b === data[i])
log("  download OK,", total, "bytes, identical:", identical)

log("\nrenewing via increase_expiration_time…")
const newExp = Date.now() * 1000 + 47 * 3_600_000_000
const txn = await client.aptos.transaction.build.simple({
  sender: account.accountAddress,
  data: {
    function: `${SHELBY_DEPLOYER.toString()}::blob_metadata::increase_expiration_time`,
    functionArguments: [blobName, newExp],
  },
})
const pending = await client.aptos.signAndSubmitTransaction({ signer: account, transaction: txn })
await client.aptos.waitForTransaction({ transactionHash: pending.hash })
log("  renew tx:", pending.hash)

log("\nALL OK:", identical ? "round-trip + renewal succeeded" : "ROUND-TRIP MISMATCH")
process.exit(identical ? 0 : 1)
