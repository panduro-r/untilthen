import type { ButtonHTMLAttributes, ReactNode } from "react"

type Variant = "primary" | "ghost" | "quiet" | "danger"
type Size = "sm" | "md" | "lg"

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: Size
  children: ReactNode
}

const sizeClass: Record<Size, string> = { sm: "btn-sm", md: "", lg: "btn-lg" }

export default function Button({ variant = "primary", size = "md", className = "", children, ...rest }: ButtonProps) {
  const cls = ["btn", `btn-${variant}`, sizeClass[size], className].filter(Boolean).join(" ")
  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  )
}
