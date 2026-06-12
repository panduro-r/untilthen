"use client"

import { useEffect } from "react"
import { useDraftStore } from "@/store/draft"

// Wraps the whole create flow (encrypt → condition → confirm). This layout stays mounted while you
// move BETWEEN steps, but unmounts when you leave /new entirely (dashboard, security, logo, etc.).
// Resetting the draft on that unmount means returning to "New safe" always starts fresh, instead of
// dropping you back where you left off.
export default function NewFlowLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    return () => {
      useDraftStore.getState().reset()
    }
  }, [])

  return <>{children}</>
}
