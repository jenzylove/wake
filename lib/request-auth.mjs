function safeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || left.length !== right.length) return false
  let mismatch = 0
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index)
  return mismatch === 0
}

function suppliedSecret(request, headerName) {
  const authorization = request.headers.get("authorization")
  if (authorization?.startsWith("Bearer ")) return authorization.slice("Bearer ".length)
  return request.headers.get(headerName) || ""
}

function isLocalRequest(request) {
  const hostname = new URL(request.url).hostname
  return process.env.VERCEL !== "1" && (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1")
}

function authorize(request, secret, headerName, label) {
  if (!secret) {
    if (isLocalRequest(request)) return { ok: true, status: 200, error: null }
    return { ok: false, status: 503, error: `${label} secret is not configured` }
  }
  if (!safeEqual(suppliedSecret(request, headerName), secret)) {
    return { ok: false, status: 401, error: `${label} authorization failed` }
  }
  return { ok: true, status: 200, error: null }
}

export function authorizeOperatorRequest(request) {
  return authorize(request, process.env.WAKE_OPERATOR_SECRET, "x-wake-operator-secret", "Operator")
}

export function authorizeSchedulerRequest(request) {
  return authorize(request, process.env.WAKE_SCHEDULER_SECRET || process.env.CRON_SECRET, "x-wake-scheduler-secret", "Watcher scheduler")
}
