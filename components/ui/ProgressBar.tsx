type Tone = "default" | "amber" | "red"

// Amber/red fill. `value` is 0..1.
export default function ProgressBar({ value, tone = "default" }: { value: number; tone?: Tone }) {
  const pct = Math.max(0, Math.min(1, value)) * 100
  return (
    <div className={`progress ${tone === "default" ? "" : tone}`.trim()}>
      <div className="progress-bar" style={{ width: `${pct}%` }} />
    </div>
  )
}
