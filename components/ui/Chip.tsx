import type { ReactNode } from "react"

// Tones match the design's chip classes. "armed" amber, "released"/"triggered" red, "expired" muted,
// "ok" green; "default" has no dot.
export type ChipTone = "default" | "armed" | "released" | "triggered" | "expired" | "ok"

export default function Chip({ tone = "default", children }: { tone?: ChipTone; children: ReactNode }) {
  return (
    <span className={`chip ${tone === "default" ? "" : tone}`.trim()}>
      {tone !== "default" && tone !== "expired" && <span className="chip-dot" />}
      {children}
    </span>
  )
}
