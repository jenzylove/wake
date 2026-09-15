// In-memory sliding window limiter. Serverless instances are ephemeral, so this
// throttles bursts per warm instance rather than enforcing a global quota. It
// exists to stop an unauthenticated route from draining a paid API key; the hard
// ceiling is the per-instance daily cap below.
type Window = { hits: number[]; day: string; dayHits: number }

const windows = new Map<string, Window>()

export type RateLimitRule = {
  key: string
  limit: number
  windowMs: number
  dailyLimit: number
}

export function checkRateLimit({ key, limit, windowMs, dailyLimit }: RateLimitRule) {
  const now = Date.now()
  const day = new Date(now).toISOString().slice(0, 10)
  const current = windows.get(key) ?? { hits: [], day, dayHits: 0 }
  if (current.day !== day) {
    current.day = day
    current.dayHits = 0
  }
  current.hits = current.hits.filter((at) => now - at < windowMs)

  if (current.dayHits >= dailyLimit) {
    windows.set(key, current)
    return { allowed: false as const, reason: "daily cap reached", retryAfterSeconds: 3600 }
  }
  if (current.hits.length >= limit) {
    windows.set(key, current)
    const oldest = current.hits[0] ?? now
    return { allowed: false as const, reason: "too many requests", retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)) }
  }

  current.hits.push(now)
  current.dayHits += 1
  windows.set(key, current)
  return { allowed: true as const, remaining: limit - current.hits.length, dailyRemaining: dailyLimit - current.dayHits }
}

export function clientKey(request: Request, scope: string) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  const ip = forwarded || request.headers.get("x-real-ip") || "unknown"
  return `${scope}:${ip}`
}
