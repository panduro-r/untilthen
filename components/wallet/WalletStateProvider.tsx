"use client"

// Bridges the Aptos wallet adapter's React state into our Zustand store, so non-React code
// (lib/aptos.ts) can read the address and call sign/submit/disconnect.
//
// KEY RULE: a wallet is only "connected" to the app AFTER it proves ownership (SIWA signature).
// The adapter connecting is necessary but NOT sufficient — we don't populate the store (which is what
// the whole app treats as "connected") until the sign-in succeeds. Decline the signature → we
// disconnect the adapter and stay logged out. No "connected but unsigned" state exists.

import { useEffect, useRef } from "react"
import { useWallet } from "@aptos-labs/wallet-adapter-react"
import { useWalletStore, type WalletSignResult } from "@/store/wallet"
import { fromWalletNetwork, LAST_NETWORK_KEY } from "@/lib/networks"
import { useUiStore } from "@/store/ui"
import { useDraftStore } from "@/store/draft"
import { useDropsStore } from "@/store/drops"
import { hasMinimumBalance, isTestNetwork } from "@/lib/funding"
import { refreshSession, loginWith, signOut } from "@/lib/sessionClient"
import { useSessionStore } from "@/store/session"

// Wipe per-wallet client state when the active wallet goes away or changes, so the next wallet never
// sees the previous owner's in-progress create-flow draft (in-memory) or cached dashboard drops
// (localStorage). Crypto material lives only in the draft, so this also clears it from memory.
function clearWalletScopedState() {
  useDraftStore.getState().reset()
  useDropsStore.getState().clear()
}

// Fixed nonce → the wallet's signMessage produces a DETERMINISTIC signature for a given message,
// which is required for the wrap-key derivation to be reproducible at registration vs retrieval.
const FIXED_NONCE = "deaddrop"

function toHexNo0x(v: unknown): string {
  const s = typeof v === "string" ? v : String(v)
  return (s.startsWith("0x") || s.startsWith("0X") ? s.slice(2) : s).toLowerCase()
}

export default function WalletStateProvider({ children }: { children: React.ReactNode }) {
  const { connected, account, wallet, network, signMessage, signAndSubmitTransaction, disconnect } = useWallet()
  const setConnected = useWalletStore((s) => s.setConnected)
  const setNetwork = useWalletStore((s) => s.setNetwork)
  const clear = useWalletStore((s) => s.clear)
  // Guards against running the connect→sign handshake more than once for the same adapter session.
  const handledFor = useRef<string | null>(null)

  const address = account?.address?.toString() ?? null

  // The app's active network FOLLOWS the wallet — this is the only place it's set. Re-runs whenever
  // the user switches network in Petra (the adapter updates `network`). Maps to an AppNetwork; an
  // unrecognized network maps to null so the UI can prompt a switch.
  const networkName = network?.name ?? null
  const networkChainId = network?.chainId ?? null
  const networkUrl = network?.url ?? null
  useEffect(() => {
    if (networkName == null && networkChainId == null && networkUrl == null) {
      setNetwork(null, null)
      return
    }
    const mapped = fromWalletNetwork({
      name: networkName ?? undefined,
      chainId: networkChainId ?? undefined,
      url: networkUrl ?? undefined,
    })
    // Remember the last supported network so the dashboard can filter correctly DURING a reconnect
    // (when the live network is briefly null), instead of flashing safes from another network.
    try {
      if (mapped) localStorage.setItem(LAST_NETWORK_KEY, mapped)
    } catch {
      /* localStorage unavailable */
    }
    setNetwork(
      mapped,
      networkName,
    )
  }, [networkName, networkChainId, networkUrl, setNetwork])

  useEffect(() => {
    // Adapter not connected → clear the in-memory connection, but KEEP the server session cookie.
    // Switching accounts in Petra disconnects the adapter; preserving the cookie is what lets the
    // user get silently signed back in when they switch BACK to the same wallet (refreshSession on
    // reconnect restores it with no new signature). The cookie is dropped only by an explicit Sign
    // out, or below when a DIFFERENT wallet connects (the stale-session mismatch branch). This
    // mirrors the frameloop reference app, which never signs out the cookie on adapter disconnect.
    if (!(connected && account && address)) {
      const wasConnected = handledFor.current !== null
      clear()
      handledFor.current = null
      useSessionStore.getState().setReady(true)
      // Only wipe on a REAL disconnect (we were connected) — not on the initial pre-autoConnect
      // mount, which would needlessly nuke the persisted drops cache on every page load.
      if (wasConnected) clearWalletScopedState()
      return
    }

    // Already ran the handshake for this connection.
    if (handledFor.current === address) return
    // Account changed without an intervening disconnect event (some Petra switches fire accountChange
    // directly) — clear the previous wallet's state before handshaking the new one.
    if (handledFor.current !== null && handledFor.current !== address) clearWalletScopedState()
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
      const net = useWalletStore.getState().network ?? undefined
      if (net && isTestNetwork(net)) {
        // Best-effort nudge to fund a low wallet. The balance read can take several seconds on a cold
        // /rate-limited public fullnode (esp. Testnet), so cap it and treat a timeout as "fine" — never
        // block on it, and never pop the funding modal just because the read was slow.
        Promise.race([
          hasMinimumBalance(address, net),
          new Promise<boolean>((r) => setTimeout(() => r(true), 4000)),
        ])
          .then((ok) => {
            if (!ok) useUiStore.getState().openFunding()
          })
          .catch(() => {})
      }
    }

    ;(async () => {
      // Already proved ownership recently (valid session cookie) → connect without a new popup.
      const existing = await refreshSession()
      if (existing === lower) {
        markConnected()
        return
      }
      if (existing && existing !== lower) await signOut() // stale session for another wallet

      if (!publicKey) {
        await safeDisconnect()
        return
      }

      // Otherwise require the ownership signature NOW. Success → connected. Decline → disconnected.
      try {
        await loginWith({ address, publicKey, signMessage: signMessageFn })
        markConnected()
      } catch {
        useSessionStore.getState().setAddress(null)
        clear()
        await safeDisconnect()
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, address])

  return <>{children}</>
}
