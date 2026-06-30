"use client"

// Read-only badge showing the wallet's active network. The app follows the wallet, so this reflects
// the wallet's choice — it is NOT a selector. Green when storage is available (shelbynet/testnet),
// amber "soon" for recognized-but-unsupported (mainnet/devnet), red for an unknown network.

import { useWalletStore } from "@/store/wallet"
import { NETWORKS } from "@/lib/networks"

const prettify = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export default function NetworkBadge() {
  const address = useWalletStore((s) => s.address)
  const network = useWalletStore((s) => s.network)
  const rawName = useWalletStore((s) => s.rawNetworkName)

  if (!address) return null

  if (!network) {
    return (
      <span className="chip triggered" title="Switch your wallet to Shelbynet or Testnet">
        {rawName ? prettify(rawName) : "Unknown"} · unsupported
      </span>
    )
  }

  const cfg = NETWORKS[network]
  if (cfg.storageAvailable) {
    return <span className="chip ok" title={`Connected to ${cfg.label}`}>{cfg.label}</span>
  }
  return (
    <span className="chip armed" title={`${cfg.label} isn't supported yet — Shelby storage launches there later`}>
      {cfg.label} · soon
    </span>
  )
}
