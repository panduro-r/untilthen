"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Upload, File as FileIcon, X, Check, Lock, ArrowRight, Info } from "lucide-react"
import { dropId as makeDropId } from "@/lib/ids"
import { useDraftStore } from "@/store/draft"
import { generateKey, encryptBytes, exportKey, fingerprintOf } from "@/lib/armDrop"
import { packFileWithName } from "@/lib/crypto"
import { Steps, Eyebrow, TrustBadge, Button, ProgressBar } from "@/components/ui"
import ConnectGate from "@/components/wallet/ConnectGate"

const STEPS = ["Encrypt file", "Set condition", "Add recipients", "Confirm"]

export default function EncryptPage() {
  return (
    <ConnectGate>
      <Encrypt />
    </ConnectGate>
  )
}

type Phase = "idle" | "encrypting" | "done"

function Encrypt() {
  const router = useRouter()
  const draft = useDraftStore()
  const [file, setFile] = useState<File | null>(null)
  const [phase, setPhase] = useState<Phase>(draft.ciphertext ? "done" : "idle")
  const [progress, setProgress] = useState(draft.ciphertext ? 100 : 0)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Allocate the dropId once at the start of the flow.
  useEffect(() => {
    if (!draft.dropId) draft.set({ dropId: makeDropId() })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pick = (f: File) => {
    setFile(f)
    setPhase("idle")
    setProgress(0)
    draft.set({ fileMeta: { name: f.name, size: f.size, type: f.type }, ciphertext: null, iv: null, keyBytes: null, fingerprint: null })
  }

  const encrypt = async () => {
    if (!file) return
    setPhase("encrypting")
    setProgress(20)
    const key = await generateKey()
    // Pack the original filename into the plaintext so the recipient gets it (and its extension) back
    // on download — without it ever touching the server (it's inside the ciphertext).
    const packed = packFileWithName(file.name, new Uint8Array(await file.arrayBuffer()))
    setProgress(55)
    const { ciphertext, iv } = await encryptBytes(packed, key)
    const fingerprint = await fingerprintOf(ciphertext)
    const keyBytes = await exportKey(key)
    setProgress(100)
    draft.set({ ciphertext, iv, keyBytes, fingerprint })
    setPhase("done")
  }

  const meta = file
    ? { name: file.name, size: file.size, type: file.type }
    : draft.fileMeta

  return (
    <div className="page page-narrow">
      <Steps current={0} steps={STEPS} cancelHref="/dashboard" />
      <div style={{ height: 32 }} />

      <div className="stack-12" style={{ marginBottom: 28 }}>
        <Eyebrow>Step 01 / Encrypt</Eyebrow>
        <h1 className="h-1">Pick something to seal.</h1>
        <p className="text-body" style={{ maxWidth: 560 }}>
          Drag any file in. We&apos;ll encrypt it in your browser before it goes anywhere. The key
          never leaves this tab.
        </p>
      </div>

      {!meta && (
        <div
          className={`dropzone ${dragOver ? "active" : ""}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) pick(f) }}
        >
          <span style={{ color: "var(--text-3)" }}><Upload size={32} strokeWidth={1.2} /></span>
          <div className="h-2" style={{ marginTop: 14, fontWeight: 400 }}>Drop a file or click to choose</div>
          <div className="text-xs" style={{ marginTop: 6 }}>Up to 100 MB · any file type</div>
          <input ref={fileRef} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f) }} />
        </div>
      )}

      {meta && (
        <div className="card" style={{ padding: 24 }}>
          <div className="between">
            <div className="center" style={{ gap: 14 }}>
              <div style={{ width: 44, height: 44, borderRadius: 10, background: "var(--bg-2)", border: "1px solid var(--line-1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <FileIcon size={20} />
              </div>
              <div className="stack-4">
                <div style={{ fontSize: 15 }}>{meta.name}</div>
                <div className="text-xs">
                  {meta.size > 1024 * 1024 ? `${(meta.size / 1024 / 1024).toFixed(1)} MB` : `${(meta.size / 1024).toFixed(1)} KB`}
                  {" · "}{meta.type || "binary"}
                </div>
              </div>
            </div>
            {phase === "idle" && (
              <Button variant="quiet" onClick={() => { setFile(null); draft.set({ fileMeta: null }) }}>
                <X size={14} /> Change
              </Button>
            )}
          </div>

          {phase !== "idle" && (
            <>
              <hr className="hr" />
              <div className="stack-12">
                <div className="between">
                  <div className="center" style={{ gap: 10 }}>
                    {phase === "done" ? <span style={{ color: "var(--green)" }}><Check size={16} strokeWidth={2} /></span> : <Lock size={16} />}
                    <span className="text-sm" style={{ color: "var(--text-1)" }}>
                      {phase === "encrypting" ? "Encrypting locally…" : "Sealed."}
                    </span>
                  </div>
                  <span className="mono text-xs">{Math.round(progress)}%</span>
                </div>
                <ProgressBar value={progress / 100} tone={phase === "done" ? "default" : "amber"} />
                {draft.fingerprint && (
                  <div style={{ marginTop: 8 }}>
                    <div className="text-xs" style={{ marginBottom: 6 }}>Ciphertext fingerprint</div>
                    <div className="fingerprint">{draft.fingerprint}</div>
                  </div>
                )}
              </div>
            </>
          )}

          <hr className="hr" />
          <div className="between" style={{ flexWrap: "wrap", gap: 12 }}>
            <TrustBadge label="Encrypted on this device · AES-256-GCM" />
            <div className="row">
              {phase === "idle" && file && (
                <Button onClick={encrypt}>Encrypt &amp; continue <ArrowRight size={14} strokeWidth={2} /></Button>
              )}
              {phase === "done" && (
                <Button onClick={() => router.push("/new/condition")}>Set release condition <ArrowRight size={14} strokeWidth={2} /></Button>
              )}
            </div>
          </div>
        </div>
      )}

      <p className="text-xs" style={{ marginTop: 24, maxWidth: 560 }}>
        <Info size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
        The key is split: half is gated by your release rule, half is wrapped per recipient. Even if
        our servers were breached, no one can read your file.
      </p>
    </div>
  )
}
