"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Wallet, LogOut, ChevronDown, Copy, Check } from "lucide-react"
import { useWalletStore } from "@/store/wallet"
import { useUiStore } from "@/store/ui"
import { disconnectWallet } from "@/lib/aptos"
import { signOut } from "@/lib/sessionClient"
import { formatAddress } from "@/lib/ids"
import ConnectModal from "@/components/wallet/ConnectModal"
import NetworkBadge from "@/components/layout/NetworkBadge"

export default function Topbar() {
  const address = useWalletStore((s) => s.address)
  const openConnect = useUiStore((s) => s.openConnect)
  const pathname = usePathname()
  const authed = !!address

  const navCls = (active: boolean) => (active ? "active" : "")

  return (
    <header className="topbar">
      <Link href={authed ? "/dashboard" : "/"} className="brand" style={{ textDecoration: "none" }}>
        <svg className="brand-mark" viewBox="0 0 22 22" aria-hidden="true" fill="var(--text-1)">
          <circle cx="11" cy="8.4" r="4.3" />
          <path d="M9 10.8 L13 10.8 L14.6 18 L7.4 18 Z" />
        </svg>
        <div className="brand-name">Until Then</div>
      </Link>

      <div className="topbar-spacer" />

      <nav className="topbar-nav">
        {authed ? (
          <>
            <Link href="/dashboard" className={navCls(pathname === "/dashboard")}>Dashboard</Link>
            <Link href="/new/encrypt" className={navCls(pathname.startsWith("/new"))}>New safe</Link>
            <Link href="/security" className={navCls(pathname === "/security")}>Security</Link>
            <Link href="/faq" className={navCls(pathname === "/faq")}>FAQ</Link>
          </>
        ) : (
          <>
            <Link href="/" className={navCls(pathname === "/")}>Overview</Link>
            <Link href="/security" className={navCls(pathname === "/security")}>Security</Link>
            <Link href="/faq" className={navCls(pathname === "/faq")}>FAQ</Link>
          </>
        )}
      </nav>

      {authed ? (
        <div className="row" style={{ gap: 10, alignItems: "center" }}>
          <NetworkBadge />
          <AccountMenu address={address} />
        </div>
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
  const [copied, setCopied] = useState(false)
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
              <div className="row" style={{ alignItems: "center", gap: 8, marginTop: 6 }}>
                <span className="mono" style={{ fontSize: 13 }}>{formatAddress(address, 6, 4)}</span>
                <button
                  className="btn btn-quiet btn-sm"
                  style={{ padding: "2px 6px" }}
                  title={copied ? "Copied" : "Copy address"}
                  onClick={() => {
                    navigator.clipboard?.writeText(address)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1500)
                  }}
                >
                  {copied ? <Check size={13} style={{ color: "var(--green)" }} /> : <Copy size={13} />}
                </button>
              </div>
            </div>
            <button
              className="btn btn-ghost btn-sm"
              style={{ width: "100%", justifyContent: "flex-start", color: "var(--red)" }}
              onClick={async () => {
                setOpen(false)
                // Explicit sign-out clears the SIWA cookie too — adapter-disconnect alone no longer
                // does (so account switches can silently restore). Drop cookie first, then the wallet.
                await signOut()
                await disconnectWallet()
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
