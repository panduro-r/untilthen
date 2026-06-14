"use client"

import type { ReactNode } from "react"
import { Lock, Loader2 } from "lucide-react"
import { useWallet } from "@aptos-labs/wallet-adapter-react"
import { useWalletStore } from "@/store/wallet"
import { useUiStore } from "@/store/ui"
import { Button } from "@/components/ui"

// Wraps authed pages: renders children once a wallet is connected, else a connect prompt.
// "Connected" already implies a proven SIWA sign-in — WalletStateProvider only populates the store
// after ownership is signed — so a separate ownership gate is unnecessary here.
export default function ConnectGate({ children }: { children: ReactNode }) {
  const address = useWalletStore((s) => s.address)
  const { connected, isLoading } = useWallet()
  const openConnect = useUiStore((s) => s.openConnect)

  if (address) return <>{children}</>

  // On reload the adapter auto-reconnects and re-establishes the session from the cookie (no new
  // signature). Show a neutral loading state during that window instead of flashing "Connect wallet"
  // and back — which read as a spurious logout→login.
  if (isLoading || (connected && !address)) {
    return (
      <div
        className="page page-narrow"
        style={{ paddingTop: 100, display: "flex", flexDirection: "column", alignItems: "center", gap: 12, textAlign: "center" }}
      >
        <span className="spin" style={{ color: "var(--text-3)", display: "inline-flex" }}>
          <Loader2 size={24} strokeWidth={1.6} />
        </span>
        <p className="text-body" style={{ color: "var(--text-3)" }}>Reconnecting your wallet…</p>
      </div>
    )
  }

  return (
    <div
      className="page page-narrow"
      style={{ paddingTop: 80, display: "flex", flexDirection: "column", alignItems: "center", gap: 14, textAlign: "center" }}
    >
      <span style={{ color: "var(--text-3)" }}>
        <Lock size={30} strokeWidth={1.2} />
      </span>
      <h1 className="h-1">Connect your wallet</h1>
      <p className="text-body" style={{ maxWidth: 420 }}>
        Connecting asks you to sign a one-time ownership message. No gas, no transaction. We never see
        your private key.
      </p>
      <Button size="lg" onClick={openConnect}>Connect wallet</Button>
    </div>
  )
}
