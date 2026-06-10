// lib/origin.ts — same-origin guard for cookie-authorized mutating routes (defense-in-depth CSRF).
//
// The session cookie is SameSite=Strict, which already blocks cross-site cookie use. This adds a
// second, independent check: a state-changing request authorized by the session must carry an Origin
// header that matches our app. Browsers always send Origin on cross-origin (and same-origin) POSTs, so
// a forged cross-site request is rejected here even if a future cookie-policy regression slipped
// through. Non-browser callers (tests, server-to-server) authorize via signature, not the cookie, so
// they don't hit this path.

function allowedOrigins(): string[] {
  const out = new Set<string>()
  const app = process.env.NEXT_PUBLIC_APP_URL
  if (app) {
    try {
      out.add(new URL(app).origin)
    } catch {
      /* ignore malformed env */
    }
  }
  // Local dev.
  out.add("http://localhost:3000")
  return [...out]
}

/** True if the request's Origin is one of our allowed app origins. */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin")
  if (!origin) {
    // No Origin header: same-origin GETs omit it, but our mutating routes are POSTs where browsers
    // do send it. Treat missing Origin as not-verifiable → reject for cookie-authorized mutations.
    return false
  }
  return allowedOrigins().includes(origin)
}
