"use client"

import { useState } from "react"
import { useParams } from "next/navigation"
import { File as FileIcon, Key, Check, Info, AlertTriangle } from "lucide-react"
import { retrievePrivate, triggerDownload } from "@/lib/decrypt"
import { Eyebrow, Button } from "@/components/ui"

type Phase = "idle" | "decrypting" | "done" | "gone"

export default function PrivateRetrievePage() {
  const { dropId, recipientId } = useParams<{ dropId: string; recipientId: string }>()
  const [ack, setAck] = useState(false)
  const [phase, setPhase] = useState<Phase>("idle")
  const [error, setError] = useState<string | null>(null)

  const decrypt = async () => {
    // The email link carries the secret in the URL fragment (never sent to the server). Read it
    // only at decrypt time.
    const secret = window.location.hash.replace(/^#/, "")
    if (!secret) {
      setError("This looks like a wallet-recipient link — that retrieval path is coming next.")
      return
    }
    setPhase("decrypting")
    setError(null)
    try {
      const bytes = await retrievePrivate({ dropId, recipientId, urlSecretB64Url: secret })
      triggerDownload(bytes, `deaddrop-${dropId}`)
      setPhase("done")
    } catch (e) {
      console.error("[retrieve] failed:", e)
      const msg = e instanceof Error ? e.message : "Something went wrong."
      if (msg.includes("no longer valid")) setPhase("gone")
      else { setError(msg); setPhase("idle") }
    }
  }

  if (phase === "gone") {
    return (
      <div className="page page-narrow" style={{ paddingTop: 64, display: "flex", flexDirection: "column", alignItems: "center", gap: 14, textAlign: "center" }}>
        <span style={{ color: "var(--text-3)" }}><AlertTriangle size={30} strokeWidth={1.4} /></span>
        <h1 className="h-1">This link is no longer valid.</h1>
        <p className="text-body" style={{ maxWidth: 440 }}>
          It may have already been used, expired, or the drop hasn&apos;t released yet. One-time links
          can only be opened once.
        </p>
      </div>
    )
  }

  return (
    <div className="page page-narrow">
      <div className="urgent-banner" style={{ marginBottom: 28 }}>
        <span className="pulse" />
        <span>A DeadDrop addressed to you has been released.</span>
      </div>

      <div className="stack-12" style={{ marginBottom: 32 }}>
        <Eyebrow>Incoming · for you</Eyebrow>
        <h1 className="h-1">A file has been left for you.</h1>
        <p className="text-body">
          Someone used DeadDrop to set aside an encrypted file for you, to be released under a
          condition that has now been met. It opens entirely in your browser.
        </p>
      </div>

      <div className="card" style={{ padding: 28 }}>
        <div className="row" style={{ gap: 18, alignItems: "flex-start" }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, flexShrink: 0, background: "var(--bg-2)", border: "1px solid var(--line-1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <FileIcon size={26} strokeWidth={1.2} />
          </div>
          <div className="stack-4" style={{ flex: 1 }}>
            <div style={{ fontSize: 17 }}>Encrypted file</div>
            <div className="text-xs">AES-256-GCM · decrypts on this device only</div>
            <div className="text-xs mono" style={{ marginTop: 8, color: "var(--text-4)" }}>{dropId}</div>
          </div>
        </div>

        <hr className="hr" />

        {phase !== "done" ? (
          <>
            <div className="stack-12" style={{ marginBottom: 20 }}>
              <div className="center" style={{ gap: 10 }}><Info size={14} /><span className="text-sm">Before you continue</span></div>
              <ul className="text-sm" style={{ margin: 0, paddingLeft: 18, color: "var(--text-2)" }}>
                <li>Decryption happens entirely in your browser — your copy never leaves this device.</li>
                <li>You don&apos;t need a wallet or an account to retrieve this.</li>
                <li>This link is single-use. Save the file once you&apos;ve downloaded it.</li>
              </ul>
            </div>
            <label className="row" style={{ alignItems: "center", gap: 10, cursor: "pointer", marginBottom: 16 }}>
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} style={{ width: 16, height: 16, accentColor: "var(--amber)" }} />
              <span className="text-sm" style={{ color: "var(--text-1)" }}>I understand this link can only be used once.</span>
            </label>
            {error && <p className="text-sm" style={{ color: "var(--red)", marginBottom: 12 }}>{error}</p>}
            <Button size="lg" style={{ width: "100%" }} disabled={!ack || phase === "decrypting"} onClick={decrypt}>
              <Key size={14} /> {phase === "decrypting" ? "Decrypting…" : "Decrypt & download"}
            </Button>
          </>
        ) : (
          <div className="center" style={{ gap: 10, color: "var(--green)" }}>
            <Check size={18} strokeWidth={2} />
            <span style={{ fontSize: 15 }}>Decrypted successfully — check your downloads. This link is now used up.</span>
          </div>
        )}
      </div>
    </div>
  )
}
