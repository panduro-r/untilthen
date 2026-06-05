"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { Clock, Users, Lock, Globe, ArrowLeft, ArrowRight } from "lucide-react"
import { useDraftStore } from "@/store/draft"
import { Steps, Eyebrow } from "@/components/ui"
import ConnectGate from "@/components/wallet/ConnectGate"

const STEPS = ["Encrypt file", "Set condition", "Add recipients", "Confirm"]

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

  useEffect(() => {
    if (!draft.ciphertext) router.replace("/new/encrypt")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const days = Math.round(draft.checkInHours / 24)

  return (
    <div className="page page-narrow">
      <Steps current={1} steps={STEPS} />
      <div style={{ height: 32 }} />

      <div className="stack-12" style={{ marginBottom: 28 }}>
        <Eyebrow>Step 02 / Condition</Eyebrow>
        <h1 className="h-1">When &amp; for whom should it open?</h1>
        <p className="text-body" style={{ maxWidth: 560 }}>
          Choose who can open it and what releases the key. You can change the timer later by signing
          from the same wallet.
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
            <div className="text-sm">A check-in timer. If you don&apos;t reset it in time, the safe opens automatically.</div>
          </div>
          <div className="text-xs muted">Auto-releases if you go silent</div>
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
          <h3 className="h-3" style={{ marginBottom: 20 }}>Check-in interval</h3>
          <div className="stack-12">
            <div className="between">
              <span className="text-sm">Reset every</span>
              <span style={{ fontFamily: "var(--font-serif)", fontSize: 32, color: "var(--text-1)" }}>
                {days} <span style={{ fontSize: 16, color: "var(--text-3)" }}>days</span>
              </span>
            </div>
            <input type="range" min={24} max={365 * 24} step={24} value={draft.checkInHours} onChange={(e) => draft.set({ checkInHours: +e.target.value })} />
            <div className="between text-xs muted"><span>1 day</span><span>1 year</span></div>
          </div>
          <hr className="hr" />
          <div className="stack-12">
            <div className="between">
              <span className="text-sm">Grace period before release</span>
              <span className="mono" style={{ color: "var(--text-1)" }}>{draft.graceDays} day{draft.graceDays !== 1 ? "s" : ""}</span>
            </div>
            <input type="range" min={1} max={30} step={1} value={draft.graceDays} onChange={(e) => draft.set({ graceDays: +e.target.value })} />
          </div>
          <div className="card" style={{ padding: 18, marginTop: 24, background: "var(--bg-2)", border: "1px dashed var(--line-2)" }}>
            <div className="text-xs muted" style={{ marginBottom: 8 }}>In plain words</div>
            <p className="text-body" style={{ margin: 0, color: "var(--text-1)", fontSize: 14 }}>
              Every <strong>{days} days</strong> you&apos;ll sign a quick &ldquo;I&apos;m still here&rdquo; message. If you go
              silent for more than {days + draft.graceDays} days total, the key is released
              {draft.distribution === "public" ? " publicly" : " to your recipients"} automatically.
            </p>
          </div>
        </div>
      )}

      {draft.mode === "multisig" && (
        <div className="card" style={{ padding: 28 }}>
          <h3 className="h-3" style={{ marginBottom: 8 }}>Trusted signers</h3>
          <div className="urgent-banner" style={{ background: "color-mix(in oklch, var(--amber) 10%, var(--bg-1))", borderColor: "color-mix(in oklch, var(--amber) 35%, var(--line-1))", color: "var(--amber)" }}>
            <span>Multisig drops need the on-chain contract deployed and each signer to register their
            approval key first. That flow is coming next — pick Time-lock to arm a drop today.</span>
          </div>
        </div>
      )}

      <div className="between" style={{ marginTop: 32 }}>
        <button className="btn btn-ghost" onClick={() => router.push("/new/encrypt")}>
          <ArrowLeft size={14} strokeWidth={2} /> Back
        </button>
        <button className="btn btn-primary" onClick={() => router.push("/new/confirm")}>
          Continue <ArrowRight size={14} strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}
