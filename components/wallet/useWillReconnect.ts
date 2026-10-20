"use client"

import { useEffect, useState } from "react"
import { useWallet, WalletReadyState } from "@aptos-labs/wallet-adapter-react"
import { ADAPTER_WALLET_KEY } from "@/lib/networks"
import { useClientValue } from "@/lib/useClientValue"

// How long a stored wallet gets to show up before we conclude its extension is gone. Extensions register
// at page load, so this only ever elapses when the wallet really isn't there.
const DETECT_GRACE_MS = 2000

// Will the adapter auto-reconnect on this page load? A stored wallet name alone isn't enough: if that
// wallet's extension was removed or disabled, the adapter never attempts the reconnect and never clears
// isLoading, so trusting the name left the UI "Reconnecting…" forever. Trust it while the wallet is
// detected (however long the reconnect itself takes), or briefly while extensions are still
// registering. If the extension turns up later anyway, the adapter reconnects and this flips back.
export function useWillReconnect(): { storageRead: boolean; willReconnect: boolean } {
  // Both leave their server snapshot in the same post-hydration render, so once `storageRead` is true
  // `storedName` is real.
  const storageRead = useClientValue(() => true, false)
  const storedName = useClientValue(() => localStorage.getItem(ADAPTER_WALLET_KEY), null)
  const { wallets } = useWallet()
  const detected = wallets.some((w) => w.name === storedName && w.readyState === WalletReadyState.Installed)

  const [gaveUp, setGaveUp] = useState(false)
  useEffect(() => {
    if (!storedName || detected) return
    const timer = setTimeout(() => setGaveUp(true), DETECT_GRACE_MS)
    return () => clearTimeout(timer)
  }, [storedName, detected])

  return { storageRead, willReconnect: !!storedName && (detected || !gaveUp) }
}
