import Link from "next/link"

export default function Footer() {
  return (
    <footer className="footer">
      <div className="center" style={{ gap: 14, flexWrap: "wrap" }}>
        <span>© Until Then</span>
        <span className="faint">·</span>
        <span>Client-side encryption · no custody</span>
      </div>
      <div className="row" style={{ gap: 18, flexWrap: "wrap", alignItems: "center" }}>
        <span className="mono">v0.1.0</span>
        <span className="faint">·</span>
        <Link href="/faq">FAQ</Link>
        <span className="faint">·</span>
        <Link href="/security">Security</Link>
      </div>
    </footer>
  )
}
