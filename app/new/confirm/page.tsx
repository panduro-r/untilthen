"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Plus, Trash2, ArrowLeft, Lock, Check, Copy, ArrowRight, RefreshCw } from "lucide-react"
import { useDraftStore, type RecipientDraft } from "@/store/draft"
import { useDropsStore } from "@/store/drops"
import { recipientId as makeRecipientId, formatAddress } from "@/lib/ids"
import { armDrop } from "@/lib/armDrop"
import { describeArmError } from "@/lib/shelby"
import { estimateUploadCost } from "@/lib/funding"
import { Steps, Eyebrow, Button, Chip } from "@/components/ui"
import ConnectGate from "@/components/wallet/ConnectGate"

const STEPS = ["Encrypt file", "Set condition", "Add recipients", "Confirm"]

export default function ConfirmPage() {
  return (
    <ConnectGate>
      <Confirm />
    </ConnectGate>
  )
}

type Status = "idle" | "loading" | "error" | "success"

function Confirm() {
  const router = useRouter()
  const draft = useDraftStore()
  const upsertDrop = useDropsStore((s) => s.upsertDrop)

  const [status, setStatus] = useState<Status>("idle")
  const [error, setError] = useState<string | null>(null)
  const [publicLink, setPublicLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [copiedSigner, setCopiedSigner] = useState<string | null>(null)
  const [cost, setCost] = useState<{ aptOctas: bigint; shelbyUsdSmallest: bigint } | null>(null)

  useEffect(() => {
    const bytes = draft.fileMeta?.size ?? 0
    const daysUntilRelease = Math.max(1, Math.ceil((draft.releaseAt - Date.now()) / 86_400_000))
    const durationDays = daysUntilRelease + 30 // blob overshoot past the release date
    estimateUploadCost({ bytes, durationDays }).then(setCost).catch(() => {})
  }, [draft.fileMeta?.size, draft.releaseAt])

  // Reactive guard: if there's no draft (fresh start, reload, OR the draft was cleared by a wallet
  // switch while we're on this page), bounce to the start of the New safe flow. Gated on idle so it
  // does NOT fire during/after arming — arm() resets the draft itself and routes onward.
  useEffect(() => {
    if (!draft.ciphertext && status === "idle") router.replace("/new/encrypt")
  }, [draft.ciphertext, status, router])

  useEffect(() => {
    if (draft.ciphertext && draft.distribution === "private" && draft.recipients.length === 0) {
      draft.set({ recipients: [{ id: makeRecipientId(), type: "email", name: "", email: "" }] })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setRecipient = (id: string, patch: Partial<RecipientDraft>) =>
    draft.set({ recipients: draft.recipients.map((r) => (r.id === id ? { ...r, ...patch } : r)) })
  const addRecipient = () =>
    draft.set({ recipients: [...draft.recipients, { id: makeRecipientId(), type: "email", name: "", email: "" }] })
  const removeRecipient = (id: string) =>
    draft.set({ recipients: draft.recipients.filter((r) => r.id !== id) })

  // Time-lock safes release at the chosen date; multisig safes release on approval (no date).
  const releaseAt = draft.releaseAt
  const releaseDate = releaseAt
    ? new Date(releaseAt).toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" })
    : "—"

  const emailRecipients = draft.recipients.filter((r) => r.type === "email" && r.email.trim())

  // Multisig: each signer must register their enc key before the owner can arm.
  const [signerStatus, setSignerStatus] = useState<Record<string, boolean>>({})
  const refreshSigners = useCallback(async () => {
    if (draft.mode !== "multisig" || !draft.dropId) return
    const entries = await Promise.all(
      draft.signers.map(async (s) => {
        const res = await fetch(`/api/register-signer/${draft.dropId}/${s.id}`)
        const body = await res.json().catch(() => ({}))
        return [s.id, !!body.registered] as const
      }),
    )
    setSignerStatus(Object.fromEntries(entries))
  }, [draft.mode, draft.dropId, draft.signers])

  useEffect(() => {
    if (draft.mode !== "multisig" || !draft.dropId) return
    let cancelled = false
    ;(async () => {
      const entries = await Promise.all(
        draft.signers.map(async (s) => {
          const res = await fetch(`/api/register-signer/${draft.dropId}/${s.id}`)
          const body = await res.json().catch(() => ({}))
          return [s.id, !!body.registered] as const
        }),
      )
      if (!cancelled) setSignerStatus(Object.fromEntries(entries))
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.mode, draft.dropId])

  const allSignersRegistered =
    draft.mode !== "multisig" || (draft.signers.length >= 2 && draft.signers.every((s) => signerStatus[s.id]))
  const distributionValid = draft.distribution === "public" ? draft.publicAck : emailRecipients.length > 0
  const valid = !!draft.title.trim() && distributionValid && allSignersRegistered

  const arm = async () => {
    setStatus("loading")
    setError(null)
    try {
      const result = await armDrop(draft)
      upsertDrop({
        id: result.dropId,
        title: draft.title,
        mode: draft.mode,
        distribution: draft.distribution,
        status: "armed",
        triggerAt: draft.mode === "timelock" ? releaseAt : null,
        recipientCount: draft.distribution === "private" ? emailRecipients.length : 0,
        created: Date.now(),
      })
      draft.reset()
      setStatus("success")
      // Public safes stay on the success screen so the owner can copy the share link. Private and
      // multisig safes have nothing to copy — go straight to the dashboard.
      if (result.publicLink) setPublicLink(result.publicLink)
      else router.replace("/dashboard")
    } catch (e) {
      console.error("[arm] failed:", e)
      setError(describeArmError(e))
      setStatus("error")
    }
  }

  if (status === "success") {
    return (
      <div className="page page-narrow" style={{ textAlign: "center", paddingTop: 64 }}>
        <span style={{ color: "var(--green)" }}><Check size={36} strokeWidth={2} /></span>
        <h1 className="h-1" style={{ marginTop: 16 }}>Sealed &amp; armed.</h1>
        <p className="text-body" style={{ marginTop: 8, marginBottom: 24 }}>
          {publicLink
            ? "Share the link below. Anyone holding it can open the file after release."
            : "Your recipients will be emailed a one-time link the moment it releases."}
        </p>
        {publicLink && (
          <div className="card" style={{ padding: 16, maxWidth: 520, margin: "0 auto 24px", display: "flex", alignItems: "center", gap: 10 }}>
            <span className="mono text-sm" style={{ flex: 1, wordBreak: "break-all", textAlign: "left" }}>{publicLink}</span>
            <Button variant="ghost" size="sm" onClick={() => { navigator.clipboard?.writeText(publicLink); setCopied(true) }}>
              {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        )}
        <div className="row" style={{ justifyContent: "center" }}>
          <Link href="/dashboard" className="btn btn-primary">Go to dashboard <ArrowRight size={14} strokeWidth={2} /></Link>
        </div>
      </div>
    )
  }

  return (
    <div className="page page-narrow">
      <Steps current={2} steps={STEPS} />
      <div style={{ height: 32 }} />

      <div className="stack-12" style={{ marginBottom: 28 }}>
        <Eyebrow>Step 03 / Recipients &amp; details</Eyebrow>
        <h1 className="h-1">{draft.distribution === "public" ? "Confirm the public safe." : "Who should get this if it opens?"}</h1>
        <p className="text-body">
          {draft.distribution === "public"
            ? "Anyone with the link can open the file once it releases."
            : "They'll receive a one-time link by email when the condition is met."}
        </p>
      </div>

      <div className="card" style={{ padding: 28, marginBottom: 24 }}>
        <div className="field" style={{ marginBottom: 20 }}>
          <label className="field-label">Safe name (only you see this — it&apos;s encrypted)</label>
          <input className="input" placeholder="e.g. Legal docs for family" value={draft.title} onChange={(e) => draft.set({ title: e.target.value })} />
        </div>

        {draft.distribution === "private" ? (
          <>
            <hr className="hr" />
            <h3 className="h-3" style={{ marginBottom: 14 }}>Recipients</h3>
            <div className="stack-12">
              {draft.recipients.map((r) => (
                <div key={r.id} className="stack-8">
                  <div className="row" style={{ alignItems: "center" }}>
                    <input className="input" placeholder="Name (optional)" value={r.name ?? ""} style={{ flex: "1 1 30%", minWidth: 120 }} onChange={(e) => setRecipient(r.id, { name: e.target.value })} />
                    <input className="input" placeholder="email@example.com" value={r.email} style={{ flex: "2 1 60%" }} onChange={(e) => setRecipient(r.id, { email: e.target.value })} />
                    {draft.recipients.length > 1 && (
                      <button className="btn btn-quiet" onClick={() => removeRecipient(r.id)}><Trash2 size={14} /></button>
                    )}
                  </div>
                </div>
              ))}
              <button className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }} onClick={addRecipient}>
                <Plus size={14} /> Add recipient
              </button>
            </div>
            <p className="text-xs muted" style={{ marginTop: 12 }}>
              Wallet recipients (stronger, no email needed) require a one-time registration — coming next.
            </p>
          </>
        ) : (
          <>
            <hr className="hr" />
            <h3 className="h-3" style={{ marginBottom: 12 }}>Irreversible once shared</h3>
            <label className="row" style={{ alignItems: "flex-start", gap: 12, cursor: "pointer" }}>
              <input type="checkbox" checked={draft.publicAck} onChange={(e) => draft.set({ publicAck: e.target.checked })} style={{ marginTop: 3, width: 16, height: 16, accentColor: "var(--amber)" }} />
              <span className="text-sm" style={{ color: "var(--text-1)" }}>
                I understand: anyone who gets this link will be able to open the file after <strong>{releaseDate}</strong>.
                I can delay it by checking in, but once I share the link I cannot un-publish it.
              </span>
            </label>
          </>
        )}
      </div>

      {draft.mode === "multisig" && (
        <div className="card" style={{ padding: 28, marginBottom: 24 }}>
          <div className="between" style={{ marginBottom: 8 }}>
            <h3 className="h-3">Signers must register first</h3>
            <button className="btn btn-quiet btn-sm" onClick={refreshSigners}>
              <RefreshCw size={12} strokeWidth={2} /> Refresh
            </button>
          </div>
          <p className="text-xs" style={{ marginBottom: 16 }}>
            Send each signer their link. They sign once to register; you can arm once all{" "}
            {draft.signers.length} have.
          </p>
          <div className="stack-12">
            {draft.signers.map((s, i) => {
              const reg = signerStatus[s.id]
              const link =
                typeof window !== "undefined"
                  ? `${window.location.origin}/register-signer/${draft.dropId}/${s.id}`
                  : ""
              return (
                <div key={s.id} className="between" style={{ gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="text-sm" style={{ color: "var(--text-1)" }}>{s.email || `Signer ${i + 1}`}</div>
                    <div className="mono text-xs" style={{ wordBreak: "break-all" }}>{formatAddress(s.address, 10, 6)}</div>
                  </div>
                  <div className="row" style={{ gap: 8, alignItems: "center" }}>
                    {reg ? <Chip tone="ok">Registered</Chip> : <span className="text-xs muted">Waiting…</span>}
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        navigator.clipboard?.writeText(link)
                        setCopiedSigner(s.id)
                        setTimeout(() => setCopiedSigner((c) => (c === s.id ? null : c)), 1500)
                      }}
                    >
                      {copiedSigner === s.id ? <Check size={12} style={{ color: "var(--green)" }} /> : <Copy size={12} />}
                      {copiedSigner === s.id ? "Copied" : "Copy link"}
                    </button>
                    <a className="btn btn-ghost btn-sm" href={link} target="_blank" rel="noreferrer">
                      <ArrowRight size={12} /> Open
                    </a>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 28, marginBottom: 24 }}>
        <Eyebrow>Review</Eyebrow>
        <div className="stack-16" style={{ marginTop: 16 }}>
          <SummaryRow label="File" value={draft.fileMeta?.name || "—"} />
          <SummaryRow label="Encryption" value="AES-256-GCM · client-side" />
          <SummaryRow label="Distribution" value={draft.distribution === "public" ? "Public link" : "Private recipients"} />
          <SummaryRow
            label="Release rule"
            value={
              draft.mode === "timelock"
                ? "Time-lock"
                : `Multi-sig · ${draft.threshold} of ${draft.signers.length} signers`
            }
          />
          <SummaryRow
            label={draft.mode === "timelock" ? "Opens on" : "Opens"}
            value={draft.mode === "timelock" ? releaseDate : "When signers approve"}
          />
          {draft.distribution === "private" && <SummaryRow label="Recipients" value={`${emailRecipients.length} configured`} />}
          <SummaryRow
            label="Estimated cost"
            value={
              cost
                ? `≈ $${(Number(cost.shelbyUsdSmallest) / 1e8).toFixed(2)} storage · ≈ ${(Number(cost.aptOctas) / 1e8).toFixed(4)} APT gas`
                : "Estimating…"
            }
          />
        </div>
      </div>

      {error && <p className="text-sm" style={{ color: "var(--red)", marginBottom: 16 }}>{error}</p>}

      <div className="between" style={{ flexWrap: "wrap", gap: 12 }}>
        <button className="btn btn-ghost" onClick={() => router.push("/new/condition")} disabled={status === "loading"}>
          <ArrowLeft size={14} strokeWidth={2} /> Back
        </button>
        <Button size="lg" disabled={!valid || status === "loading"} onClick={arm}>
          <Lock size={14} /> {status === "loading" ? "Arming…" : "Arm safe"}
        </Button>
      </div>
      <p className="text-xs muted" style={{ marginTop: 18, textAlign: "right" }}>
        Arming asks for a few signatures from your wallet (owner copy, title key, ownership proof).
      </p>
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
