"use client"

import { useParams } from "next/navigation"
import Link from "next/link"
import { useState } from "react"
import { ArrowLeft, RefreshCw } from "lucide-react"
import { useDropsStore } from "@/store/drops"
import { resetTimer } from "@/lib/reset"
import { Eyebrow, Chip, Countdown } from "@/components/ui"
import ConnectGate from "@/components/wallet/ConnectGate"

export default function DropDetailPage() {
  return (
    <ConnectGate requireSession>
      <DropDetail />
    </ConnectGate>
  )
}

function DropDetail() {
  const params = useParams<{ id: string }>()
  const id = params.id
  const drop = useDropsStore((s) => s.drops.find((d) => d.id === id))
  const upsert = useDropsStore((s) => s.upsertDrop)
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  if (!drop) {
    return (
      <div className="page page-narrow">
        <Link href="/dashboard" className="btn btn-quiet" style={{ marginBottom: 24, marginLeft: -12 }}>
          <ArrowLeft size={14} strokeWidth={2} /> All drops
        </Link>
        <div className="card" style={{ padding: 40, textAlign: "center" }}>
          <h2 className="h-2" style={{ fontWeight: 400 }}>This drop isn&apos;t on this device</h2>
          <p className="text-sm" style={{ marginTop: 8 }}>
            Drops are cached locally in the browser where you created them. Open it from the same
            device, or it may have been created elsewhere.
          </p>
        </div>
      </div>
    )
  }

  const onReset = async () => {
    setStatus("loading")
    setError(null)
    try {
      const { triggerAt } = await resetTimer(id)
      upsert({ ...drop, triggerAt })
      setStatus("idle")
    } catch (e) {
      console.error("[reset] failed:", e)
      setError(e instanceof Error ? e.message : "We couldn't reset the timer. Please try again.")
      setStatus("error")
    }
  }

  const isTimelock = drop.mode === "timelock"
  const isArmed = drop.status === "armed"

  return (
    <div className="page page-narrow">
      <Link href="/dashboard" className="btn btn-quiet" style={{ marginBottom: 24, marginLeft: -12 }}>
        <ArrowLeft size={14} strokeWidth={2} /> All drops
      </Link>

      <div className="between" style={{ marginBottom: 32, flexWrap: "wrap", gap: 12 }}>
        <div className="stack-8">
          <Eyebrow>Drop</Eyebrow>
          <h1 className="h-1">{drop.title || "Untitled drop"}</h1>
          <div className="center" style={{ gap: 10, marginTop: 6 }}>
            {drop.status === "armed" && <Chip tone="armed">Armed</Chip>}
            {drop.status === "released" && <Chip tone="released">Released</Chip>}
            {drop.status === "expired" && <Chip tone="expired">Expired</Chip>}
            <span className="text-xs mono">{drop.id}</span>
          </div>
        </div>
      </div>

      {/* Timelock countdown + reset */}
      {isArmed && isTimelock && drop.triggerAt && (
        <div className="card" style={{ padding: 32, marginBottom: 24 }}>
          <Eyebrow>Time until release</Eyebrow>
          <div style={{ marginTop: 16 }}>
            <Countdown to={drop.triggerAt} big />
          </div>
          <div className="text-sm" style={{ marginTop: 16, maxWidth: 520 }}>
            If you don&apos;t reset by then, the key is automatically released to your recipients.
            Resetting re-locks the secret to a fresh round — it takes a couple of wallet signatures.
          </div>
          <div style={{ marginTop: 24 }}>
            <button className="btn btn-primary" onClick={onReset} disabled={status === "loading"}>
              <RefreshCw size={14} strokeWidth={2} />
              {status === "loading" ? "Resetting…" : "I'm still here · reset timer"}
            </button>
          </div>
          {error && <p className="text-sm" style={{ color: "var(--red)", marginTop: 14 }}>{error}</p>}
        </div>
      )}

      {drop.status === "released" && (
        <div className="card" style={{ padding: 32, marginBottom: 24, borderColor: "color-mix(in oklch, var(--red) 35%, var(--line-1))" }}>
          <div className="urgent-banner" style={{ marginBottom: 20 }}>
            <span className="pulse" />
            <span>This drop has been released. {drop.distribution === "public" ? "Anyone with the link can open it." : "Recipients have been notified."}</span>
          </div>
          <p className="text-sm" style={{ margin: 0 }}>
            The decryption key is now recoverable by the condition you set. The file stays encrypted on
            storage, but the key gate has opened.
          </p>
        </div>
      )}

      {/* Details */}
      <div className="card" style={{ padding: 28 }}>
        <h3 className="h-3" style={{ marginBottom: 18 }}>Details</h3>
        <div className="stack-16">
          <SummaryRow label="Encryption" value="AES-256-GCM · client-side" />
          <SummaryRow label="Distribution" value={drop.distribution === "public" ? "Public link" : "Private recipients"} />
          <SummaryRow label="Release rule" value={drop.mode === "timelock" ? "Time-lock (check in to delay)" : "Multi-sig approvals"} />
          <SummaryRow
            label="Recipients"
            value={drop.distribution === "public" ? "Anyone with the link" : `${drop.recipientCount} configured`}
          />
          <SummaryRow label="Created" value={new Date(drop.created).toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" })} />
        </div>

        {drop.distribution === "public" && (
          <>
            <hr className="hr" />
            <div className="text-xs" style={{ marginBottom: 8 }}>Shareable link</div>
            <PublicLink dropId={drop.id} />
          </>
        )}
      </div>
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="between" style={{ borderBottom: "1px solid var(--line-1)", paddingBottom: 14 }}>
      <span className="text-xs" style={{ textTransform: "uppercase", letterSpacing: "0.1em" }}>{label}</span>
      <span style={{ fontSize: 14, color: "var(--text-1)", textAlign: "right" }}>{value}</span>
    </div>
  )
}

function PublicLink({ dropId }: { dropId: string }) {
  const [copied, setCopied] = useState(false)
  const url = typeof window !== "undefined" ? `${window.location.origin}/p/${dropId}` : `/p/${dropId}`
  return (
    <div className="between" style={{ gap: 10 }}>
      <span className="mono text-xs" style={{ wordBreak: "break-all" }}>{url}</span>
      <button
        className="btn btn-ghost btn-sm"
        onClick={() => {
          navigator.clipboard?.writeText(url)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  )
}
