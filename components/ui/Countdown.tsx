"use client"

import { useEffect, useState } from "react"

const TWO_DAYS_MS = 2 * 86_400_000
const pad = (n: number) => String(n).padStart(2, "0")

function parts(ms: number) {
  if (ms <= 0) return { d: 0, h: 0, m: 0, s: 0 }
  const s = Math.floor(ms / 1000)
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 }
}

type Props = {
  /** Target time, epoch ms. */
  to: number
  /** Large serif display (drop detail / public page) vs inline mono. */
  big?: boolean
  /** Override the auto tone (auto = amber when < 2 days remain). */
  tone?: "default" | "amber" | "triggered"
}

export default function Countdown({ to, big = false, tone }: Props) {
  const [now, setNow] = useState<number>(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const remaining = Math.max(0, to - now)
  const t = parts(remaining)
  const auto = remaining <= 0 ? "triggered" : remaining < TWO_DAYS_MS ? "amber" : "default"
  const resolved = tone ?? auto
  const color =
    resolved === "amber" ? "var(--amber)" : resolved === "triggered" ? "var(--red)" : "var(--text-1)"

  if (big) {
    return (
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, color }}>
        <span className="countdown"><span className="big">{t.d}</span><span className="unit">days</span></span>
        <span className="countdown"><span className="big">{pad(t.h)}</span><span className="unit">hrs</span></span>
        <span className="countdown"><span className="big">{pad(t.m)}</span><span className="unit">min</span></span>
        <span className="countdown"><span className="big">{pad(t.s)}</span><span className="unit">sec</span></span>
      </div>
    )
  }
  return (
    <span className="mono" style={{ fontVariantNumeric: "tabular-nums", color, fontSize: 15 }}>
      {t.d}d {pad(t.h)}:{pad(t.m)}:{pad(t.s)}
    </span>
  )
}
