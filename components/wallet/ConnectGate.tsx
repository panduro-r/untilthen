"use client"

import type { ReactNode } from "react"
import { Lock } from "lucide-react"
import { useWalletStore } from "@/store/wallet"
import { useUiStore } from "@/store/ui"
import { Button } from "@/components/ui"

// Wraps authed pages: renders children once a wallet is connected, else a connect prompt.
export default function ConnectGate({ children }: { children: ReactNode }) {
  const address = useWalletStore((s) => s.address)
  const openConnect = useUiStore((s) => s.openConnect)

  if (address) return <>{children}</>

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
        Your wallet signs uploads and proves ownership. We never see your private key.
      </p>
      <Button size="lg" onClick={openConnect}>Connect wallet</Button>
    </div>
  )
}
