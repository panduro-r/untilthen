import { create } from "zustand"

// Shared UI state: the connect-wallet modal + the funding modal, openable from the topbar, a connect
// gate, or the post-connect balance check.
type UiState = {
  connectOpen: boolean
  openConnect: () => void
  closeConnect: () => void
  fundingOpen: boolean
  openFunding: () => void
  closeFunding: () => void
}

export const useUiStore = create<UiState>((set) => ({
  connectOpen: false,
  openConnect: () => set({ connectOpen: true }),
  closeConnect: () => set({ connectOpen: false }),
  fundingOpen: false,
  openFunding: () => set({ fundingOpen: true }),
  closeFunding: () => set({ fundingOpen: false }),
}))
