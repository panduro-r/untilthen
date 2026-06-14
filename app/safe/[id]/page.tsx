"use client"

import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { useState } from "react"
import { ArrowLeft, RefreshCw, Trash2, AlertTriangle, ShieldCheck, Loader2, Download } from "lucide-react"
import { useDropsStore } from "@/store/drops"
import { useWalletStore } from "@/store/wallet"
import { resetTimer } from "@/lib/reset"
import { deleteDrop } from "@/lib/deleteDrop"
import { verifyStoredEncryption, type EncryptionCheck } from "@/lib/verifyEncryption"
import { Eyebrow, SafeStatus, Countdown, Button } from "@/components/ui"
import ConnectGate from "@/components/wallet/ConnectGate"

const pad = (n: number) => String(n).padStart(2, "0")
function toLocalInput(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function fromLocalInput(s: string): number {
  const t = new Date(s).getTime()
  return Number.isNaN(t) ? 0 : t
}

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
  const ownerAddress = useWalletStore((s) => s.address)
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle")
  const [error, setError] = useState<string | null>(null)
  const [postponeTo, setPostponeTo] = useState("")
  const [now] = useState(() => Date.now())

  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleteStatus, setDeleteStatus] = useState<"idle" | "loading" | "error">("idle")
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const [check, setCheck] = useState<EncryptionCheck | null>(null)
  const [cipherBytes, setCipherBytes] = useState<Uint8Array | null>(null)
  const [checkStatus, setCheckStatus] = useState<"idle" | "loading" | "error">("idle")
  const [checkError, setCheckError] = useState<string | null>(null)

  const onVerify = async () => {
    if (!ownerAddress) return
    setCheckStatus("loading")
    setCheckError(null)
    setCheck(null)
    setCipherBytes(null)
    try {
      const { check: result, bytes } = await verifyStoredEncryption(`deaddrop_${id}`, ownerAddress)
      setCheck(result)
      setCipherBytes(bytes)
      setCheckStatus("idle")
    } catch (e) {
      console.error("[verify] failed:", e)
      setCheckError("We couldn't fetch the stored file from Shelby. It may have expired, or not be on the network yet.")
      setCheckStatus("error")
    }
  }

  // Save the RAW stored ciphertext (not unpacked) so the owner can inspect it with their own tools.
  const saveCiphertext = () => {
    if (!cipherBytes) return
    const blob = new Blob([cipherBytes as BlobPart], { type: "application/octet-stream" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${id}.ciphertext.bin`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const onDelete = async () => {
    setDeleteStatus("loading")
    setDeleteError(null)
    try {
      await deleteDrop(id, `deaddrop_${id}`)
      router.push("/dashboard")
    } catch (e) {
      console.error("[delete] failed:", e)
      setDeleteError(e instanceof Error ? e.message : "We couldn't delete this safe. Please try again.")
      setDeleteStatus("error")
    }
  }

  if (!drop) {
    return (
      <div className="page page-narrow">
        <Link href="/dashboard" className="btn btn-quiet" style={{ marginBottom: 24, marginLeft: -12 }}>
          <ArrowLeft size={14} strokeWidth={2} /> All safes
        </Link>
        <div className="card" style={{ padding: 40, textAlign: "center" }}>
          <h2 className="h-2" style={{ fontWeight: 400 }}>This safe isn&apos;t on this device</h2>
          <p className="text-sm" style={{ marginTop: 8 }}>
            Safes are cached locally in the browser where you created them. Open it from the same
            device, or it may have been created elsewhere.
          </p>
        </div>
      </div>
    )
  }

  const onReset = async () => {
    if (!drop) return
    const target = postponeTo ? fromLocalInput(postponeTo) : (drop.triggerAt ?? 0)
    setStatus("loading")
    setError(null)
    try {
      const { triggerAt } = await resetTimer(id, target)
      upsert({ ...drop, triggerAt })
      setPostponeTo("")
      setStatus("idle")
    } catch (e) {
      console.error("[reset] failed:", e)
      setError(e instanceof Error ? e.message : "We couldn't postpone the release. Please try again.")
      setStatus("error")
    }
  }

  const isTimelock = drop.mode === "timelock"
  const isArmed = drop.status === "armed"

  return (
    <div className="page page-narrow">
      <Link href="/dashboard" className="btn btn-quiet" style={{ marginBottom: 24, marginLeft: -12 }}>
        <ArrowLeft size={14} strokeWidth={2} /> All safes
      </Link>

      <div className="between" style={{ marginBottom: 32, flexWrap: "wrap", gap: 12 }}>
        <div className="stack-8">
          <Eyebrow>Safe</Eyebrow>
          <h1 className="h-1">{drop.title || "Untitled safe"}</h1>
          <div className="center" style={{ gap: 10, marginTop: 6 }}>
            <SafeStatus status={drop.status} mode={drop.mode} triggerAt={drop.triggerAt} />
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
            When this countdown reaches zero, the key is released automatically
            {drop.distribution === "public" ? " publicly" : " to your recipients"}, unless you postpone it
            first. Postponing re-locks the secret to a later date and takes a couple of wallet signatures,
            no fee.
          </div>
          <div className="stack-12" style={{ marginTop: 24, maxWidth: 360 }}>
            <label className="field-label" htmlFor="postpone-to">New release date &amp; time</label>
            <input
              id="postpone-to"
              type="datetime-local"
              className="input"
              min={toLocalInput(now + 60_000)}
              value={postponeTo || toLocalInput(drop.triggerAt)}
              onChange={(e) => setPostponeTo(e.target.value)}
            />
            <div>
              <button className="btn btn-primary" onClick={onReset} disabled={status === "loading"}>
                <RefreshCw size={14} strokeWidth={2} />
                {status === "loading" ? "Postponing…" : "Postpone release"}
              </button>
            </div>
          </div>
          {error && <p className="text-sm" style={{ color: "var(--red)", marginTop: 14 }}>{error}</p>}
        </div>
      )}

      {drop.status === "released" && (
        <div className="card" style={{ padding: 32, marginBottom: 24, borderColor: "color-mix(in oklch, var(--red) 35%, var(--line-1))" }}>
          <div className="urgent-banner" style={{ marginBottom: 20 }}>
            <span className="pulse" />
            <span>This safe has been released. {drop.distribution === "public" ? "Anyone with the link can open it." : "Recipients have been notified."}</span>
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

      {/* Storage proof — fetch the actual stored blob and show it's ciphertext. */}
      <div className="card" style={{ padding: 28, marginTop: 24 }}>
        <h3 className="h-3" style={{ marginBottom: 6 }}>Verify encryption</h3>
        <p className="text-sm" style={{ marginBottom: 18, maxWidth: 560 }}>
          Fetch the file exactly as it&apos;s stored on Shelby (signer-less, with nothing but the
          public address). Inspect the bytes here, and download the raw ciphertext to check it with your
          own tools. Encrypted content is high-entropy and header-less; your plaintext file never left
          your browser.
        </p>

        <Button variant="ghost" onClick={onVerify} disabled={checkStatus === "loading" || !ownerAddress}>
          {checkStatus === "loading" ? <Loader2 size={14} className="spin" /> : <ShieldCheck size={14} strokeWidth={2} />}
          {checkStatus === "loading" ? "Fetching from Shelby…" : "Verify encryption"}
        </Button>

        {checkError && <p className="text-sm" style={{ color: "var(--red)", marginTop: 14 }}>{checkError}</p>}

        {check && (
          <div
            className="card"
            style={{
              marginTop: 18,
              padding: 18,
              background: "var(--bg-2)",
              borderColor: check.looksEncrypted
                ? "color-mix(in oklch, var(--green) 40%, var(--line-1))"
                : "color-mix(in oklch, var(--red) 40%, var(--line-1))",
            }}
          >
            <div className="row" style={{ alignItems: "center", gap: 8, marginBottom: 14 }}>
              <ShieldCheck size={16} style={{ color: check.looksEncrypted ? "var(--green)" : "var(--red)" }} />
              <strong>{check.looksEncrypted ? "Stored as ciphertext" : "Unexpected, investigate"}</strong>
            </div>
            <div className="stack-12">
              <ProofRow label="Stored size" value={`${check.size.toLocaleString()} bytes`} />
              <ProofRow label="Entropy" value={`${check.entropyBitsPerByte.toFixed(3)} / 8.0 bits per byte`} ok={check.entropyBitsPerByte > 7.5} hint="8.0 = indistinguishable from random" />
              <ProofRow label="File header" value={check.fileHeader ? `⚠ ${check.fileHeader}` : "none"} ok={!check.fileHeader} hint="no plaintext file signature" />
              <ProofRow label="Readable text" value={`${(check.printableRatio * 100).toFixed(0)}%`} ok={check.printableRatio < 0.4} hint="low = not text" />
              <ProofRow label="First 32 bytes" value={check.hexPreview} mono />
            </div>
            <Button variant="ghost" size="sm" onClick={saveCiphertext} disabled={!cipherBytes} style={{ marginTop: 16 }}>
              <Download size={13} strokeWidth={2} /> Download ciphertext
            </Button>
          </div>
        )}
      </div>

      {/* Danger zone — delete the drop + its encrypted file. */}
      <div
        className="card"
        style={{ padding: 28, marginTop: 24, borderColor: "color-mix(in oklch, var(--red) 30%, var(--line-1))" }}
      >
        <h3 className="h-3" style={{ marginBottom: 6 }}>Delete this safe</h3>
        <p className="text-sm" style={{ marginBottom: 18, maxWidth: 540 }}>
          Permanently removes the encrypted file from storage and this safe from your account. Anyone
          waiting on it will no longer be able to retrieve it. This cannot be undone.
        </p>

        {!confirmingDelete ? (
          <Button variant="danger" onClick={() => { setConfirmingDelete(true); setDeleteError(null) }}>
            <Trash2 size={14} strokeWidth={2} /> Delete safe
          </Button>
        ) : (
          <div className="card" style={{ padding: 18, background: "var(--bg-2)", borderColor: "color-mix(in oklch, var(--red) 40%, var(--line-1))" }}>
            <div className="row" style={{ alignItems: "flex-start", gap: 10, marginBottom: 14 }}>
              <AlertTriangle size={16} style={{ color: "var(--red)", flexShrink: 0, marginTop: 2 }} />
              <span className="text-sm">
                Are you sure you want to permanently delete this safe? You&apos;ll sign one wallet
                transaction to erase the encrypted file from storage. This can&apos;t be undone.
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

function ProofRow({ label, value, ok, hint, mono }: { label: string; value: string; ok?: boolean; hint?: string; mono?: boolean }) {
  const color = ok === false ? "var(--red)" : ok === true ? "var(--green)" : "var(--text-1)"
  return (
    <div className="between" style={{ alignItems: "flex-start", gap: 16 }}>
      <span className="text-xs" style={{ textTransform: "uppercase", letterSpacing: "0.1em", whiteSpace: "nowrap" }}>{label}</span>
      <span style={{ textAlign: "right" }}>
        <span className={mono ? "mono" : undefined} style={{ fontSize: mono ? 11 : 13, color, wordBreak: "break-all" }}>{value}</span>
        {hint && <span className="text-xs" style={{ display: "block", color: "var(--text-3)", marginTop: 2 }}>{hint}</span>}
      </span>
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
