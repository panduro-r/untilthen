"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Plus, Lock, ArrowRight, RefreshCw, Shield } from "lucide-react"
import { useDropsStore, type DropSummary } from "@/store/drops"
import { useSessionStore } from "@/store/session"
import { refreshSession, signIn } from "@/lib/sessionClient"
import { getTitleKey } from "@/lib/titleKey"
import { decryptTitleForOwner } from "@/lib/crypto"
import { formatAddress } from "@/lib/ids"
import type { OwnerDropSummary } from "@/lib/db"
import { Eyebrow, Chip, Countdown, Button } from "@/components/ui"
import ConnectGate from "@/components/wallet/ConnectGate"

export default function DashboardPage() {
  return (
    <ConnectGate>
      <Dashboard />
    </ConnectGate>
  )
}

function Dashboard() {
  const drops = useDropsStore((s) => s.drops)
  const setDrops = useDropsStore((s) => s.setDrops)
  const sessionAddress = useSessionStore((s) => s.address)
  const sessionReady = useSessionStore((s) => s.ready)

  const armed = drops.filter((d) => d.status === "armed").length
  const released = drops.filter((d) => d.status === "released").length

  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!sessionReady) void refreshSession()
  }, [sessionReady])

  // Sign in if needed (one signature), then fetch + decrypt the owner's drops from the server.
  const sync = useCallback(async () => {
    setStatus("loading")
    setError(null)
    try {
      if (!useSessionStore.getState().address) await signIn()
      const res = await fetch("/api/drops")
      if (!res.ok) throw new Error(`drops ${res.status}`)
      const { drops: rows } = (await res.json()) as { drops: OwnerDropSummary[] }
      const titleKey = await getTitleKey()
      const summaries: DropSummary[] = await Promise.all(
        rows.map(async (r) => ({
          id: r.id,
          title: await decryptTitleForOwner(r.encryptedTitle, titleKey, r.id).catch(() => ""),
          mode: r.mode,
          distribution: r.distribution,
          status: r.releasedAt ? "released" : "armed",
          triggerAt: r.triggerAt,
          recipientCount: r.recipientCount,
          created: r.createdAt,
        })),
      )
      setDrops(summaries)
      setStatus("idle")
    } catch (e) {
      console.error("[dashboard] sync failed:", e)
      setError("We couldn't load your drops. Try signing in again.")
      setStatus("error")
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
          <Plus size={14} strokeWidth={2} /> New drop
        </Link>
      </div>

      {/* Session bar: sign in to load drops from the server (works across devices). */}
      <div
        className="card between"
        style={{ padding: "12px 18px", marginBottom: 24, flexWrap: "wrap", gap: 12 }}
      >
        <div className="row" style={{ alignItems: "center", gap: 10 }}>
          <Shield size={15} style={{ color: sessionAddress ? "var(--green)" : "var(--text-3)" }} />
          <span className="text-sm">
            {sessionAddress ? (
              <>Signed in as <span className="mono">{formatAddress(sessionAddress)}</span> — your drops sync across devices.</>
            ) : (
              "Sign in with your wallet to load your drops on any device."
            )}
          </span>
        </div>
        <Button size="sm" variant={sessionAddress ? "ghost" : "primary"} onClick={sync} disabled={status === "loading"}>
          <RefreshCw size={12} strokeWidth={2} />
          {status === "loading" ? "Syncing…" : sessionAddress ? "Sync drops" : "Sign in & load"}
        </Button>
      </div>
      {error && <p className="text-sm" style={{ color: "var(--red)", marginTop: -12, marginBottom: 20 }}>{error}</p>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 32 }}>
        <StatCard label="Active" value={armed} tone="amber" />
        <StatCard label="Released" value={released} tone={released ? "red" : "default"} />
        <StatCard label="Total drops" value={drops.length} />
      </div>

      <div className="card" style={{ overflow: "hidden" }}>
        <div className="between" style={{ padding: "16px 22px", borderBottom: "1px solid var(--line-1)" }}>
          <h3 className="h-3">All drops</h3>
          <div className="text-xs">{drops.length} item{drops.length !== 1 ? "s" : ""}</div>
        </div>
        {drops.length === 0 ? (
          <div style={{ padding: 56, textAlign: "center" }}>
            <span style={{ color: "var(--text-3)" }}><Lock size={28} strokeWidth={1.2} /></span>
            <div className="h-2" style={{ marginTop: 14, fontWeight: 400 }}>Nothing sealed yet</div>
            <p className="text-sm" style={{ marginTop: 6 }}>
              Encrypt your first file, or sync to load drops you armed elsewhere.
            </p>
            <Link href="/new/encrypt" className="btn btn-primary" style={{ marginTop: 18 }}>
              <Plus size={14} strokeWidth={2} /> New drop
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
          <span className="title">{drop.title || "Untitled drop"}</span>
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
