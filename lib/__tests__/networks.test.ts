import { describe, it, expect } from "vitest"
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

  it("maps Shelbynet (a custom network in Petra) by its chain id 114", () => {
    expect(fromWalletNetwork({ name: "custom", chainId: 114 })).toBe("shelbynet")
    expect(fromWalletNetwork({ name: "custom", chainId: 999 })).toBeNull()
  })

  it("maps Shelbynet by RPC url when chainId is stale right after a switch", () => {
    // After switching INTO Shelbynet, Petra reports name "custom" with the previous network's chainId.
    expect(fromWalletNetwork({ name: "custom", chainId: 2, url: "https://api.shelbynet.shelby.xyz/v1" })).toBe(
      "shelbynet",
    )
    expect(fromWalletNetwork({ name: "custom", url: "https://api.shelbynet.shelby.xyz/v1" })).toBe("shelbynet")
    expect(fromWalletNetwork({ name: "custom", url: "https://fullnode.testnet.aptoslabs.com/v1" })).toBeNull()
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
