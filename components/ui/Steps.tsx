import { Fragment } from "react"
import Link from "next/link"
import { Check, X } from "lucide-react"

// Horizontal progress indicator for the create flow. `current` is the 0-based active step index.
// `cancelHref` (optional) adds a Cancel link on the right that leaves the flow.
export default function Steps({
  current,
  steps,
  cancelHref,
}: {
  current: number
  steps: string[]
  cancelHref?: string
}) {
  return (
    <div className="between" style={{ gap: 16, alignItems: "center" }}>
      <div className="steps">
        {steps.map((label, i) => (
          <Fragment key={label}>
            <div className={["step", i === current ? "active" : "", i < current ? "done" : ""].filter(Boolean).join(" ")}>
              <div className="num">{i < current ? <Check size={12} strokeWidth={2} /> : i + 1}</div>
              <div className="label">{label}</div>
            </div>
            {i < steps.length - 1 && <div className="sep" />}
          </Fragment>
        ))}
      </div>
      {cancelHref && (
        <Link href={cancelHref} className="btn btn-quiet btn-sm" style={{ color: "var(--text-3)", flexShrink: 0 }}>
          <X size={13} strokeWidth={2} /> Cancel
        </Link>
      )}
    </div>
  )
}
