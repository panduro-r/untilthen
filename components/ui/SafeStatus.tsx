"use client"

import { useEffect, useState } from "react"
import Chip from "./Chip"

// Status chip that bridges the gap between a time-lock countdown hitting zero and the release actually
// being processed (QStash → /api/cron/release flips the DB status a moment later). During that window
// it shows "Releasing…" instead of a stuck "Armed". Self-contained: one timer that fires exactly at
// the trigger time — no polling, no parent re-render needed.
export default function SafeStatus({
  status,
  mode,
  triggerAt,
}: {
  status: "armed" | "released" | "expired"
  mode: "timelock" | "multisig"
  triggerAt: number | null
}) {
  const pending = status === "armed" && mode === "timelock" && !!triggerAt
  const [releasing, setReleasing] = useState(() => pending && Date.now() >= (triggerAt ?? 0))

  useEffect(() => {
    if (!pending || !triggerAt) return
    const delay = triggerAt - Date.now()
    // Already past is handled by the lazy initial state. setTimeout overflows past ~24.8 days, so only
    // schedule within range (Shelbynet releases are < 48h anyway).
    if (delay <= 0 || delay >= 2_147_483_647) return
    const id = setTimeout(() => setReleasing(true), delay)
    return () => clearTimeout(id)
  }, [pending, triggerAt])

  if (status === "released") return <Chip tone="released">Released</Chip>
  if (status === "expired") return <Chip tone="expired">Expired</Chip>
  if (pending && releasing) return <Chip tone="armed">Releasing…</Chip>
  if (status === "armed") return <Chip tone="armed">Armed</Chip>
  return null
}
