"use client"

// Gates the create-safe flow to networks where Shelby storage exists (shelbynet/testnet). On
// mainnet/devnet — recognized but no Shelby yet — or an unknown network, it shows a "coming soon /
// switch network" prompt instead of the flow. Use INSIDE ConnectGate (assumes a connected wallet).
// Mirrors components/wallet/ConnectGate.

import type { ReactNode } from "react"
import { Globe } from "lucide-react"
import { useWalletStore } from "@/store/wallet"
import { NETWORKS, storageAvailable } from "@/lib/networks"

const prettify = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export default function NetworkGate({ children }: { children: ReactNode }) {
  const network = useWalletStore((s) => s.network)
  const rawName = useWalletStore((s) => s.rawNetworkName)

  if (network && storageAvailable(network)) return <>{children}</>

  const label = network ? NETWORKS[network].label : rawName ? prettify(rawName) : "this network"

  return (
    <div
      className="page page-narrow"
      style={{ paddingTop: 80, display: "flex", flexDirection: "column", alignItems: "center", gap: 14, textAlign: "center" }}
    >
      <span style={{ color: "var(--text-3)" }}>
        <Globe size={30} strokeWidth={1.2} />
      </span>
      <h1 className="h-1">Not on {label} yet</h1>
      <p className="text-body" style={{ maxWidth: 440 }}>
        Until Then stores your encrypted file on Shelby, which is live on <strong>Shelbynet</strong> and{" "}
        <strong>Testnet</strong>.{" "}
        {network
          ? `${label} doesn't have Shelby storage yet — this page will light up automatically when it does.`
          : "Your wallet is on a network we don't recognize."}{" "}
        Switch Petra to Shelbynet or Testnet to create a safe.
      </p>
    </div>
  )
}
