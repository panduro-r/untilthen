"use client"

import { useParams } from "next/navigation"
import { CheckCircle2 } from "lucide-react"
import { Eyebrow } from "@/components/ui"

// Multisig signer approval. Publishing an approval is an on-chain action against the deployed Move
// contract (lib/contract.ts approveRelease), so this page activates once multisig ships. Placeholder
// so the route resolves and the status is honest.
export default function ApprovePage() {
  const { dropId } = useParams<{ dropId: string; signerId: string }>()
  return (
    <div className="page page-narrow stack-24">
      <div className="stack-12">
        <Eyebrow>Release approval</Eyebrow>
        <h1 className="h-1">Approve a release</h1>
        <p className="text-body" style={{ maxWidth: 560 }}>
          Your approval is requested on drop <span className="mono">{dropId}</span>. When enough
          signers approve, the file becomes decryptable by its recipients. You can approve only when
          you judge the time is right.
        </p>
      </div>
      <div className="card" style={{ padding: 28 }}>
        <div className="center" style={{ gap: 12 }}>
          <span style={{ color: "var(--amber)" }}><CheckCircle2 size={22} /></span>
          <div>
            <div className="h-3">Multi-sig is rolling out</div>
            <p className="text-sm" style={{ marginTop: 4, maxWidth: 480 }}>
              On-chain approvals activate once the contract is deployed. You&apos;ll be emailed the
              approval link when the drop is ready for your signature.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
