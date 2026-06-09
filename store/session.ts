// store/session.ts — client-side SIWA session state (the signed-in owner address).
// Source of truth is the HttpOnly cookie on the server; this mirrors it for UI rendering.

import { create } from "zustand"

type SessionState = {
  address: string | null // lowercased owner address, or null when signed out
  ready: boolean // true once we've checked the server session at least once
  setAddress: (address: string | null) => void
  setReady: (ready: boolean) => void
}

export const useSessionStore = create<SessionState>((set) => ({
  address: null,
  ready: false,
  setAddress: (address) => set({ address }),
  setReady: (ready) => set({ ready }),
}))
