"use client"

import { useParams } from "next/navigation"
import { Users } from "lucide-react"
import { Eyebrow } from "@/components/ui"

// Multisig signer registration. The end-to-end signer flow (establish a BLS key share, then approve
// release on-chain) requires the deployed Move contract + the owner-dealt group key. That ships with
// multisig (gated in the arm flow today). This page exists so the route resolves and explains status.
export default function RegisterSignerPage() {
  const { dropId } = useParams<{ dropId: string; signerId: string }>()
  return (
    <div className="page page-narrow stack-24">
      <div className="stack-12">
        <Eyebrow>Signer registration</Eyebrow>
        <h1 className="h-1">You&apos;ve been asked to be a signer</h1>
        <p className="text-body" style={{ maxWidth: 560 }}>
          A DeadDrop owner named this wallet as a trusted signer for drop{" "}
          <span className="mono">{dropId}</span>. As a signer, your approval (with others) is what
          releases the file — no single person can act alone.
        </p>
      </div>
      <div className="card" style={{ padding: 28 }}>
        <div className="center" style={{ gap: 12 }}>
          <span style={{ color: "var(--amber)" }}><Users size={22} /></span>
          <div>
            <div className="h-3">Multi-sig is rolling out</div>
            <p className="text-sm" style={{ marginTop: 4, maxWidth: 480 }}>
              Signer registration goes live once the on-chain contract is deployed to the network.
              You&apos;ll get an email with a one-tap setup link the moment it&apos;s ready. Nothing is
              required from you right now.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
