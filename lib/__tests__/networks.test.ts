import { describe, it, expect, afterEach } from "vitest"
import { Network } from "@aptos-labs/ts-sdk"
import {
  fromWalletNetwork,
  storageAvailable,
  aptosNetworkFor,
  shelbyNetworkFor,
  isAppNetwork,
  APP_NETWORKS,
} from "@/lib/networks"

describe("networks config", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SHELBYNET_CHAIN_ID
  })

  it("maps standard wallet networks by name", () => {
    expect(fromWalletNetwork({ name: "shelbynet", chainId: 9 })).toBe("shelbynet")
    expect(fromWalletNetwork({ name: "testnet", chainId: 2 })).toBe("testnet")
    expect(fromWalletNetwork({ name: "mainnet", chainId: 1 })).toBe("mainnet")
    expect(fromWalletNetwork({ name: "devnet", chainId: 0 })).toBe("devnet")
    // case-insensitive
    expect(fromWalletNetwork({ name: "TESTNET" })).toBe("testnet")
  })

  it("returns null for a missing or unrecognized network", () => {
    expect(fromWalletNetwork(null)).toBeNull()
    expect(fromWalletNetwork(undefined)).toBeNull()
    expect(fromWalletNetwork({ name: "custom", chainId: 12345 })).toBeNull()
  })

  it("maps Shelbynet by chain id when surfaced as a custom network", () => {
    process.env.NEXT_PUBLIC_SHELBYNET_CHAIN_ID = "177"
    expect(fromWalletNetwork({ name: "custom", chainId: 177 })).toBe("shelbynet")
    expect(fromWalletNetwork({ name: "custom", chainId: 999 })).toBeNull()
  })

  it("only shelbynet + testnet have Shelby storage", () => {
    expect(storageAvailable("shelbynet")).toBe(true)
    expect(storageAvailable("testnet")).toBe(true)
    expect(storageAvailable("mainnet")).toBe(false)
    expect(storageAvailable("devnet")).toBe(false)
  })

  it("maps to the right Aptos network", () => {
    expect(aptosNetworkFor("shelbynet")).toBe(Network.SHELBYNET)
    expect(aptosNetworkFor("testnet")).toBe(Network.TESTNET)
    expect(aptosNetworkFor("mainnet")).toBe(Network.MAINNET)
    expect(aptosNetworkFor("devnet")).toBe(Network.DEVNET)
  })

  it("shelbyNetworkFor throws where Shelby has no presence", () => {
    expect(shelbyNetworkFor("shelbynet")).toBe(Network.SHELBYNET)
    expect(shelbyNetworkFor("testnet")).toBe(Network.TESTNET)
    expect(() => shelbyNetworkFor("mainnet")).toThrow()
    expect(() => shelbyNetworkFor("devnet")).toThrow()
  })

  it("isAppNetwork guards the four known networks", () => {
    for (const n of APP_NETWORKS) expect(isAppNetwork(n)).toBe(true)
    expect(isAppNetwork("ethereum")).toBe(false)
  })
})
