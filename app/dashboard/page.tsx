"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Plus, Lock, ArrowRight, RefreshCw, Eye } from "lucide-react"
import { useDropsStore, type DropSummary } from "@/store/drops"
import { useWalletStore } from "@/store/wallet"
import { getTitleKey } from "@/lib/titleKey"
import { decryptTitleForOwner } from "@/lib/crypto"
import type { OwnerDropSummary } from "@/lib/db"
import { Eyebrow, Chip, Countdown, Button } from "@/components/ui"
import ConnectGate from "@/components/wallet/ConnectGate"

export default function DashboardPage() {
  // A connected wallet already implies a proven sign-in (WalletStateProvider), so the dashboard only
  // renders for a signed-in owner and can fetch its drops with the session cookie.
  return (
    <ConnectGate>
      <Dashboard />
    </ConnectGate>
  )
}

function Dashboard() {
  const drops = useDropsStore((s) => s.drops)
  const setDrops = useDropsStore((s) => s.setDrops)
  const address = useWalletStore((s) => s.address)

  const armed = drops.filter((d) => d.status === "armed").length
  const released = drops.filter((d) => d.status === "released").length
  const hasLockedTitles = drops.some((d) => d.encryptedTitle && !d.title)

  const [error, setError] = useState<string | null>(null)
  const [revealing, setRevealing] = useState(false)

  // Auto-load the owner's drops from the server (no popup — just the session cookie that connecting
  // established). Titles stay encrypted unless the title key is already cached (then decrypt silently).
  useEffect(() => {
    if (!address) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch("/api/drops")
        if (!res.ok) throw new Error(`drops ${res.status}`)
        const { drops: rows } = (await res.json()) as { drops: OwnerDropSummary[] }
        const cachedKey = useWalletStore.getState().titleKey // reveal silently if we already have it
        const prev = useDropsStore.getState().drops
        const summaries: DropSummary[] = await Promise.all(
          rows.map(async (r) => {
            const known = prev.find((d) => d.id === r.id)?.title // keep same-session plaintext titles
            let title = known ?? ""
            if (!title && cachedKey) {
              title = await decryptTitleForOwner(r.encryptedTitle, cachedKey, r.id).catch(() => "")
            }
            return {
              id: r.id,
              title,
              encryptedTitle: r.encryptedTitle,
              mode: r.mode,
              distribution: r.distribution,
              status: r.releasedAt ? "released" : ("armed" as DropSummary["status"]),
              triggerAt: r.triggerAt,
              recipientCount: r.recipientCount,
              created: r.createdAt,
            }
          }),
        )
        if (!cancelled) setDrops(summaries)
      } catch (e) {
        console.error("[dashboard] load failed:", e)
        if (!cancelled) setError("We couldn't load your safes. Reconnect your wallet and try again.")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [address, setDrops])

  // Reveal titles: one signature to derive the title key, then decrypt all locked titles.
  const revealTitles = useCallback(async () => {
    setRevealing(true)
    setError(null)
    try {
      const titleKey = await getTitleKey()
      const current = useDropsStore.getState().drops
      const next = await Promise.all(
        current.map(async (d) =>
          d.encryptedTitle && !d.title
            ? { ...d, title: await decryptTitleForOwner(d.encryptedTitle, titleKey, d.id).catch(() => "") }
            : d,
        ),
      )
      setDrops(next)
    } catch (e) {
      console.error("[dashboard] reveal titles failed:", e)
      setError("We couldn't decrypt your titles. Try again.")
    } finally {
      setRevealing(false)
    }
  }, [setDrops])

  return (
    <div className="page">
      <div className="between" style={{ flexWrap: "wrap", gap: 18, marginBottom: 24 }}>
        <div className="stack-8">
          <Eyebrow>Your safes</Eyebrow>
          <h1 className="h-1">Dashboard</h1>
        </div>
        <Link href="/new/encrypt" className="btn btn-primary">
          <Plus size={14} strokeWidth={2} /> New safe
        </Link>
      </div>

      {error && <p className="text-sm" style={{ color: "var(--red)", marginBottom: 20 }}>{error}</p>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 32 }}>
        <StatCard label="Active" value={armed} tone="amber" />
        <StatCard label="Released" value={released} tone={released ? "red" : "default"} />
        <StatCard label="Total safes" value={drops.length} />
      </div>

      <div className="card" style={{ overflow: "hidden" }}>
        <div className="between" style={{ padding: "16px 22px", borderBottom: "1px solid var(--line-1)" }}>
          <h3 className="h-3">All safes</h3>
          <div className="row" style={{ alignItems: "center", gap: 12 }}>
            {hasLockedTitles && (
              <Button size="sm" variant="ghost" onClick={revealTitles} disabled={revealing}>
                <Eye size={12} strokeWidth={2} /> {revealing ? "Decrypting…" : "Show titles"}
              </Button>
            )}
            <div className="text-xs">{drops.length} item{drops.length !== 1 ? "s" : ""}</div>
          </div>
        </div>
        {drops.length === 0 ? (
          <div style={{ padding: 56, textAlign: "center" }}>
            <span style={{ color: "var(--text-3)" }}><Lock size={28} strokeWidth={1.2} /></span>
            <div className="h-2" style={{ marginTop: 14, fontWeight: 400 }}>Nothing sealed yet</div>
            <p className="text-sm" style={{ marginTop: 6 }}>
              Encrypt your first file, or sync to load safes you armed elsewhere.
            </p>
            <Link href="/new/encrypt" className="btn btn-primary" style={{ marginTop: 18 }}>
              <Plus size={14} strokeWidth={2} /> New safe
            </Link>
          </div>
        ) : (
          drops.map((d) => <DropRow key={d.id} drop={d} />)
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "amber" | "red" }) {
  const color = tone === "amber" ? "var(--amber)" : tone === "red" ? "var(--red)" : "var(--text-1)"
  return (
    <div className="card" style={{ padding: 22 }}>
      <div className="text-xs" style={{ textTransform: "uppercase", letterSpacing: "0.12em" }}>{label}</div>
      <div style={{ fontFamily: "var(--font-serif)", fontSize: 48, lineHeight: 1.1, marginTop: 8, color }}>{value}</div>
    </div>
  )
}

function DropRow({ drop }: { drop: DropSummary }) {
  return (
    <Link href={`/drop/${drop.id}`} className="drop-row">
      <div>
        <div className="center" style={{ gap: 12, marginBottom: 6 }}>
          {drop.title ? (
            <span className="title">{drop.title}</span>
          ) : drop.encryptedTitle ? (
            <span className="title" style={{ color: "var(--text-3)", display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Lock size={12} strokeWidth={2} /> Encrypted title
            </span>
          ) : (
            <span className="title">Untitled safe</span>
          )}
          {drop.status === "armed" && <Chip tone="armed">Armed</Chip>}
          {drop.status === "released" && <Chip tone="released">Released</Chip>}
          {drop.status === "expired" && <Chip tone="expired">Expired</Chip>}
        </div>
        <div className="meta">
          <span className="mono">{drop.id}</span>
          {" · "}
          {drop.distribution === "public" ? "Public link" : `${drop.recipientCount} recipient${drop.recipientCount !== 1 ? "s" : ""}`}
          {" · "}
          {drop.mode === "timelock" ? "Time-lock" : "Multisig"}
        </div>
      </div>

      <div style={{ textAlign: "right" }}>
        {drop.status === "armed" && drop.mode === "timelock" && drop.triggerAt && (
          <>
            <div className="text-xs" style={{ marginBottom: 4 }}>Releases in</div>
            <Countdown to={drop.triggerAt} />
          </>
        )}
        {drop.status === "released" && <div className="text-xs" style={{ color: "var(--red)" }}>Released</div>}
      </div>

      <div className="row" style={{ gap: 8, alignItems: "center" }}>
        {drop.status === "armed" && drop.mode === "timelock" && (
          <span className="btn btn-ghost btn-sm"><RefreshCw size={12} strokeWidth={2} /> Reset</span>
        )}
        <span className="btn btn-quiet btn-sm">Open <ArrowRight size={12} strokeWidth={2} /></span>
      </div>
    </Link>
  )
}
