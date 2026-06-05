// lib/funding.ts — balance checks + testnet/devnet faucets.
//
// APT balance + faucet are REAL (Aptos ts-sdk). ShelbyUSD is mocked while the Shelby SDK is
// access-gated (uploads use lib/shelby.mock, so no real ShelbyUSD is spent) — tracked in
// localStorage so the funding UX is meaningful without a real token.

import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk"

export type Balances = {
  apt: bigint // octas (1 APT = 1e8 octas)
  shelbyUsd: bigint // smallest unit (mock)
}

const ONE_DAY_MICROS = 86_400_000_000

// Minimums to arm at least one ~10MB drop.
const MIN_APT_OCTAS = 5_000_000n // 0.05 APT — enough for several txns
const MIN_SHELBY_SMALLEST = 1_000_000n // mock threshold
const SHELBY_FAUCET_GRANT = 5_000_000n
const APT_FAUCET_OCTAS = 100_000_000 // 1 APT

function networkName(): Network {
  switch (process.env.NEXT_PUBLIC_APTOS_NETWORK) {
    case "mainnet":
      return Network.MAINNET
    case "devnet":
      return Network.DEVNET
    default:
      return Network.TESTNET
  }
}

export function isTestNetwork(): boolean {
  return networkName() !== Network.MAINNET
}

function client(): Aptos {
  return new Aptos(new AptosConfig({ network: networkName() }))
}

// --- mock ShelbyUSD (localStorage) ---
const SHELBY_KEY = "deaddrop:mock-shelbyusd"
function readMockShelby(): bigint {
  if (typeof window === "undefined") return 0n
  try {
    return BigInt(window.localStorage.getItem(SHELBY_KEY) ?? "0")
  } catch {
    return 0n
  }
}
function writeMockShelby(v: bigint): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(SHELBY_KEY, v.toString())
  } catch {
    /* ignore */
  }
}

export async function getBalances(address: string): Promise<Balances> {
  let apt = 0n
  try {
    const octas = await client().getAccountAPTAmount({ accountAddress: address })
    apt = BigInt(octas)
  } catch {
    // Account not funded / doesn't exist yet → 0.
    apt = 0n
  }
  return { apt, shelbyUsd: readMockShelby() }
}

/** Devnet: programmatic faucet. Testnet/mainnet: not programmatic — direct the user to the web faucet. */
export async function requestAptFromFaucet(address: string): Promise<void> {
  if (networkName() !== Network.DEVNET) {
    throw new Error(
      "Automatic funding is devnet-only. On testnet, get APT at https://aptos.dev/network/faucet.",
    )
  }
  await client().fundAccount({ accountAddress: address, amount: APT_FAUCET_OCTAS })
}

/** Mock ShelbyUSD faucet (the real one is https://docs.shelby.xyz/apis/faucet/shelbyusd). */
export async function requestShelbyUsdFromFaucet(_address: string): Promise<void> {
  writeMockShelby(readMockShelby() + SHELBY_FAUCET_GRANT)
}

export async function hasMinimumBalance(address: string): Promise<boolean> {
  const b = await getBalances(address)
  return b.apt >= MIN_APT_OCTAS && b.shelbyUsd >= MIN_SHELBY_SMALLEST
}

/** Rough upload-cost estimate (mock pricing; the real Shelby SDK exposes a quote helper). */
export async function estimateUploadCost(args: {
  bytes: number
  durationDays: number
}): Promise<{ aptOctas: bigint; shelbyUsdSmallest: bigint }> {
  // Mock model: storage ≈ $0.000002 / MB / day; gas ≈ a couple of txns.
  const mb = args.bytes / (1024 * 1024)
  const shelbyUsdSmallest = BigInt(Math.ceil(mb * args.durationDays * 2)) // smallest units (~1e6 = $1)
  const aptOctas = 200_000n // ~0.002 APT of gas
  return { aptOctas, shelbyUsdSmallest }
}

export { ONE_DAY_MICROS }
