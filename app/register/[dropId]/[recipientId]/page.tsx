"use client"

import { useParams } from "next/navigation"
import { useState } from "react"
import { Check, ShieldCheck } from "lucide-react"
import { useWalletStore } from "@/store/wallet"
import { signMessageFull } from "@/lib/aptos"
import { registerMessage } from "@/lib/crypto"
import { formatAddress } from "@/lib/ids"
import { Eyebrow, Button } from "@/components/ui"
import ConnectGate from "@/components/wallet/ConnectGate"

export default function RegisterPage() {
  return (
    <ConnectGate>
      <Register />
    </ConnectGate>
  )
}

function Register() {
  const { dropId, recipientId } = useParams<{ dropId: string; recipientId: string }>()
  const address = useWalletStore((s) => s.address)!
  const publicKey = useWalletStore((s) => s.publicKey)
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  const register = async () => {
    setStatus("loading")
    setError(null)
    try {
      if (!publicKey) throw new Error("Reconnect your wallet and try again.")
      const signed = await signMessageFull(registerMessage(dropId))
      const res = await fetch(`/api/register/${dropId}/${recipientId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: address,
          walletChain: "aptos",
          registrationSignature: signed.signatureHex,
          publicKey,
          fullMessage: signed.fullMessage,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || "Registration failed. Please try again.")
      }
      setStatus("done")
    } catch (e) {
      console.error("[register] failed:", e)
      setError(e instanceof Error ? e.message : "Registration failed.")
      setStatus("error")
    }
  }

  return (
    <div className="page page-narrow stack-24">
      <div className="stack-12">
        <Eyebrow>Recipient registration</Eyebrow>
        <h1 className="h-1">Register your wallet</h1>
        <p className="text-body" style={{ maxWidth: 560 }}>
          Someone designated this wallet as a recipient on a DeadDrop. Registering binds your half of
          the key to your wallet, so only you can open the file if the drop releases. You sign once —
          nothing is sent on-chain and there&apos;s no fee.
        </p>
      </div>

      <div className="card" style={{ padding: 28 }}>
        {status === "done" ? (
          <div className="center" style={{ gap: 12 }}>
            <span style={{ color: "var(--green)" }}><Check size={22} strokeWidth={2} /></span>
            <div>
              <div className="h-3">Registered</div>
              <p className="text-sm" style={{ marginTop: 4 }}>
                You can close this page. If the drop releases, you&apos;ll receive a one-time link by email.
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
              <span className="trust-badge"><ShieldCheck size={13} /> Binds the key to this wallet</span>
              <Button onClick={register} disabled={status === "loading"}>
                {status === "loading" ? "Signing…" : "Register this wallet"}
              </Button>
            </div>
            {error && <p className="text-sm" style={{ color: "var(--red)", marginTop: 14 }}>{error}</p>}
          </>
        )}
      </div>

      <p className="text-xs muted">
        Make sure this is the wallet the drop owner expects. Once you register, the owner uses your
        wallet to seal your half of the key.
      </p>
    </div>
  )
}
