"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Wallet, LogOut, ChevronDown } from "lucide-react"
import { useWalletStore } from "@/store/wallet"
import { useUiStore } from "@/store/ui"
import { disconnectWallet } from "@/lib/aptos"
import { formatAddress } from "@/lib/ids"
import ConnectModal from "@/components/wallet/ConnectModal"

export default function Topbar() {
  const address = useWalletStore((s) => s.address)
  const openConnect = useUiStore((s) => s.openConnect)
  const pathname = usePathname()
  const authed = !!address

  const navCls = (active: boolean) => (active ? "active" : "")

  return (
    <header className="topbar">
      <Link href={authed ? "/dashboard" : "/"} className="brand" style={{ textDecoration: "none" }}>
        <div className="brand-mark" />
        <div className="brand-name">Until Then</div>
      </Link>

      <div className="topbar-spacer" />

      <nav className="topbar-nav">
        {authed ? (
          <>
            <Link href="/dashboard" className={navCls(pathname === "/dashboard")}>Dashboard</Link>
            <Link href="/new/encrypt" className={navCls(pathname.startsWith("/new"))}>New drop</Link>
            <Link href="/security" className={navCls(pathname === "/security")}>Security</Link>
          </>
        ) : (
          <>
            <Link href="/" className={navCls(pathname === "/")}>Overview</Link>
            <Link href="/security" className={navCls(pathname === "/security")}>Security</Link>
          </>
        )}
      </nav>

      {authed ? (
        <AccountMenu address={address} />
      ) : (
        <button className="btn btn-ghost btn-sm" onClick={openConnect}>
          <Wallet size={14} /> Connect wallet
        </button>
      )}

      <ConnectModal />
    </header>
  )
}

function AccountMenu({ address }: { address: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ position: "relative" }}>
      <button className="account-pill" onClick={() => setOpen((o) => !o)} title="Account">
        <span className="avatar" />
        <span className="mono" style={{ fontSize: 12 }}>{formatAddress(address)}</span>
        <ChevronDown size={13} style={{ opacity: 0.6, transform: open ? "rotate(180deg)" : "none", transition: "transform .15s ease" }} />
      </button>
      {open && (
        <>
          {/* click-away */}
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
          <div
            className="card"
            style={{ position: "absolute", right: 0, top: "calc(100% + 8px)", zIndex: 50, minWidth: 240, padding: 8 }}
          >
            <div style={{ padding: "8px 10px 10px" }}>
              <div className="text-xs" style={{ color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                Signed in
              </div>
              <div className="mono" style={{ fontSize: 12, wordBreak: "break-all", marginTop: 4 }}>{address}</div>
            </div>
            <button
              className="btn btn-ghost btn-sm"
              style={{ width: "100%", justifyContent: "flex-start", color: "var(--red)" }}
              onClick={() => {
                setOpen(false)
                disconnectWallet()
              }}
            >
              <LogOut size={13} strokeWidth={2} /> Sign out
            </button>
          </div>
        </>
      )}
    </div>
  )
}
