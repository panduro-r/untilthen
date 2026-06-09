import type { Metadata } from "next"
import { Eyebrow } from "@/components/ui"
import { ShieldCheck, ShieldAlert } from "lucide-react"

export const metadata: Metadata = {
  title: "Security model — Until Then",
  description: "What Until Then protects against, what it cannot, in plain language.",
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <li className="text-body" style={{ marginBottom: 10, listStyle: "none", paddingLeft: 26, position: "relative" }}>
      {children}
    </li>
  )
}

export default function SecurityPage() {
  return (
    <div className="page page-narrow stack-32">
      <div className="stack-12">
        <Eyebrow>Security model</Eyebrow>
        <h1 className="h-1">What we can and cannot do</h1>
        <p className="text-body" style={{ maxWidth: 620 }}>
          Until Then is built so that <strong>no one — including us — can open your file before its
          condition is met</strong>. Here is the honest threat model: what that protects against, and
          what it does not.
        </p>
      </div>

      <div className="card" style={{ padding: 28 }}>
        <div className="center" style={{ gap: 10, marginBottom: 16, color: "var(--green)" }}>
          <ShieldCheck size={20} />
          <h2 className="h-2" style={{ color: "var(--text-1)" }}>What Until Then protects against</h2>
        </div>
        <ul style={{ margin: 0, padding: 0 }}>
          <Row>
            <Dot tone="green" /> <strong>A breach of our servers or database.</strong> The backend
            never holds a usable key. For time-lock safes it stores a drand-locked ciphertext that
            unlocks only at a future round; for multi-sig safes it stores material that needs a
            threshold of signer approvals. Dump the whole database and you still cannot decrypt.
          </Row>
          <Row>
            <Dot tone="green" /> <strong>A breach of the storage network.</strong> Shelby only ever
            holds ciphertext. Your file is encrypted in this browser with AES-256-GCM before it leaves.
          </Row>
          <Row>
            <Dot tone="green" /> <strong>Trying to open a time-lock early.</strong> It is
            mathematically prevented until the drand round publishes — the same timelock the rest of
            the world also can&apos;t shortcut.
          </Row>
          <Row>
            <Dot tone="green" /> <strong>A reused retrieval link.</strong> Each private link is
            single-use: the first claim burns it, and every later attempt returns the same
            &ldquo;no longer valid&rdquo; response.
          </Row>
          <Row>
            <Dot tone="green" /> <strong>Coercion or subpoena of the operator.</strong> We have no
            key to surrender.
          </Row>
        </ul>
      </div>

      <div className="card" style={{ padding: 28 }}>
        <div className="center" style={{ gap: 10, marginBottom: 16, color: "var(--amber)" }}>
          <ShieldAlert size={20} />
          <h2 className="h-2" style={{ color: "var(--text-1)" }}>What it cannot protect against</h2>
        </div>
        <ul style={{ margin: 0, padding: 0 }}>
          <Row>
            <Dot tone="amber" /> <strong>A compromised device at encryption time.</strong> If your
            machine is owned while you encrypt, the plaintext is right there. Nothing downstream helps.
          </Row>
          <Row>
            <Dot tone="amber" /> <strong>A compromised recipient email account.</strong> For email
            recipients, the link is the credential. Wallet recipients are immune to this — prefer them
            for the most sensitive safes.
          </Row>
          <Row>
            <Dot tone="amber" /> <strong>Malicious served code.</strong> Any browser-delivered crypto
            app could in principle be served backdoored JavaScript. This can&apos;t be fully
            eliminated, but it is made detectable: the source is published and the bundles will carry
            integrity hashes you can verify.
          </Row>
          <Row>
            <Dot tone="amber" /> <strong>Metadata.</strong> We can see that a safe exists, roughly
            when it releases, and how many parties are involved — but not its title, its contents, or
            who the recipients are (those are encrypted).
          </Row>
        </ul>
      </div>

      <div className="card" style={{ padding: 24, background: "var(--bg-2)", border: "1px dashed var(--line-2)" }}>
        <div className="text-xs muted" style={{ marginBottom: 8 }}>On a public time-lock</div>
        <p className="text-body" style={{ margin: 0, fontSize: 14 }}>
          A public safe proves a file existed and was sealed to open at a set time. It does{" "}
          <strong>not</strong> prove who created it or that the contents are true — only that they were
          fixed in advance and could not be altered after sealing.
        </p>
      </div>

      <p className="text-sm">
        The one-line version: <em>we cannot read your files, and neither can anyone who breaks into
        our servers. What you must still trust is your own device and the code we serve you — and that
        code is published so you can check we haven&apos;t tampered with it.</em>
      </p>
    </div>
  )
}

function Dot({ tone }: { tone: "green" | "amber" }) {
  const color = tone === "green" ? "var(--green)" : "var(--amber)"
  return (
    <span
      style={{
        position: "absolute",
        left: 6,
        top: 9,
        width: 7,
        height: 7,
        borderRadius: 100,
        background: color,
      }}
    />
  )
}
