"use client"

import { useState, type ReactNode } from "react"
import { useWallet, PETRA_WALLET_NAME } from "@aptos-labs/wallet-adapter-react"
import { X } from "lucide-react"
import { useUiStore } from "@/store/ui"
import { PetraLogo, PhantomLogo, MetaMaskLogo, WalletConnectLogo } from "./WalletLogos"

type WalletOption = { name: string; label: string; logo: ReactNode; status?: string }

const COMING_SOON: WalletOption[] = [
  { name: "phantom", label: "Phantom", logo: <PhantomLogo />, status: "Coming soon" },
  { name: "metamask", label: "MetaMask", logo: <MetaMaskLogo />, status: "Coming soon" },
  { name: "walletconnect", label: "WalletConnect", logo: <WalletConnectLogo />, status: "Coming soon" },
]

export default function ConnectModal() {
  const { connect, wallets } = useWallet()
  const petraIcon = wallets.find((w) => w.name === PETRA_WALLET_NAME)?.icon
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
            <span className="wallet-icon" style={{ background: "transparent", padding: 0 }}>
              {petraIcon ? (
                // eslint-disable-next-line @next/next/no-img-element -- official wallet icon is a data: URI
                <img src={petraIcon} alt="" width={32} height={32} style={{ borderRadius: 8 }} />
              ) : (
                <PetraLogo />
              )}
            </span>
            <span style={{ flex: 1 }}>
              <span className="h-3">Petra</span>
              <div className="text-xs">Aptos · recommended</div>
            </span>
            <span className="text-xs" style={{ color: "var(--green)" }}>{busy ? "Connecting…" : "Available"}</span>
          </button>

          {COMING_SOON.map((w) => (
            <button key={w.name} className="wallet-row" disabled>
              <span className="wallet-icon" style={{ background: "transparent", padding: 0 }}>{w.logo}</span>
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
