// lib/networks.ts — single source of truth for multi-network support.
//
// The app follows the WALLET's active network (see components/wallet/WalletStateProvider). Every
// network-dependent value (Aptos client network, Shelby storage network, deployed contract address,
// whether storage is even available) is resolved here, keyed by AppNetwork — replacing the old
// build-time NEXT_PUBLIC_APTOS_NETWORK / single-contract-address model.
//
// Shelby storage exists ONLY on shelbynet/testnet (verified: @shelby-protocol/sdk core/networks).
// Mainnet/devnet are recognized but flagged storageAvailable:false so the UI can show "coming soon".

import { Network } from "@aptos-labs/ts-sdk"

export type AppNetwork = "shelbynet" | "testnet" | "mainnet" | "devnet"

export const APP_NETWORKS = ["shelbynet", "testnet", "mainnet", "devnet"] as const satisfies readonly AppNetwork[]

/** Shelby's SDK only accepts these networks for storage/faucets. */
type ShelbyCapableNetwork = Network.LOCAL | Network.TESTNET | Network.SHELBYNET

type NetworkConfig = {
  /** Aptos SDK network for chain reads/writes. */
  aptos: Network
  /** Shelby SDK network for blob storage, or null where Shelby has no presence yet. */
  shelby: ShelbyCapableNetwork | null
  /** Deployed `until_then` module address on this network (env-provided), or null if undeployed. */
  contractAddress: string | null
  /** Whether Shelby blob storage is available — gates arming. */
  storageAvailable: boolean
  /** Human label for UI. */
  label: string
}

// NEXT_PUBLIC_* must be referenced by literal name so Next inlines them at build time (a dynamic
// process.env[key] is NOT inlined). NEXT_PUBLIC_DEADDROP_CONTRACT_ADDRESS is kept as the Shelbynet
// fallback so the existing live deployment works without new env vars.
const SHELBYNET_ADDR =
  process.env.NEXT_PUBLIC_CONTRACT_ADDRESS_SHELBYNET ??
  process.env.NEXT_PUBLIC_DEADDROP_CONTRACT_ADDRESS ??
  null
const TESTNET_ADDR = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS_TESTNET ?? null
const MAINNET_ADDR = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS_MAINNET ?? null
const DEVNET_ADDR = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS_DEVNET ?? null

export const NETWORKS: Record<AppNetwork, NetworkConfig> = {
  shelbynet: { aptos: Network.SHELBYNET, shelby: Network.SHELBYNET, contractAddress: SHELBYNET_ADDR, storageAvailable: true, label: "Shelbynet" },
  testnet: { aptos: Network.TESTNET, shelby: Network.TESTNET, contractAddress: TESTNET_ADDR, storageAvailable: true, label: "Testnet" },
  mainnet: { aptos: Network.MAINNET, shelby: null, contractAddress: MAINNET_ADDR, storageAvailable: false, label: "Mainnet" },
  devnet: { aptos: Network.DEVNET, shelby: null, contractAddress: DEVNET_ADDR, storageAvailable: false, label: "Devnet" },
}

export function isAppNetwork(s: string): s is AppNetwork {
  return (APP_NETWORKS as readonly string[]).includes(s)
}

export function aptosNetworkFor(n: AppNetwork): Network {
  return NETWORKS[n].aptos
}

export function shelbyNetworkFor(n: AppNetwork): ShelbyCapableNetwork {
  const s = NETWORKS[n].shelby
  if (!s) throw new Error(`Shelby storage isn't available on ${NETWORKS[n].label} yet.`)
  return s
}

/** Contract address for a network, or throw with a user-facing message if not deployed there. */
export function contractAddressFor(n: AppNetwork): string {
  const a = NETWORKS[n].contractAddress
  if (!a) throw new Error(`Until Then isn't deployed on ${NETWORKS[n].label} yet.`)
  return a
}

export function contractAddressOrNull(n: AppNetwork): string | null {
  return NETWORKS[n].contractAddress
}

export function storageAvailable(n: AppNetwork): boolean {
  return NETWORKS[n].storageAvailable
}

// Shelbynet's chain id. Petra surfaces Shelbynet as a "custom" network (name !== "shelbynet"), so we
// recognize it by chain id rather than name. Defaults to the known Shelbynet chain id (114) and is
// overridable via env in case Shelbynet resets to a new chain id.
const SHELBYNET_CHAIN_ID = (() => {
  const raw = process.env.NEXT_PUBLIC_SHELBYNET_CHAIN_ID
  return raw && raw.trim() ? Number(raw) : 114
})()

/**
 * Map the wallet adapter's reported network to an AppNetwork. Standard networks (mainnet/testnet/
 * devnet) surface by `name` (the Network enum string IS our AppNetwork value). Shelbynet is a custom
 * network in Petra (name: "custom"), so it's matched by chain id (SHELBYNET_CHAIN_ID above).
 * Returns null for an unsupported/unknown network (UI shows a "switch network" prompt).
 */
export function fromWalletNetwork(info: { name?: string; chainId?: number } | null | undefined): AppNetwork | null {
  if (!info) return null
  const name = info.name?.toLowerCase()
  if (name && isAppNetwork(name)) return name
  if (info.chainId === SHELBYNET_CHAIN_ID) return "shelbynet"
  return null
}
