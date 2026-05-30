import Link from "next/link"
import { Button, Eyebrow, TrustBadge } from "@/components/ui"

// Landing placeholder — the full hero (vault illustration, feature cards) is built in the pages
// pass. This establishes the shell + design language so tokens/fonts/primitives can be verified.
export default function Home() {
  return (
    <main className="app-shell">
      <div
        className="page"
        style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 48, alignItems: "center" }}
      >
        <div className="stack-24">
          <Eyebrow>Dead man&apos;s switch · client-side encryption</Eyebrow>
          <h1 className="h-display">
            Leave it sealed.
            <br />
            <em>Released only when it must be.</em>
          </h1>
          <p className="text-body" style={{ maxWidth: 460 }}>
            Encrypt a file in your browser, store the ciphertext on Shelby, and set a condition — a
            time-lock or a multi-sig of people you trust. No server ever sees the plaintext, and no
            one — including us — can open it early.
          </p>
          <div className="row" style={{ alignItems: "center", gap: 14 }}>
            <Link href="/dashboard">
              <Button size="lg">Get started</Button>
            </Link>
            <Link href="/security">
              <Button variant="ghost" size="lg">
                How it works
              </Button>
            </Link>
          </div>
          <TrustBadge />
        </div>

        <div className="vault" aria-hidden>
          <div className="vault-ring" />
          <div className="vault-ring r2" />
          <div className="vault-ring r3" />
          <div className="vault-core">SEALED</div>
        </div>
      </div>
    </main>
  )
}
