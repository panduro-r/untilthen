// lib/session.ts — SERVER-ONLY. Signed session cookie issued after SIWA (Sign In With Aptos).
//
// After a user proves wallet ownership once (lib/auth.verifySiwa), we mint a short-lived JWT carrying
// only the owner address and set it as an HttpOnly cookie. Session-gated routes (e.g. GET /api/drops)
// read it to authorize "this is the owner of address X" without another wallet popup. The cookie is a
// bearer token, so it's HttpOnly + Secure + SameSite=Lax and expires in 7 days. It authorizes only
// READS of the owner's own metadata; every mutating/secret action still requires a fresh per-action
// wallet signature (lib/auth.verifyOwnerAuth) — the session never unlocks a secret.

import "server-only"
import { cookies } from "next/headers"
import { SignJWT, jwtVerify } from "jose"

const COOKIE = "ut_session"
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60

function secret(): Uint8Array {
  const s = process.env.AUTH_SESSION_SECRET
  if (!s) throw new Error("AUTH_SESSION_SECRET is not set (server-only session signing key).")
  return new TextEncoder().encode(s)
}

export async function createSessionToken(address: string): Promise<string> {
  return new SignJWT({ address: address.toLowerCase() })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secret())
}

/** Verify a raw token; returns the lowercased address or null. */
export async function verifySessionToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret())
    const addr = payload.address
    return typeof addr === "string" ? addr.toLowerCase() : null
  } catch {
    return null
  }
}

/** Set the session cookie for `address`. Call after a successful SIWA verification. */
export async function setSessionCookie(address: string): Promise<void> {
  const token = await createSessionToken(address)
  const jar = await cookies()
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // Strict: the cookie is never sent on requests initiated by another site, so it can't be used in
    // a CSRF against our cookie-authorized mutating routes. Same-origin fetch() still sends it, so the
    // app works normally.
    sameSite: "strict",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  })
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies()
  jar.delete(COOKIE)
}

/** The signed-in owner address from the request's session cookie, or null. */
export async function getSession(): Promise<{ address: string } | null> {
  try {
    const jar = await cookies()
    const token = jar.get(COOKIE)?.value
    if (!token) return null
    const address = await verifySessionToken(token)
    return address ? { address } : null
  } catch {
    // No request scope (e.g. unit tests) → treat as no session.
    return null
  }
}
