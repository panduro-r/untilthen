import { create } from "zustand"

// Connected-wallet state + live bridges to the adapter. NOT persisted: the wallet adapter
// (autoConnect) is the source of truth and rehydrates on reload; WalletStateProvider repopulates
// this store from useWallet(). The live callbacks let non-React code (lib/aptos.ts) sign/submit
// without importing React. titleKey is the cached drop-independent owner title key (in-memory only).

export type WalletSignResult = { signatureHex: string; fullMessage: string }

type WalletState = {
  address: string | null
  publicKey: string | null // lowercase hex, no 0x
  walletName: string | null
  chain: "aptos"
  titleKey: CryptoKey | null

  // Live adapter bridges (in-memory; set by WalletStateProvider). Null when disconnected.
  signMessageFn: ((message: string) => Promise<WalletSignResult>) | null
  signAndSubmitFn: ((txn: unknown) => Promise<{ hash: string }>) | null
  disconnectFn: (() => void) | null

  setConnected: (c: {
    address: string
    publicKey: string | null
    walletName: string
    signMessageFn: (message: string) => Promise<WalletSignResult>
    signAndSubmitFn: (txn: unknown) => Promise<{ hash: string }>
    disconnectFn: () => void
  }) => void
  clear: () => void
  setTitleKey: (k: CryptoKey | null) => void
}

export const useWalletStore = create<WalletState>((set) => ({
  address: null,
  publicKey: null,
  walletName: null,
  chain: "aptos",
  titleKey: null,
  signMessageFn: null,
  signAndSubmitFn: null,
  disconnectFn: null,

  setConnected: (c) =>
    set({
      address: c.address,
      publicKey: c.publicKey,
      walletName: c.walletName,
      signMessageFn: c.signMessageFn,
      signAndSubmitFn: c.signAndSubmitFn,
      disconnectFn: c.disconnectFn,
    }),
  // Keep titleKey across a disconnect? No — it's owner-bound; clear it too.
  clear: () =>
    set({
      address: null,
      publicKey: null,
      walletName: null,
      titleKey: null,
      signMessageFn: null,
      signAndSubmitFn: null,
      disconnectFn: null,
    }),
  setTitleKey: (k) => set({ titleKey: k }),
}))
