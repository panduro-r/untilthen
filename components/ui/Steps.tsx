import { Fragment } from "react"
import { Check } from "lucide-react"

// Horizontal progress indicator for the create flow. `current` is the 0-based active step index.
export default function Steps({ current, steps }: { current: number; steps: string[] }) {
  return (
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
  )
}
