"use client"

import { useEffect, useState } from "react"
import { X } from "lucide-react"
import { useWalletStore } from "@/store/wallet"
import { useUiStore } from "@/store/ui"
import {
  getBalances,
  requestAptFromFaucet,
  requestShelbyUsdFromFaucet,
  hasMinimumBalance,
  isTestNetwork,
  type Balances,
} from "@/lib/funding"
import { Button } from "@/components/ui"

const fmtApt = (octas: bigint) => (Number(octas) / 1e8).toFixed(4)
const fmtUsd = (smallest: bigint) => `$${(Number(smallest) / 1e8).toFixed(2)}` // ShelbyUSD is 8-decimal

export default function FundingModal() {
  const address = useWalletStore((s) => s.address)
  const network = useWalletStore((s) => s.network) ?? undefined
  const open = useUiStore((s) => s.fundingOpen)
  const close = useUiStore((s) => s.closeFunding)
  const [balances, setBalances] = useState<Balances | null>(null)
  const [status, setStatus] = useState<"idle" | "funding" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  // Refresh balances whenever the modal opens (guarded async fetch; cancel on unmount/close).
  useEffect(() => {
    if (!open || !address) return
    let cancelled = false
    getBalances(address, network)
      .then((b) => {
        if (!cancelled) setBalances(b)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [open, address, network])

  if (!open || !address || !isTestNetwork(network)) return null

  const refresh = async () => {
    if (address) setBalances(await getBalances(address, network))
  }

  const getFunds = async () => {
    setStatus("funding")
    setError(null)
    try {
      await Promise.all([requestAptFromFaucet(address, network), requestShelbyUsdFromFaucet(address, network)])
      // Poll until both confirm (faucet + indexer lag).
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 1500))
        await refresh()
        if (await hasMinimumBalance(address, network)) break
      }
      setStatus("idle")
    } catch (e) {
      console.error("[funding] faucet failed:", e)
      setError(e instanceof Error ? e.message : "Funding failed. Please try again.")
      setStatus("error")
    }
  }

  return (
    <div className="modal-veil" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="between" style={{ marginBottom: 6 }}>
          <h2 className="h-2">Get test funds</h2>
          <button className="btn btn-quiet btn-sm" onClick={close} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <p className="text-sm" style={{ marginBottom: 18 }}>
          Arming a safe costs a little gas (APT) and storage (ShelbyUSD). On a test network you can
          grab both for free.
        </p>

        <div className="card" style={{ padding: 18, marginBottom: 18, background: "var(--bg-2)" }}>
          <Balance label="APT (gas)" value={balances ? fmtApt(balances.apt) : "…"} />
          <div style={{ height: 10 }} />
          <Balance label="ShelbyUSD (storage)" value={balances ? fmtUsd(balances.shelbyUsd) : "…"} />
        </div>

        <Button onClick={getFunds} disabled={status === "funding"} style={{ width: "100%" }}>
          {status === "funding" ? "Funding…" : "Get test funds"}
        </Button>
        {error && <p className="text-sm" style={{ color: "var(--red)", marginTop: 12 }}>{error}</p>}
        <p className="text-xs muted" style={{ marginTop: 14 }}>
          You can also browse without funding. You&apos;ll just need funds before arming a safe.
        </p>
      </div>
    </div>
  )
}

function Balance({ label, value }: { label: string; value: string }) {
  return (
    <div className="between">
      <span className="text-sm">{label}</span>
      <span className="mono" style={{ fontSize: 14, color: "var(--text-1)" }}>{value}</span>
    </div>
  )
}
