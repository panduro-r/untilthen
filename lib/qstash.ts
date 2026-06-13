import "server-only"

// One-shot release scheduling via Upstash QStash. At a safe's release time, QStash makes a single
// authenticated call to our /api/cron/release endpoint (forwarding CRON_SECRET) — which verifies the
// drand round actually published, then flips the status and emails recipients. No secret or link is
// ever given to QStash; it only knows "poke this URL at time T". No recurring polling.
//
// Graceful no-op until QSTASH_TOKEN + CRON_SECRET + NEXT_PUBLIC_APP_URL are all set. The daily Vercel
// cron remains a backstop, and a stale early call (after a postpone) self-heals: the endpoint re-checks
// the round and does nothing if it isn't out yet.

/** Schedule a release trigger for `triggerAtMs` (epoch ms). Best-effort; never throws. */
export async function scheduleRelease(triggerAtMs: number): Promise<void> {
  const token = process.env.QSTASH_TOKEN
  const cronSecret = process.env.CRON_SECRET
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!token || !cronSecret || !appUrl) return

  const destination = `${appUrl.replace(/\/$/, "")}/api/cron/release`
  // Base URL is region-specific (EU vs US). Default to the legacy EU host; override with QSTASH_URL.
  const base = (process.env.QSTASH_URL ?? "https://qstash.upstash.io").replace(/\/$/, "")
  // Fire ~1 min after the release moment so the drand round is certainly published by the time we run.
  const notBefore = Math.floor(triggerAtMs / 1000) + 60

  try {
    const res = await fetch(`${base}/v2/publish/${destination}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Upstash-Not-Before": String(notBefore),
        "Upstash-Forward-Authorization": `Bearer ${cronSecret}`,
      },
    })
    if (!res.ok) {
      console.error("[qstash] schedule failed:", res.status, await res.text().catch(() => ""))
    }
  } catch (e) {
    console.error("[qstash] schedule error:", e)
  }
}
