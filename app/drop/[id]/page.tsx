"use client"

import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { useState } from "react"
import { ArrowLeft, RefreshCw, Trash2, AlertTriangle } from "lucide-react"
import { useDropsStore } from "@/store/drops"
import { resetTimer } from "@/lib/reset"
import { deleteDrop } from "@/lib/deleteDrop"
import { Eyebrow, Chip, Countdown, Button } from "@/components/ui"
import ConnectGate from "@/components/wallet/ConnectGate"

export default function DropDetailPage() {
  return (
    <ConnectGate>
      <DropDetail />
    </ConnectGate>
  )
}

function DropDetail() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const id = params.id
  const drop = useDropsStore((s) => s.drops.find((d) => d.id === id))
  const upsert = useDropsStore((s) => s.upsertDrop)
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleteStatus, setDeleteStatus] = useState<"idle" | "loading" | "error">("idle")
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const onDelete = async () => {
    setDeleteStatus("loading")
    setDeleteError(null)
    try {
      await deleteDrop(id, `deaddrop_${id}`)
      router.push("/dashboard")
    } catch (e) {
      console.error("[delete] failed:", e)
      setDeleteError(e instanceof Error ? e.message : "We couldn't delete this drop. Please try again.")
      setDeleteStatus("error")
    }
  }

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

      {/* Danger zone — delete the drop + its encrypted file. */}
      <div
        className="card"
        style={{ padding: 28, marginTop: 24, borderColor: "color-mix(in oklch, var(--red) 30%, var(--line-1))" }}
      >
        <h3 className="h-3" style={{ marginBottom: 6 }}>Delete this drop</h3>
        <p className="text-sm" style={{ marginBottom: 18, maxWidth: 540 }}>
          Permanently removes the encrypted file from storage and this drop from your account. Anyone
          waiting on it will no longer be able to retrieve it. This cannot be undone.
        </p>

        {!confirmingDelete ? (
          <Button variant="danger" onClick={() => { setConfirmingDelete(true); setDeleteError(null) }}>
            <Trash2 size={14} strokeWidth={2} /> Delete drop
          </Button>
        ) : (
          <div className="card" style={{ padding: 18, background: "var(--bg-2)", borderColor: "color-mix(in oklch, var(--red) 40%, var(--line-1))" }}>
            <div className="row" style={{ alignItems: "flex-start", gap: 10, marginBottom: 14 }}>
              <AlertTriangle size={16} style={{ color: "var(--red)", flexShrink: 0, marginTop: 2 }} />
              <span className="text-sm">
                Delete <strong>{drop.title || "this drop"}</strong> for good? You&apos;ll sign one
                wallet transaction to erase the file from storage.
              </span>
            </div>
            <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
              <Button variant="danger" onClick={onDelete} disabled={deleteStatus === "loading"}>
                <Trash2 size={14} strokeWidth={2} />
                {deleteStatus === "loading" ? "Deleting…" : "Yes, delete permanently"}
              </Button>
              <Button variant="ghost" onClick={() => setConfirmingDelete(false)} disabled={deleteStatus === "loading"}>
                Cancel
              </Button>
            </div>
            {deleteError && <p className="text-sm" style={{ color: "var(--red)", marginTop: 12 }}>{deleteError}</p>}
          </div>
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
