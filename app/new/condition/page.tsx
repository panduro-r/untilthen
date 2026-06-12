"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Clock, Users, Lock, Globe, ArrowLeft, ArrowRight, Plus, Trash2 } from "lucide-react"
import { useDraftStore, type SignerDraft } from "@/store/draft"
import { signerId as makeSignerId } from "@/lib/ids"
import { Steps, Eyebrow, DateTimePicker } from "@/components/ui"
import ConnectGate from "@/components/wallet/ConnectGate"

const STEPS = ["Encrypt file", "Set condition", "Add recipients", "Confirm"]

const DAY = 86_400_000
function formatReleaseDate(ms: number): string {
  return new Date(ms).toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" })
}

export default function ConditionPage() {
  return (
    <ConnectGate>
      <Condition />
    </ConnectGate>
  )
}

function Condition() {
  const router = useRouter()
  const draft = useDraftStore()
  const [now] = useState(() => Date.now())

  // Reactive guard: no draft (fresh start, reload, or cleared by a wallet switch) → back to step 1.
  useEffect(() => {
    if (!draft.ciphertext) router.replace("/new/encrypt")
  }, [draft.ciphertext, router])

  useEffect(() => {
    if (!draft.ciphertext) return
    // Seed two empty signer rows when switching to multisig.
    if (draft.mode === "multisig" && draft.signers.length === 0) {
      draft.set({ signers: [emptySigner(), emptySigner()] })
    }
    // Seed a sensible default release date (30 days out) the first time we land on time-lock.
    if (draft.mode === "timelock" && !draft.releaseAt) {
      draft.set({ releaseAt: Date.now() + 30 * DAY })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.mode])

  const setSigner = (id: string, patch: Partial<SignerDraft>) =>
    draft.set({ signers: draft.signers.map((s) => (s.id === id ? { ...s, ...patch } : s)) })
  const addSigner = () => draft.set({ signers: [...draft.signers, emptySigner()] })
  const removeSigner = (id: string) => {
    const next = draft.signers.filter((s) => s.id !== id)
    draft.set({ signers: next, threshold: Math.min(draft.threshold, Math.max(1, next.length)) })
  }

  const validSigners = draft.signers.filter((s) => s.address.trim() && s.email.trim()).length
  const multisigReady = draft.mode === "multisig" && validSigners >= 2 && draft.threshold <= validSigners
  const canContinue = (draft.mode === "timelock" && draft.releaseAt > now) || multisigReady

  return (
    <div className="page page-narrow">
      <Steps current={1} steps={STEPS} cancelHref="/dashboard" />
      <div style={{ height: 32 }} />

      <div className="stack-12" style={{ marginBottom: 28 }}>
        <Eyebrow>Step 02 / Condition</Eyebrow>
        <h1 className="h-1">When &amp; for whom should it open?</h1>
        <p className="text-body" style={{ maxWidth: 560 }}>
          Choose who can open it and what releases the key. For a time-lock you can change the release
          date later by signing from the same wallet.
        </p>
      </div>

      {/* Distribution */}
      <div className="text-xs" style={{ textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 12 }}>Who can open it</div>
      <div className="toggle-group" style={{ marginBottom: 28 }}>
        <button className={`toggle-card ${draft.distribution === "private" ? "active" : ""}`} onClick={() => draft.set({ distribution: "private" })}>
          <div className="between"><Lock size={20} /><span className="check" /></div>
          <div className="stack-4">
            <div className="h-2" style={{ fontFamily: "var(--font-serif)", fontSize: 19, fontWeight: 400 }}>Private</div>
            <div className="text-sm">Specific recipients. Each gets a one-time link only they can open.</div>
          </div>
        </button>
        <button className={`toggle-card ${draft.distribution === "public" ? "active" : ""}`} onClick={() => draft.set({ distribution: "public" })}>
          <div className="between"><Globe size={20} /><span className="check" /></div>
          <div className="stack-4">
            <div className="h-2" style={{ fontFamily: "var(--font-serif)", fontSize: 19, fontWeight: 400 }}>Public</div>
            <div className="text-sm">One shareable link. Anyone holding it can open after release.</div>
          </div>
        </button>
      </div>

      {/* Mode */}
      <div className="text-xs" style={{ textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 12 }}>What releases the key</div>
      <div className="toggle-group" style={{ marginBottom: 32 }}>
        <button className={`toggle-card ${draft.mode === "timelock" ? "active" : ""}`} onClick={() => draft.set({ mode: "timelock" })}>
          <div className="between"><Clock size={20} /><span className="check" /></div>
          <div className="stack-4">
            <div className="h-2" style={{ fontFamily: "var(--font-serif)", fontSize: 19, fontWeight: 400 }}>Time-lock</div>
            <div className="text-sm">Opens on a date you choose. Push it back anytime before then; if you don&apos;t, it opens automatically.</div>
          </div>
          <div className="text-xs muted">Auto-releases on your date</div>
        </button>
        <button className={`toggle-card ${draft.mode === "multisig" ? "active" : ""}`} onClick={() => draft.set({ mode: "multisig" })}>
          <div className="between"><Users size={20} /><span className="check" /></div>
          <div className="stack-4">
            <div className="h-2" style={{ fontFamily: "var(--font-serif)", fontSize: 19, fontWeight: 400 }}>Trusted circle</div>
            <div className="text-sm">A group of people. The safe opens only when enough of them actively approve.</div>
          </div>
          <div className="text-xs muted">Never fires on its own</div>
        </button>
      </div>

      {draft.mode === "timelock" && (
        <div className="card" style={{ padding: 28 }}>
          <h3 className="h-3" style={{ marginBottom: 6 }}>When should it open?</h3>
          <p className="text-sm" style={{ marginBottom: 20, color: "var(--text-2)" }}>
            Pick the date it unlocks. You can push it back anytime before then — no need to decide forever now.
          </p>
          <div className="stack-12">
            <label className="field-label">Release date &amp; time</label>
            <DateTimePicker
              value={draft.releaseAt}
              onChange={(ms) => draft.set({ releaseAt: ms })}
              min={now + 60_000}
            />
          </div>
          <div className="card" style={{ padding: 18, marginTop: 24, background: "var(--bg-2)", border: "1px dashed var(--line-2)" }}>
            <div className="text-xs muted" style={{ marginBottom: 8 }}>In plain words</div>
            <p className="text-body" style={{ margin: 0, color: "var(--text-1)", fontSize: 14 }}>
              Your file stays sealed until{" "}
              <strong>{draft.releaseAt ? formatReleaseDate(draft.releaseAt) : "…"}</strong>. Anytime before
              then you can come back and push the date out — one quick signature, no fee. If you never do,
              the key is released{draft.distribution === "public" ? " publicly" : " to your recipients"}{" "}
              automatically on that date.
            </p>
          </div>
        </div>
      )}

      {draft.mode === "multisig" && (
        <div className="card" style={{ padding: 28 }}>
          <h3 className="h-3" style={{ marginBottom: 6 }}>Trusted signers</h3>
          <p className="text-xs" style={{ marginBottom: 18 }}>
            Add the wallets that can approve release (2–5). Each signs once to register, then approves
            when the time is right.{" "}
            {draft.distribution === "public"
              ? "Once enough of them approve, the file opens to anyone with the public link."
              : "Once enough of them approve, each recipient can open it with their one-time link."}
          </p>
          <div className="stack-12">
            {draft.signers.map((s, i) => (
              <div key={s.id} className="row" style={{ alignItems: "center", gap: 10 }}>
                <div className="mono text-xs" style={{ width: 22, height: 22, borderRadius: 100, border: "1px solid var(--line-2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "var(--text-3)" }}>{i + 1}</div>
                <input className="input mono" placeholder="0x… wallet address" value={s.address} style={{ flex: "2 1 50%", minWidth: 180 }} onChange={(e) => setSigner(s.id, { address: e.target.value })} />
                <input className="input" placeholder="email (for the request)" value={s.email} style={{ flex: "1 1 30%", minWidth: 140 }} onChange={(e) => setSigner(s.id, { email: e.target.value })} />
                {draft.signers.length > 2 && (
                  <button className="btn btn-quiet" onClick={() => removeSigner(s.id)}><Trash2 size={14} /></button>
                )}
              </div>
            ))}
            {draft.signers.length < 5 && (
              <button className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }} onClick={addSigner}>
                <Plus size={14} /> Add signer
              </button>
            )}
          </div>

          <hr className="hr" />

          <div className="stack-12">
            <div className="between">
              <span className="text-sm">Required approvals</span>
              <span style={{ fontFamily: "var(--font-serif)", fontSize: 28, color: "var(--text-1)" }}>
                {draft.threshold} <span style={{ fontSize: 14, color: "var(--text-3)" }}>of {draft.signers.length}</span>
              </span>
            </div>
            <input type="range" min={1} max={Math.max(1, draft.signers.length)} step={1} value={draft.threshold} onChange={(e) => draft.set({ threshold: +e.target.value })} />
            <p className="text-xs">
              The safe stays sealed until any <strong>{draft.threshold} of {draft.signers.length}</strong> signers approve. No one can act alone.
            </p>
          </div>
        </div>
      )}

      <div className="between" style={{ marginTop: 32 }}>
        <button className="btn btn-ghost" onClick={() => router.push("/new/encrypt")}>
          <ArrowLeft size={14} strokeWidth={2} /> Back
        </button>
        <button className="btn btn-primary" disabled={!canContinue} onClick={() => router.push("/new/confirm")}>
          Continue <ArrowRight size={14} strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}

function emptySigner(): SignerDraft {
  return { id: makeSignerId(), name: "", address: "", chain: "aptos", email: "" }
}
