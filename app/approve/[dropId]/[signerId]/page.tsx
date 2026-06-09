"use client"

import { useParams } from "next/navigation"
import { useEffect, useState } from "react"
import { Check, CheckCircle2 } from "lucide-react"
import { useWalletStore } from "@/store/wallet"
import { signMessageFull } from "@/lib/aptos"
import { signerEncMessage, deriveSignerEncKeypair, eciesDecryptAsSigner } from "@/lib/signerKeys"
import { produceSignatureShare } from "@/lib/threshold"
import { walletContractClient, type AptosMoveContractClient } from "@/lib/contract.aptos"
import { Eyebrow, Button, Chip } from "@/components/ui"
import ConnectGate from "@/components/wallet/ConnectGate"

const norm = (a: string) => (a.startsWith("0x") ? a.slice(2) : a).toLowerCase().padStart(64, "0")

export default function ApprovePage() {
  return (
    <ConnectGate>
      <Approve />
    </ConnectGate>
  )
}

type DropState = { threshold: number; approvals: number; signers: string[]; released: boolean; mine: boolean; alreadyApproved: boolean }

function Approve() {
  const { dropId } = useParams<{ dropId: string; signerId: string }>()
  const address = useWalletStore((s) => s.address)!
  const signAndSubmit = useWalletStore((s) => s.signAndSubmitFn)
  const contractAddress = process.env.NEXT_PUBLIC_DEADDROP_CONTRACT_ADDRESS

  const [drop, setDrop] = useState<DropState | null>(null)
  const [status, setStatus] = useState<"idle" | "loading" | "approving" | "error">("loading")
  const [error, setError] = useState<string | null>(null)

  const client: AptosMoveContractClient | null =
    contractAddress && signAndSubmit ? walletContractClient(contractAddress, signAndSubmit) : null

  useEffect(() => {
    if (!client) return
    let cancelled = false
    ;(async () => {
      const d = await client.getDrop(dropId)
      if (cancelled) return
      if (!d) {
        setDrop(null)
        setStatus("idle")
        return
      }
      setDrop({
        threshold: d.threshold,
        approvals: d.approvals.length,
        signers: d.signers,
        released: d.released,
        mine: d.signers.some((s) => norm(s) === norm(address)),
        alreadyApproved: d.approvals.some((a) => norm(a) === norm(address)),
      })
      setStatus("idle")
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dropId, address, contractAddress])

  const approve = async () => {
    if (!client || !drop) return
    setStatus("approving")
    setError(null)
    try {
      const index = drop.signers.findIndex((s) => norm(s) === norm(address)) + 1
      if (index === 0) throw new Error("This wallet isn't a signer on this safe.")
      // 1. Read our encrypted share from chain; decrypt with the wallet-derived enc key.
      const encShare = await client.getEncKeyShareFor(dropId, drop.signers[index - 1])
      if (!encShare) throw new Error("Couldn't find your key share on chain.")
      const encSig = await signMessageFull(signerEncMessage(dropId))
      const { privateKey } = await deriveSignerEncKeypair(encSig.signatureHex)
      const shareScalar = await eciesDecryptAsSigner(privateKey, encShare)
      // 2. Produce a BLS signature share over the drop identity and publish it on chain.
      const share = produceSignatureShare({ dropId, shareScalar: toB64(shareScalar), index })
      await client.approveRelease(dropId, address, share)
      // 3. Refresh.
      const d = await client.getDrop(dropId)
      if (d) {
        setDrop({
          threshold: d.threshold,
          approvals: d.approvals.length,
          signers: d.signers,
          released: d.released,
          mine: true,
          alreadyApproved: true,
        })
      }
      setStatus("idle")
    } catch (e) {
      console.error("[approve] failed:", e)
      setError(e instanceof Error ? e.message : "Approval failed. Please try again.")
      setStatus("error")
    }
  }

  return (
    <div className="page page-narrow stack-24">
      <div className="stack-12">
        <Eyebrow>Release approval</Eyebrow>
        <h1 className="h-1">Approve a release</h1>
        <p className="text-body" style={{ maxWidth: 560 }}>
          Drop <span className="mono">{dropId}</span>. When enough signers approve, the file becomes
          decryptable by its recipients. Approve only when you judge the time is right.
        </p>
      </div>

      {!contractAddress ? (
        <Notice text="Multi-sig isn't configured on this deployment yet." />
      ) : status === "loading" ? (
        <Notice text="Reading the safe from chain…" />
      ) : !drop ? (
        <Notice text="We couldn't find this safe on chain. It may not be armed yet." />
      ) : !drop.mine ? (
        <Notice text="This wallet isn't a signer on this safe." />
      ) : (
        <div className="card" style={{ padding: 28 }}>
          <div className="between" style={{ marginBottom: 16 }}>
            <div style={{ fontFamily: "var(--font-serif)", fontSize: 40, color: "var(--amber)" }}>
              {drop.approvals} <span style={{ color: "var(--text-3)", fontSize: 20 }}>of {drop.threshold}</span>
            </div>
            {drop.released ? <Chip tone="released">Released</Chip> : <Chip tone="armed">Awaiting approvals</Chip>}
          </div>
          {drop.released ? (
            <p className="text-sm">Threshold met — the drop is released. Recipients can now decrypt.</p>
          ) : drop.alreadyApproved ? (
            <div className="center" style={{ gap: 10, color: "var(--green)" }}>
              <Check size={18} strokeWidth={2} />
              <span className="text-sm" style={{ color: "var(--text-1)" }}>You&apos;ve approved. Waiting on the rest.</span>
            </div>
          ) : (
            <>
              <p className="text-sm" style={{ marginBottom: 18 }}>
                Approving publishes your signature share on chain (one wallet transaction + a signature
                to unlock your share).
              </p>
              <Button onClick={approve} disabled={status === "approving"}>
                <CheckCircle2 size={14} /> {status === "approving" ? "Approving…" : "Approve release"}
              </Button>
            </>
          )}
          {error && <p className="text-sm" style={{ color: "var(--red)", marginTop: 14 }}>{error}</p>}
        </div>
      )}
    </div>
  )
}

function Notice({ text }: { text: string }) {
  return (
    <div className="card" style={{ padding: 28 }}>
      <p className="text-sm" style={{ margin: 0 }}>{text}</p>
    </div>
  )
}

// local base64 (avoid importing the whole crypto module just for this)
function toB64(bytes: Uint8Array): string {
  let bin = ""
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}
