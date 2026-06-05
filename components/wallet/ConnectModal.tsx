"use client"

import { useState } from "react"
import { useWallet, PETRA_WALLET_NAME } from "@aptos-labs/wallet-adapter-react"
import { X } from "lucide-react"
import { useUiStore } from "@/store/ui"

type WalletOption = { name: string; label: string; mark: string; markColor: string; status?: string }

const COMING_SOON: WalletOption[] = [
  { name: "phantom", label: "Phantom", mark: "P", markColor: "#ab9ff2", status: "Coming soon" },
  { name: "metamask", label: "MetaMask", mark: "M", markColor: "#e88a3a", status: "Coming soon" },
  { name: "walletconnect", label: "WalletConnect", mark: "W", markColor: "#3b99fc", status: "Coming soon" },
]

export default function ConnectModal() {
  const { connect } = useWallet()
  const open = useUiStore((s) => s.connectOpen)
  const onClose = useUiStore((s) => s.closeConnect)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!open) return null

  const connectPetra = async () => {
    setError(null)
    setBusy(true)
    try {
      await connect(PETRA_WALLET_NAME)
      onClose()
    } catch (e) {
      console.error("[wallet] connect failed:", e)
      setError("We couldn't connect to Petra. Make sure the extension is installed and unlocked.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-veil" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="between" style={{ marginBottom: 6 }}>
          <h2 className="h-2">Connect a wallet</h2>
          <button className="btn btn-quiet btn-sm" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <p className="text-sm" style={{ marginBottom: 18 }}>
          Your wallet signs uploads and proves ownership. We never see your private key.
        </p>

        <div className="stack-8">
          <button className="wallet-row" onClick={connectPetra} disabled={busy}>
            <span className="wallet-icon" style={{ background: "#2a2d3a", color: "#ffd699" }}>P</span>
            <span style={{ flex: 1 }}>
              <span className="h-3">Petra</span>
              <div className="text-xs">Aptos · recommended</div>
            </span>
            <span className="text-xs" style={{ color: "var(--green)" }}>{busy ? "Connecting…" : "Available"}</span>
          </button>

          {COMING_SOON.map((w) => (
            <button key={w.name} className="wallet-row" disabled>
              <span className="wallet-icon" style={{ background: "#2a2d3a", color: w.markColor }}>{w.mark}</span>
              <span style={{ flex: 1 }}>
                <span className="h-3">{w.label}</span>
              </span>
              <span className="text-xs muted">{w.status}</span>
            </button>
          ))}
        </div>

        {error && (
          <p className="text-sm" style={{ color: "var(--red)", marginTop: 14 }}>{error}</p>
        )}
      </div>
    </div>
  )
}
