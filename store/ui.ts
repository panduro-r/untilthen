import { create } from "zustand"

// Shared UI state: the connect-wallet modal, openable from the topbar or any connect gate.
type UiState = {
  connectOpen: boolean
  openConnect: () => void
  closeConnect: () => void
}

export const useUiStore = create<UiState>((set) => ({
  connectOpen: false,
  openConnect: () => set({ connectOpen: true }),
  closeConnect: () => set({ connectOpen: false }),
}))
