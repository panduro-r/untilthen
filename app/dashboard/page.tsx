"use client"

import Link from "next/link"
import { Plus, Lock, ArrowRight, RefreshCw } from "lucide-react"
import { useDropsStore, type DropSummary } from "@/store/drops"
import { Eyebrow, Chip, Countdown } from "@/components/ui"
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
  const armed = drops.filter((d) => d.status === "armed").length
  const released = drops.filter((d) => d.status === "released").length

  return (
    <div className="page">
      <div className="between" style={{ flexWrap: "wrap", gap: 18, marginBottom: 32 }}>
        <div className="stack-8">
          <Eyebrow>Your safes</Eyebrow>
          <h1 className="h-1">Dashboard</h1>
        </div>
        <Link href="/new/encrypt" className="btn btn-primary">
          <Plus size={14} strokeWidth={2} /> New drop
        </Link>
      </div>

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
            <p className="text-sm" style={{ marginTop: 6 }}>Encrypt your first file to get started.</p>
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
