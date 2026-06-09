"use client"

import { useCallback, useState, type ReactNode } from "react"
import { Lock, ShieldCheck } from "lucide-react"
import { useWalletStore } from "@/store/wallet"
import { useSessionStore } from "@/store/session"
import { useUiStore } from "@/store/ui"
import { signIn } from "@/lib/sessionClient"
import { Button } from "@/components/ui"

// Wraps authed pages. Always requires a connected wallet. When `requireSession` is set (owner pages),
// it also requires a SIWA sign-in — connecting alone is not "logged in"; you must sign the ownership
// message. Recipient/signer pages omit `requireSession` (they're a different actor doing one action).
export default function ConnectGate({
  children,
  requireSession = false,
}: {
  children: ReactNode
  requireSession?: boolean
}) {
  const address = useWalletStore((s) => s.address)
  const sessionAddress = useSessionStore((s) => s.address)
  const sessionReady = useSessionStore((s) => s.ready)
  const openConnect = useUiStore((s) => s.openConnect)

  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const doSignIn = useCallback(async () => {
    setSigningIn(true)
    setError(null)
    try {
      await signIn()
    } catch {
      setError("Sign-in was cancelled. Sign the message to continue.")
    } finally {
      setSigningIn(false)
    }
  }, [])

  // 1. No wallet → connect prompt.
  if (!address) {
    return (
      <Centered>
        <span style={{ color: "var(--text-3)" }}><Lock size={30} strokeWidth={1.2} /></span>
        <h1 className="h-1">Connect your wallet</h1>
        <p className="text-body" style={{ maxWidth: 420 }}>
          Your wallet signs uploads and proves ownership. We never see your private key.
        </p>
        <Button size="lg" onClick={openConnect}>Connect wallet</Button>
      </Centered>
    )
  }

  // 2. Owner pages: must sign in (SIWA). Connecting alone doesn't grant access.
  if (requireSession && (!sessionReady || !sessionAddress)) {
    return (
      <Centered>
        <span style={{ color: "var(--text-3)" }}><ShieldCheck size={30} strokeWidth={1.2} /></span>
        <h1 className="h-1">Verify wallet ownership</h1>
        <p className="text-body" style={{ maxWidth: 440 }}>
          Sign a message to prove you control this wallet. It costs nothing and authorizes no
          transaction — it just signs you in (on this and any other device).
        </p>
        <Button size="lg" onClick={doSignIn} disabled={signingIn || !sessionReady}>
          <ShieldCheck size={15} strokeWidth={2} />
          {!sessionReady ? "Checking…" : signingIn ? "Waiting for signature…" : "Sign in"}
        </Button>
        {error && <p className="text-sm" style={{ color: "var(--red)" }}>{error}</p>}
      </Centered>
    )
  }

  return <>{children}</>
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div
      className="page page-narrow"
      style={{ paddingTop: 80, display: "flex", flexDirection: "column", alignItems: "center", gap: 14, textAlign: "center" }}
    >
      {children}
    </div>
  )
}
