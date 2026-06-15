// lib/funding.ts — REAL balance checks + faucets for the connected wallet on Shelbynet.
//
// In the wallet-paid model the owner pays for their own storage, so the funding modal tops up the
// USER's wallet: APT (gas for register_blob) + ShelbyUSD (storage). Both come from the Shelby SDK
// faucets (fundAccountWithAPT / fundAccountWithShelbyUSD). The SDK is dynamically imported so it
// isn't bundled when funding isn't used.

import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk"

export type Balances = {
  apt: bigint // octas (1 APT = 1e8 octas)
  shelbyUsd: bigint // smallest unit — ShelbyUSD has 8 decimals, so 1e8 = $1 (verified on-chain)
}

// ShelbyUSD uses 8 decimals (0x1::fungible_asset::decimals == 8), i.e. 1e8 smallest units = $1.
const SHELBYUSD_UNIT = 100_000_000n // $1 in smallest units

const ONE_DAY_MICROS = 86_400_000_000

// Minimums to arm a small drop: a little gas + a little storage credit. Both are reachable from the
// Shelby faucet, which delivers ~0.1 per request (a few clicks max).
const MIN_APT_OCTAS = 5_000_000n // 0.05 APT
const MIN_SHELBY_SMALLEST = SHELBYUSD_UNIT / 10n // 0.1 ShelbyUSD ($0.10)
// The Shelby faucet caps each request at ~0.1 of either token, so request exactly that.
const APT_FAUCET_OCTAS = 10_000_000 // 0.1 APT
const SHELBY_FAUCET_SMALLEST = Number(SHELBYUSD_UNIT / 10n) // 0.1 ShelbyUSD

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

export { ONE_DAY_MICROS }
