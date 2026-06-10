// The same-origin (CSRF) guard for cookie-authorized mutating routes.

import { describe, it, expect, beforeAll } from "vitest"
import { isSameOrigin } from "../origin"

function reqWithOrigin(origin: string | null): Request {
  const headers = new Headers()
  if (origin !== null) headers.set("origin", origin)
  return new Request("http://app.example/api/x", { method: "POST", headers })
}

describe("isSameOrigin", () => {
  beforeAll(() => {
    process.env.NEXT_PUBLIC_APP_URL = "https://untilthen.xyz"
  })

  it("accepts the configured app origin", () => {
    expect(isSameOrigin(reqWithOrigin("https://untilthen.xyz"))).toBe(true)
  })

  it("accepts localhost dev origin", () => {
    expect(isSameOrigin(reqWithOrigin("http://localhost:3000"))).toBe(true)
  })

  it("rejects a foreign origin", () => {
    expect(isSameOrigin(reqWithOrigin("https://evil.example"))).toBe(false)
  })

  it("rejects a missing Origin header (can't verify a cookie-authorized mutation)", () => {
    expect(isSameOrigin(reqWithOrigin(null))).toBe(false)
  })

  it("rejects a look-alike subdomain", () => {
    expect(isSameOrigin(reqWithOrigin("https://untilthen.xyz.evil.example"))).toBe(false)
  })
})
