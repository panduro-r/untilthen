"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { Key, Check, Globe, Lock } from "lucide-react"
import { fetchPublicMeta, retrievePublic, triggerDownload, type PublicMeta } from "@/lib/decrypt"
import { Eyebrow, Countdown, Button } from "@/components/ui"

// "live" = metadata loaded; whether it's armed vs ready is derived from the clock in render.
type Phase = "loading" | "live" | "decrypting" | "done" | "error"

export default function PublicRetrievePage() {
  const { dropId } = useParams<{ dropId: string }>()
  const [meta, setMeta] = useState<PublicMeta | null>(null)
  const [phase, setPhase] = useState<Phase>("loading")
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState<number>(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    fetchPublicMeta(dropId)
      .then((m) => { setMeta(m); setPhase("live") })
      .catch((e) => { setError(e.message); setPhase("error") })
  }, [dropId])

  const released = !!meta && (meta.status === "released" || (meta.triggerAt != null && now >= meta.triggerAt))

  const decrypt = async () => {
    if (!meta) return
    setPhase("decrypting")
    setError(null)
    try {
      const bytes = await retrievePublic(meta)
      triggerDownload(bytes, `deaddrop-${dropId}`)
      setPhase("done")
    } catch (e) {
      console.error("[public retrieve] failed:", e)
      setError(e instanceof Error ? e.message : "We couldn't open this drop yet.")
      setPhase("live")
    }
  }

  const sealed = phase === "live" && !released

  return (
    <div className="page page-narrow">
      <div className="stack-12" style={{ marginBottom: 28 }}>
        <Eyebrow><Globe size={11} style={{ verticalAlign: "-1px", marginRight: 6 }} />Public drop · {dropId}</Eyebrow>
        <h1 className="h-1">
          {sealed ? "Sealed until release." : phase === "done" ? "Opened." : "A sealed file is waiting here."}
        </h1>
        <p className="text-body">
          This file is encrypted and time-locked. When the timer reaches zero, anyone on this page can
          decrypt and download it — entirely in their own browser.
        </p>
      </div>

      <div className="card" style={{ padding: 32 }}>
        {phase === "loading" && <p className="text-body" style={{ margin: 0 }}>Loading…</p>}
        {phase === "error" && <p className="text-body" style={{ margin: 0, color: "var(--red)" }}>{error}</p>}

        {sealed && meta?.triggerAt != null && (
          <>
            <Eyebrow>Opens in</Eyebrow>
            <div style={{ marginTop: 16 }}><Countdown to={meta.triggerAt} big /></div>
            <p className="text-sm" style={{ marginTop: 18, margin: "18px 0 0" }}>
              No server is needed to open this — the unlock is pure drand timelock math, computed
              right here when the round publishes.
            </p>
          </>
        )}

        {((phase === "live" && released) || phase === "decrypting") && (
          <div className="stack-16">
            <div className="center" style={{ gap: 10 }}>
              <Lock size={16} />
              <span className="text-sm" style={{ color: "var(--text-1)" }}>
                {phase === "decrypting" ? "Decrypting in your browser…" : "Released. Ready to decrypt."}
              </span>
            </div>
            {error && <p className="text-sm" style={{ color: "var(--red)", margin: 0 }}>{error}</p>}
            <Button size="lg" style={{ width: "100%" }} disabled={phase === "decrypting"} onClick={decrypt}>
              <Key size={14} /> {phase === "decrypting" ? "Decrypting…" : "Decrypt & download"}
            </Button>
          </div>
        )}

        {phase === "done" && (
          <div className="stack-16">
            <div className="center" style={{ gap: 10, color: "var(--green)" }}>
              <Check size={18} strokeWidth={2} />
              <span style={{ fontSize: 15 }}>Decrypted successfully — check your downloads.</span>
            </div>
            <Button variant="ghost" onClick={decrypt}>Download again</Button>
          </div>
        )}
      </div>

      <p className="text-xs muted" style={{ marginTop: 18 }}>
        What a public time-lock proves: the content was fixed and committed before the release time.
        It does not prove the content is true. See the security page.
      </p>
    </div>
  )
}
