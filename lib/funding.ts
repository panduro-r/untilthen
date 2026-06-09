// lib/funding.ts — REAL balance checks + faucets for the connected wallet on Shelbynet.
//
// In the wallet-paid model the owner pays for their own storage, so the funding modal tops up the
// USER's wallet: APT (gas for register_blob) + ShelbyUSD (storage). Both come from the Shelby SDK
// faucets (fundAccountWithAPT / fundAccountWithShelbyUSD). The SDK is dynamically imported so it
// isn't bundled when funding isn't used.

import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk"

export type Balances = {
  apt: bigint // octas (1 APT = 1e8 octas)
  shelbyUsd: bigint // smallest unit (1e6 = $1)
}

const ONE_DAY_MICROS = 86_400_000_000

// Minimums to arm a small drop: a little gas + a little storage credit.
const MIN_APT_OCTAS = 5_000_000n // 0.05 APT
const MIN_SHELBY_SMALLEST = 1_000_000n // $1
const APT_FAUCET_OCTAS = 100_000_000 // request 1 APT
const SHELBY_FAUCET_SMALLEST = 100_000_000 // request $100 of ShelbyUSD

function networkName(): Network {
  switch (process.env.NEXT_PUBLIC_APTOS_NETWORK) {
    case "mainnet":
      return Network.MAINNET
    case "testnet":
      return Network.TESTNET
    case "devnet":
      return Network.DEVNET
    default:
      return Network.SHELBYNET
  }
}

/** The Shelby network for the SDK (faucets/storage). Only LOCAL|TESTNET|SHELBYNET are valid. */
function shelbyNetwork(): Network.LOCAL | Network.TESTNET | Network.SHELBYNET {
  switch ((process.env.NEXT_PUBLIC_SHELBY_NETWORK ?? "shelbynet").toLowerCase()) {
    case "testnet":
      return Network.TESTNET
    case "local":
      return Network.LOCAL
    default:
      return Network.SHELBYNET
  }
}

export function isTestNetwork(): boolean {
  return networkName() !== Network.MAINNET
}

function aptos(): Aptos {
  const apiKey = process.env.NEXT_PUBLIC_SHELBY_API_KEY
  return new Aptos(
    new AptosConfig({
      network: networkName(),
      ...(apiKey ? { clientConfig: { API_KEY: apiKey } } : {}),
    }),
  )
}

async function shelbyClient() {
  const { ShelbyClient } = await import("@shelby-protocol/sdk/browser")
  const network = shelbyNetwork()
  const apiKey = process.env.NEXT_PUBLIC_SHELBY_API_KEY
  return new ShelbyClient(
    apiKey
      ? { network, apiKey, aptos: { network, clientConfig: { API_KEY: apiKey } } }
      : { network },
  )
}

export async function getBalances(address: string): Promise<Balances> {
  const a = aptos()
  let apt = 0n
  let shelbyUsd = 0n
  try {
    apt = BigInt(await a.getAccountAPTAmount({ accountAddress: address }))
  } catch {
    apt = 0n // account not created yet
  }
  try {
    const { SHELBYUSD_FA_METADATA_ADDRESS } = await import("@shelby-protocol/sdk/browser")
    const [bal] = await a.view<[string]>({
      payload: {
        function: "0x1::primary_fungible_store::balance",
        typeArguments: ["0x1::fungible_asset::Metadata"],
        functionArguments: [address, SHELBYUSD_FA_METADATA_ADDRESS],
      },
    })
    shelbyUsd = BigInt(bal)
  } catch {
    shelbyUsd = 0n // no ShelbyUSD store yet
  }
  return { apt, shelbyUsd }
}

/** Fund the user's wallet with APT (gas) from the Shelby faucet. */
export async function requestAptFromFaucet(address: string): Promise<void> {
  const c = await shelbyClient()
  await c.fundAccountWithAPT({ address, amount: APT_FAUCET_OCTAS })
}

/** Fund the user's wallet with ShelbyUSD (storage) from the Shelby faucet. */
export async function requestShelbyUsdFromFaucet(address: string): Promise<void> {
  const c = await shelbyClient()
  await c.fundAccountWithShelbyUSD({ address, amount: SHELBY_FAUCET_SMALLEST })
}

export async function hasMinimumBalance(address: string): Promise<boolean> {
  const b = await getBalances(address)
  return b.apt >= MIN_APT_OCTAS && b.shelbyUsd >= MIN_SHELBY_SMALLEST
}

/** Rough upload-cost estimate. The real cost is metered by Shelby at register_blob time. */
export async function estimateUploadCost(args: {
  bytes: number
  durationDays: number
}): Promise<{ aptOctas: bigint; shelbyUsdSmallest: bigint }> {
  const mb = args.bytes / (1024 * 1024)
  const shelbyUsdSmallest = BigInt(Math.max(10_000, Math.ceil(mb * args.durationDays * 1000)))
  const aptOctas = 200_000n // ~0.002 APT
  return { aptOctas, shelbyUsdSmallest }
}

export { ONE_DAY_MICROS }
