"use client"

// Bridges the Aptos wallet adapter's React state into our Zustand store, so non-React code
// (lib/aptos.ts) can read the address and call sign/submit/disconnect.
//
// KEY RULE: a wallet is only "connected" to the app AFTER it proves ownership (SIWA signature).
// The adapter connecting is necessary but NOT sufficient — we don't populate the store (which is what
// the whole app treats as "connected") until the sign-in succeeds. Decline the signature → we
// disconnect the adapter and stay logged out. No "connected but unsigned" state exists.

import { useCallback, useEffect, useRef } from "react"
import { useWallet, PETRA_WALLET_NAME } from "@aptos-labs/wallet-adapter-react"
import { useWalletStore, type WalletSignResult } from "@/store/wallet"
import { useUiStore } from "@/store/ui"
import { hasMinimumBalance, isTestNetwork } from "@/lib/funding"
import { readActiveWalletAddress, onWalletAccountChange, sameAddress } from "@/lib/aptos"
import { refreshSession, loginWith, signOut } from "@/lib/sessionClient"
import { useSessionStore } from "@/store/session"

// Fixed nonce → the wallet's signMessage produces a DETERMINISTIC signature for a given message,
// which is required for the wrap-key derivation to be reproducible at registration vs retrieval.
const FIXED_NONCE = "deaddrop"

function toHexNo0x(v: unknown): string {
  const s = typeof v === "string" ? v : String(v)
  return (s.startsWith("0x") || s.startsWith("0X") ? s.slice(2) : s).toLowerCase()
}

export default function WalletStateProvider({ children }: { children: React.ReactNode }) {
  const { connected, account, wallet, signMessage, signAndSubmitTransaction, disconnect, connect } = useWallet()
  const setConnected = useWalletStore((s) => s.setConnected)
  const clear = useWalletStore((s) => s.clear)
  // Guards against running the connect→sign handshake more than once for the same adapter session.
  const handledFor = useRef<string | null>(null)

  const address = account?.address?.toString() ?? null

  // --- Auto-detect in-extension Petra account switches ---
  // The adapter only learns of a switch if Petra pushes the AIP-62 event, which it does
  // unreliably. We instead detect via Petra's legacy provider (a focus-time pull + its
  // onAccountChange) and resync by reconnecting the adapter, which refreshes its signer to the
  // now-active account; the main handshake below then signs the user in as that wallet.
  const connectRef = useRef(connect)
  const disconnectRef = useRef(disconnect)
  const resyncing = useRef(false)
  const subscribed = useRef(false)
  useEffect(() => {
    connectRef.current = connect
    disconnectRef.current = disconnect
  }, [connect, disconnect])

  const maybeResync = useCallback(async () => {
    if (resyncing.current) return
    const current = useWalletStore.getState().address
    if (!current) return // app is logged out — never auto-connect
    const active = await readActiveWalletAddress()
    console.info("[wallet] maybeResync: petra-active =", active, "| app-current =", current)
    if (!active || sameAddress(active, current)) return // unchanged, or legacy provider unavailable
    console.info("[wallet] switch detected → reconnecting adapter to active account")
    resyncing.current = true
    try {
      await disconnectRef.current()
      await connectRef.current(PETRA_WALLET_NAME)
    } catch (e) {
      console.error("[wallet] account-switch resync failed:", e)
    } finally {
      resyncing.current = false
    }
  }, [])

  useEffect(() => {
    if (!subscribed.current) {
      subscribed.current = true
      onWalletAccountChange(() => void maybeResync()) // Petra legacy has no unsubscribe; fire once
    }
    const onFocus = () => void maybeResync()
    const onVisible = () => {
      if (document.visibilityState === "visible") void maybeResync()
    }
    window.addEventListener("focus", onFocus)
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      window.removeEventListener("focus", onFocus)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [maybeResync])

  useEffect(() => {
    // Adapter not connected → app is logged out. Reset everything.
    if (!(connected && account && address)) {
      console.info("[wallet] adapter disconnected → clearing app state")
      clear()
      handledFor.current = null
      if (useSessionStore.getState().address) void signOut()
      useSessionStore.getState().setAddress(null)
      useSessionStore.getState().setReady(true)
      return
    }

    console.info("[wallet] adapter reports account =", address, "(public key:", account.publicKey?.toString(), ")")

    // Already ran the handshake for this connection.
    if (handledFor.current === address) return
    handledFor.current = address

    const signMessageFn = async (message: string): Promise<WalletSignResult> => {
      const out = await signMessage({ message, nonce: FIXED_NONCE })
      return { signatureHex: toHexNo0x(out.signature), fullMessage: out.fullMessage }
    }
    const signAndSubmitFn = async (txn: unknown): Promise<{ hash: string }> => {
      const res = await signAndSubmitTransaction(txn as Parameters<typeof signAndSubmitTransaction>[0])
      return { hash: res.hash }
    }
    const publicKey = account.publicKey ? toHexNo0x(account.publicKey.toString()) : null
    const lower = address.toLowerCase()
    const safeDisconnect = async () => {
      try {
        await disconnect()
      } catch {
        /* ignore */
      }
    }

    // Mark the app "connected" — only ever called after ownership is proven.
    const markConnected = () => {
      setConnected({
        address,
        publicKey,
        walletName: wallet?.name ?? "Wallet",
        signMessageFn,
        signAndSubmitFn,
        disconnectFn: disconnect,
      })
      if (isTestNetwork()) {
        hasMinimumBalance(address)
          .then((ok) => {
            if (!ok) useUiStore.getState().openFunding()
          })
          .catch(() => {})
      }
    }

    ;(async () => {
      // Already proved ownership recently (valid session cookie) → connect without a new popup.
      const existing = await refreshSession()
      console.info("[wallet] existing session =", existing, "| handshaking for =", lower)
      if (existing === lower) {
        console.info("[wallet] session matches → connected as", address)
        markConnected()
        return
      }
      if (existing && existing !== lower) await signOut() // stale session for another wallet

      if (!publicKey) {
        console.warn("[wallet] no public key from adapter → disconnecting")
        await safeDisconnect()
        return
      }

      // Otherwise require the ownership signature NOW. Success → connected. Decline → disconnected.
      try {
        await loginWith({ address, publicKey, signMessage: signMessageFn })
        console.info("[wallet] sign-in succeeded → connected as", address)
        markConnected()
      } catch (e) {
        console.error("[wallet] sign-in failed/declined for", address, e)
        useSessionStore.getState().setAddress(null)
        clear()
        await safeDisconnect()
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, address])

  return <>{children}</>
}
