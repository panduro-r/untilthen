import type { NextConfig } from "next"

// Content-Security-Policy — ENFORCED (2026-06). Shipped report-only first; audited that the app's only
// external hosts are the ones in connect-src below (Aptos/Shelby SDK → *.shelby.xyz + *.aptoslabs.com,
// tlock-js → *.drand.sh, Supabase → *.supabase.co), then flipped. To debug a future breakage, switch
// the header key back to "Content-Security-Policy-Report-Only" and watch the console for refusals.
//
// Hosts the app legitimately talks to: Shelby RPC/indexer/faucet (*.shelby.xyz, *.aptoslabs.com),
// Supabase (*.supabase.co), drand beacon (*.drand.sh, drand.cloudflare.com), Google Fonts. The Shelby
// erasure-coding SDK uses WASM (wasm-unsafe-eval) and may use blob workers. Petra is a browser
// extension and talks to the page via postMessage, so CSP doesn't gate it.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://*.shelby.xyz https://*.aptoslabs.com https://*.supabase.co https://*.drand.sh https://drand.cloudflare.com https://fonts.googleapis.com https://fonts.gstatic.com",
  "worker-src 'self' blob:",
  "frame-src 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join("; ")

const securityHeaders = [
  // Clickjacking — belt (X-Frame-Options) and suspenders (CSP frame-ancestors).
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Fragments are never sent in Referer anyway, but keep referrers tight.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=(), payment=()" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "Content-Security-Policy", value: csp },
]

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }]
  },
}

export default nextConfig
