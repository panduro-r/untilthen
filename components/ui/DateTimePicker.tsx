"use client"

import { useEffect, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, CalendarDays, Lock } from "lucide-react"

const DAY = 86_400_000
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"]
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]
const PRESETS = [
  { label: "In 30 days", ms: 30 * DAY },
  { label: "In 90 days", ms: 90 * DAY },
  { label: "In 1 year", ms: 365 * DAY },
]

function fmtField(ms: number): string {
  const d = new Date(ms)
  const date = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  return `${date} · ${time}`
}

function startOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function DateTimePicker({
  value,
  onChange,
  min,
}: {
  value: number
  onChange: (ms: number) => void
  min?: number
}) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState(() => new Date(value || Date.now()))
  const [mountNow] = useState(() => Date.now())
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [open])

  const sel = value ? new Date(value) : null
  const y = view.getFullYear()
  const m = view.getMonth()
  const firstDow = new Date(y, m, 1).getDay()
  const daysInMonth = new Date(y, m + 1, 0).getDate()
  const minDay = startOfDay(min ?? mountNow)
  const todayStart = startOfDay(mountNow)

  const pickDay = (day: number) => {
    const base = value ? new Date(value) : (() => { const d = new Date(); d.setHours(9, 0, 0, 0); return d })()
    onChange(new Date(y, m, day, base.getHours(), base.getMinutes(), 0, 0).getTime())
  }
  const bump = (part: "h" | "m", delta: number) => {
    const d = new Date(value || Date.now())
    if (part === "h") d.setHours(d.getHours() + delta)
    else d.setMinutes(d.getMinutes() + delta)
    onChange(d.getTime())
  }
  const setPm = (pm: boolean) => {
    const d = new Date(value || Date.now())
    const isPm = d.getHours() >= 12
    if (pm && !isPm) d.setHours(d.getHours() + 12)
    if (!pm && isPm) d.setHours(d.getHours() - 12)
    onChange(d.getTime())
  }

  const hour12 = sel ? (sel.getHours() % 12 || 12) : 9
  const minute = sel ? sel.getMinutes() : 0
  const isPm = sel ? sel.getHours() >= 12 : false

  // Editable hour/minute fields: keep a local string buffer so the user can type freely; commit only
  // valid in-range values. An effect re-syncs the buffer from `value` (preset / day / stepper changes)
  // unless a field is currently being edited.
  const [hourStr, setHourStr] = useState("")
  const [minStr, setMinStr] = useState("")
  const editing = useRef(false)
  useEffect(() => {
    if (editing.current) return
    setHourStr(String(hour12).padStart(2, "0"))
    setMinStr(String(minute).padStart(2, "0"))
  }, [hour12, minute])
  const commitHour = (raw: string) => {
    setHourStr(raw)
    const n = parseInt(raw, 10)
    if (!Number.isNaN(n) && n >= 1 && n <= 12) {
      const d = new Date(value || mountNow)
      d.setHours((n % 12) + (d.getHours() >= 12 ? 12 : 0))
      onChange(d.getTime())
    }
  }
  const commitMin = (raw: string) => {
    setMinStr(raw)
    const n = parseInt(raw, 10)
    if (!Number.isNaN(n) && n >= 0 && n <= 59) {
      const d = new Date(value || mountNow)
      d.setMinutes(n)
      onChange(d.getTime())
    }
  }

  const cells: ({ day: number; cur: boolean })[] = []
  for (let i = 0; i < 42; i++) {
    const dayNum = i - firstDow + 1
    if (dayNum < 1 || dayNum > daysInMonth) cells.push({ day: 0, cur: false })
    else cells.push({ day: dayNum, cur: true })
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button type="button" className="input dtp-field" onClick={() => setOpen((o) => !o)}>
        <span style={{ color: value ? "var(--text-1)" : "var(--text-3)" }}>
          {value ? fmtField(value) : "Pick a date & time"}
        </span>
        <CalendarDays size={15} style={{ color: "var(--text-3)" }} />
      </button>

      {open && (
        <div className="dtp-pop card">
          <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
            {PRESETS.map((p) => (
              <button key={p.label} type="button" className="dtp-chip" onClick={() => onChange(Date.now() + p.ms)}>
                {p.label}
              </button>
            ))}
          </div>
          <div style={{ height: 1, background: "var(--line-1)", margin: "0 -22px 16px" }} />

          <div style={{ display: "flex", gap: 20 }}>
            <div style={{ flex: 1 }}>
              <div className="between" style={{ marginBottom: 10 }}>
                <span style={{ fontSize: 14, fontWeight: 500 }}>{MONTHS[m]} {y}</span>
                <span className="row" style={{ gap: 6 }}>
                  <button type="button" className="dtp-tbtn" aria-label="Previous month" onClick={() => setView(new Date(y, m - 1, 1))}><ChevronLeft size={14} /></button>
                  <button type="button" className="dtp-tbtn" aria-label="Next month" onClick={() => setView(new Date(y, m + 1, 1))}><ChevronRight size={14} /></button>
                </span>
              </div>
              <div className="dtp-grid">
                {WEEKDAYS.map((w, i) => <div key={i} className="dtp-dow">{w}</div>)}
                {cells.map((c, i) => {
                  if (!c.cur) return <span key={i} />
                  const cellMs = new Date(y, m, c.day).getTime()
                  const disabled = cellMs < minDay
                  const isSel = !!sel && sel.getFullYear() === y && sel.getMonth() === m && sel.getDate() === c.day
                  const isToday = todayStart === cellMs
                  return (
                    <button
                      key={i}
                      type="button"
                      disabled={disabled}
                      className={`dtp-day${isSel ? " sel" : ""}${isToday && !isSel ? " today" : ""}`}
                      onClick={() => pickDay(c.day)}
                    >
                      {c.day}
                    </button>
                  )
                })}
              </div>
            </div>

            <div style={{ width: 120, borderLeft: "1px solid var(--line-1)", paddingLeft: 18 }}>
              <span className="text-xs muted" style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.1em" }}>TIME</span>
              <div className="row" style={{ alignItems: "center", gap: 6, marginTop: 14 }}>
                <div style={{ textAlign: "center" }}>
                  <button type="button" className="dtp-tbtn" aria-label="Hour up" onClick={() => bump("h", 1)}><ChevronUp size={14} /></button>
                  <input
                    className="dtp-time" value={hourStr} inputMode="numeric" maxLength={2} aria-label="Hour"
                    onFocus={(e) => { editing.current = true; e.currentTarget.select() }}
                    onBlur={() => { editing.current = false; setHourStr(String(hour12).padStart(2, "0")) }}
                    onChange={(e) => commitHour(e.target.value.replace(/\D/g, ""))}
                  />
                  <button type="button" className="dtp-tbtn" aria-label="Hour down" onClick={() => bump("h", -1)}><ChevronDown size={14} /></button>
                </div>
                <span style={{ fontSize: 20, color: "var(--text-3)", fontFamily: "var(--font-mono)" }}>:</span>
                <div style={{ textAlign: "center" }}>
                  <button type="button" className="dtp-tbtn" aria-label="Minute up" onClick={() => bump("m", 1)}><ChevronUp size={14} /></button>
                  <input
                    className="dtp-time" value={minStr} inputMode="numeric" maxLength={2} aria-label="Minute"
                    onFocus={(e) => { editing.current = true; e.currentTarget.select() }}
                    onBlur={() => { editing.current = false; setMinStr(String(minute).padStart(2, "0")) }}
                    onChange={(e) => commitMin(e.target.value.replace(/\D/g, ""))}
                  />
                  <button type="button" className="dtp-tbtn" aria-label="Minute down" onClick={() => bump("m", -1)}><ChevronDown size={14} /></button>
                </div>
              </div>
              <div className="row" style={{ gap: 6, marginTop: 16, background: "var(--bg-0)", border: "1px solid var(--line-1)", borderRadius: 9, padding: 3 }}>
                <button type="button" className={`dtp-ampm${!isPm ? " on" : ""}`} onClick={() => setPm(false)}>AM</button>
                <button type="button" className={`dtp-ampm${isPm ? " on" : ""}`} onClick={() => setPm(true)}>PM</button>
              </div>
            </div>
          </div>

          <div style={{ height: 1, background: "var(--line-1)", margin: "18px -22px 14px" }} />
          <div className="between">
            <span className="text-xs muted"><Lock size={12} style={{ verticalAlign: -2 }} /> you can postpone this anytime before the release date</span>
            <button type="button" className="btn btn-primary btn-sm" disabled={!value} onClick={() => setOpen(false)}>Set date</button>
          </div>
        </div>
      )}
    </div>
  )
}
