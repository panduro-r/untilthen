"use client"

// Bridges the Aptos wallet adapter's React state into our Zustand store, so non-React code
// (lib/aptos.ts) can read the address and call sign/submit/disconnect. Behavioral wrapper only —
// renders children directly.

import { useEffect } from "react"
import { useWallet } from "@aptos-labs/wallet-adapter-react"
import { useWalletStore, type WalletSignResult } from "@/store/wallet"
import { useUiStore } from "@/store/ui"
import { hasMinimumBalance, isTestNetwork } from "@/lib/funding"

// Fixed nonce → the wallet's signMessage produces a DETERMINISTIC signature for a given message,
// which is required for the wrap-key derivation to be reproducible at registration vs retrieval.
const FIXED_NONCE = "deaddrop"

function toHexNo0x(v: unknown): string {
  const s = typeof v === "string" ? v : String(v)
  return (s.startsWith("0x") || s.startsWith("0X") ? s.slice(2) : s).toLowerCase()
}

export default function WalletStateProvider({ children }: { children: React.ReactNode }) {
  const { connected, account, wallet, signMessage, signAndSubmitTransaction, disconnect } = useWallet()
  const setConnected = useWalletStore((s) => s.setConnected)
  const clear = useWalletStore((s) => s.clear)

  const address = account?.address?.toString() ?? null

  useEffect(() => {
    if (connected && account && address) {
      const signMessageFn = async (message: string): Promise<WalletSignResult> => {
        const out = await signMessage({ message, nonce: FIXED_NONCE })
        return { signatureHex: toHexNo0x(out.signature), fullMessage: out.fullMessage }
      }
      const signAndSubmitFn = async (txn: unknown): Promise<{ hash: string }> => {
        // The adapter's InputTransactionData is opaque to us here; pass through.
        const res = await signAndSubmitTransaction(txn as Parameters<typeof signAndSubmitTransaction>[0])
        return { hash: res.hash }
      }
      setConnected({
        address,
        publicKey: account.publicKey ? toHexNo0x(account.publicKey.toString()) : null,
        walletName: wallet?.name ?? "Wallet",
        signMessageFn,
        signAndSubmitFn,
        disconnectFn: disconnect,
      })
      // Post-connect funding check (test networks only): nudge if they can't afford to arm.
      if (isTestNetwork()) {
        hasMinimumBalance(address)
          .then((ok) => {
            if (!ok) useUiStore.getState().openFunding()
          })
          .catch(() => {})
      }
    } else {
      clear()
    }
    // Re-sync when connection or the active address changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, address])

  return <>{children}</>
}
