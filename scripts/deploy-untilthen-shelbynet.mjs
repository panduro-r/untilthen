// One-off: publish the renamed `until_then` Move module to Shelbynet via the TS SDK.
// The aptos CLI can't reach the Shelbynet gateway (it requires an Origin header), so we compile with
// the CLI (offline) and publish with the SDK (which carries the API key). Generates a fresh disposable
// deployer, funds it from the Shelby faucet, publishes, and inits the registry.
//
//   SHELBY_API_KEY=... node scripts/deploy-untilthen-shelbynet.mjs
//
// Reuse an existing deployer (e.g. to retry init) with DEPLOYER_PK=ed25519-priv-0x...

import { Account, Aptos, AptosConfig, Network, Ed25519PrivateKey, PrivateKey, PrivateKeyVariants } from "@aptos-labs/ts-sdk"
import { ShelbyClient } from "@shelby-protocol/sdk/browser"
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, writeFileSync } from "node:fs"

const API_KEY = process.env.SHELBY_API_KEY
if (!API_KEY) throw new Error("SHELBY_API_KEY required")

// The Shelbynet gateway requires an Origin header on most requests; the Node SDK doesn't send one
// by default, so set it explicitly (same value as an allowed app origin).
const ORIGIN = process.env.APP_ORIGIN || "https://untilthen.xyz"
const clientConfig = { API_KEY, HEADERS: { Origin: ORIGIN } }
const cfg = new AptosConfig({ network: Network.SHELBYNET, clientConfig })
const aptos = new Aptos(cfg)
const shelby = new ShelbyClient({ network: Network.SHELBYNET, apiKey: API_KEY, aptos: { network: Network.SHELBYNET, clientConfig } })

const deployer = process.env.DEPLOYER_PK
  ? Account.fromPrivateKey({ privateKey: new Ed25519PrivateKey(PrivateKey.formatPrivateKey(process.env.DEPLOYER_PK, PrivateKeyVariants.Ed25519)) })
  : Account.generate()
const addr = deployer.accountAddress.toString()
const pk = deployer.privateKey.toString()
console.log("Deployer address:", addr)
console.log("Deployer private key:", pk)
writeFileSync(".aptos/shelbynet-deployer.txt", `address=${addr}\nprivate_key=${pk}\n`)
console.log("(saved to .aptos/shelbynet-deployer.txt — gitignored)")

const balance = async () => {
  try { return Number(await aptos.getAccountAPTAmount({ accountAddress: addr })) } catch { return 0 }
}

// 1. Fund APT for gas (faucet caps ~0.1/tx). Aim for ~0.4 APT.
const TARGET = 40_000_000
for (let i = 0; i < 8 && (await balance()) < TARGET; i++) {
  try {
    await shelby.fundAccountWithAPT({ address: addr, amount: 10_000_000 })
    console.log(`  faucet call ${i + 1} → balance now ${(await balance()) / 1e8} APT`)
  } catch (e) {
    console.log("  faucet err:", e?.message || String(e))
  }
}
const bal = await balance()
console.log("Funded:", bal / 1e8, "APT")
if (bal < 5_000_000) throw new Error("Not enough APT to publish (need ~0.05+). Faucet may be rate-limited; retry with DEPLOYER_PK=" + pk)

// 2. Compile with the deployer as the named address (offline CLI, no shell — execFile).
console.log("Compiling…")
execFileSync("aptos", ["move", "compile", "--named-addresses", `until_then=${addr}`, "--save-metadata"], {
  cwd: "contracts/untilthen",
  stdio: "inherit",
})

// 3. Read package metadata + module bytecode.
const buildDir = "contracts/untilthen/build/UntilThen"
const metadataBytes = new Uint8Array(readFileSync(`${buildDir}/package-metadata.bcs`))
const modDir = `${buildDir}/bytecode_modules`
const mvFiles = readdirSync(modDir).filter((f) => f.endsWith(".mv"))
const moduleBytecode = mvFiles.map((f) => new Uint8Array(readFileSync(`${modDir}/${f}`)))
console.log("Modules:", mvFiles)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// maxGasAmount * gasUnitPrice is reserved upfront, so it must fit the balance (~0.8 APT). 700k units
// at ~100 octas = ~0.07 APT cap — affordable and far above the actual publish cost.
const txOpts = () => ({ maxGasAmount: 700_000, expireTimestamp: Math.floor(Date.now() / 1000) + 120 })

// 4. Publish (poll for the module rather than by_hash — Shelbynet inclusion is slow/flaky).
console.log("Publishing…")
const pubTxn = await aptos.publishPackageTransaction({ account: addr, metadataBytes, moduleBytecode, options: txOpts() })
const pub = await aptos.signAndSubmitTransaction({ signer: deployer, transaction: pubTxn })
console.log("  submitted:", pub.hash)
let published = false
for (let i = 0; i < 40 && !published; i++) {
  await sleep(3000)
  try {
    const mods = await aptos.getAccountModules({ accountAddress: addr })
    published = mods.some((m) => m.abi?.name === "until_then")
  } catch { /* keep polling */ }
  process.stdout.write(".")
}
console.log(published ? "\nPublished ✓" : "\nNOT published (timed out)")
if (!published) throw new Error(`Publish didn't commit. Retry with DEPLOYER_PK=${pk} (already funded). Last hash: ${pub.hash}`)

// 5. Init the registry (poll for the Registry resource).
console.log("Initializing registry…")
const initTxn = await aptos.transaction.build.simple({
  sender: addr,
  data: { function: `${addr}::until_then::init`, functionArguments: [] },
  options: txOpts(),
})
const init = await aptos.signAndSubmitTransaction({ signer: deployer, transaction: initTxn })
console.log("  submitted:", init.hash)
let inited = false
for (let i = 0; i < 40 && !inited; i++) {
  await sleep(3000)
  try {
    await aptos.getAccountResource({ accountAddress: addr, resourceType: `${addr}::until_then::Registry` })
    inited = true
  } catch { /* keep polling */ }
  process.stdout.write(".")
}
console.log(inited ? "\nRegistry initialized ✓" : "\nInit NOT confirmed (timed out)")
if (!inited) throw new Error(`Init didn't commit. Retry with DEPLOYER_PK=${pk}. Last hash: ${init.hash}`)

console.log("\n=== DONE ===")
console.log("CONTRACT ADDRESS:", addr)
console.log("Set NEXT_PUBLIC_DEADDROP_CONTRACT_ADDRESS to this in .env.local and on Vercel, then redeploy.")
