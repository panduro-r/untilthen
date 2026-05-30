import type { InputHTMLAttributes } from "react"

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string
  mono?: boolean
  hint?: string
}

export default function Input({ label, mono, hint, className = "", id, ...rest }: InputProps) {
  const input = (
    <input className={["input", mono ? "mono" : "", className].filter(Boolean).join(" ")} id={id} {...rest} />
  )
  if (!label && !hint) return input
  return (
    <div className="field">
      {label && (
        <label className="field-label" htmlFor={id}>
          {label}
        </label>
      )}
      {input}
      {hint && <span className="text-xs">{hint}</span>}
    </div>
  )
}
