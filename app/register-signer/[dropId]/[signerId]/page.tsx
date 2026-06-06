"use client"

import { useParams } from "next/navigation"
import { useState } from "react"
import { Check, Users } from "lucide-react"
import { useWalletStore } from "@/store/wallet"
import { signMessageFull } from "@/lib/aptos"
import { signerRegisterMessage } from "@/lib/auth"
import { deriveSignerEncKeypair, signerEncMessage } from "@/lib/signerKeys"
import { b64 } from "@/lib/crypto"
import { formatAddress } from "@/lib/ids"
import { Eyebrow, Button } from "@/components/ui"
import ConnectGate from "@/components/wallet/ConnectGate"

export default function RegisterSignerPage() {
  return (
    <ConnectGate>
      <RegisterSigner />
    </ConnectGate>
  )
}

function RegisterSigner() {
  const { dropId, signerId } = useParams<{ dropId: string; signerId: string }>()
  const address = useWalletStore((s) => s.address)!
  const publicKey = useWalletStore((s) => s.publicKey)
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  const register = async () => {
    setStatus("loading")
    setError(null)
    try {
      if (!publicKey) throw new Error("Reconnect your wallet and try again.")
      // 1. Derive a deterministic X25519 enc keypair from a wallet signature (reproduced at approval).
      const encSig = await signMessageFull(signerEncMessage(dropId))
      const { publicKey: encPub } = await deriveSignerEncKeypair(encSig.signatureHex)
      const encPublicKey = b64(encPub)
      // 2. Prove the enc pubkey is bound to this wallet.
      const proof = await signMessageFull(signerRegisterMessage(dropId, encPublicKey))
      const res = await fetch(`/api/register-signer/${dropId}/${signerId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: address,
          walletChain: "aptos",
          encPublicKey,
          proofSignature: proof.signatureHex,
          publicKey,
          fullMessage: proof.fullMessage,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || "Registration failed. Please try again.")
      }
      setStatus("done")
    } catch (e) {
      console.error("[register-signer] failed:", e)
      setError(e instanceof Error ? e.message : "Registration failed.")
      setStatus("error")
    }
  }

  return (
    <div className="page page-narrow stack-24">
      <div className="stack-12">
        <Eyebrow>Signer registration</Eyebrow>
        <h1 className="h-1">Register as a signer</h1>
        <p className="text-body" style={{ maxWidth: 560 }}>
          A DeadDrop owner named this wallet as a trusted signer. Registering publishes an encryption
          key (derived from your wallet — nothing leaves your device) so the owner can seal your share
          of the release key to you. You&apos;ll approve later, when the time is right.
        </p>
      </div>

      <div className="card" style={{ padding: 28 }}>
        {status === "done" ? (
          <div className="center" style={{ gap: 12 }}>
            <span style={{ color: "var(--green)" }}><Check size={22} strokeWidth={2} /></span>
            <div>
              <div className="h-3">Registered as a signer</div>
              <p className="text-sm" style={{ marginTop: 4 }}>
                You can close this page. The owner will be emailed an approval link when the drop is
                ready for your signature.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="stack-8" style={{ marginBottom: 20 }}>
              <span className="field-label">Connected wallet</span>
              <span className="mono" style={{ fontSize: 14 }}>{formatAddress(address, 10, 8)}</span>
            </div>
            <div className="between" style={{ flexWrap: "wrap", gap: 12 }}>
              <span className="trust-badge"><Users size={13} /> Key derived from your wallet</span>
              <Button onClick={register} disabled={status === "loading"}>
                {status === "loading" ? "Signing…" : "Register as signer"}
              </Button>
            </div>
            <p className="text-xs muted" style={{ marginTop: 14 }}>
              You&apos;ll sign twice — once to derive your encryption key, once to prove it&apos;s yours.
            </p>
            {error && <p className="text-sm" style={{ color: "var(--red)", marginTop: 12 }}>{error}</p>}
          </>
        )}
      </div>
    </div>
  )
}
