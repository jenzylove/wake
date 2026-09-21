// Is this instrument actually tradeable on Bitget Demo?
//
// Demo lists fewer perpetuals than the live venue, so a symbol built from an incident can look
// fine and still be refused at order time (ARBUSDT was). This asks before anything is declared
// executable. With local keys it signs the request itself; on the scheduled runner it asks the
// deployed route, which holds the keys. If neither is available the answer is "no": an
// instrument that cannot be confirmed is not executable.

import { createHmac } from "node:crypto"

const cache = new Map()

async function signedDemoContract(symbol) {
  const path = `/api/v2/mix/market/contracts?productType=USDT-FUTURES&symbol=${symbol}`
  let offset = 0
  try {
    const t0 = Date.now()
    const body = await (await fetch("https://api.bitget.com/api/v2/public/time", { signal: AbortSignal.timeout(15_000) })).json()
    offset = Number(body.data.serverTime) - Math.round((t0 + Date.now()) / 2)
  } catch { offset = 0 }
  const ts = String(Date.now() + offset)
  const res = await fetch(`https://api.bitget.com${path}`, {
    headers: {
      "ACCESS-KEY": process.env.BITGET_API_KEY,
      "ACCESS-SIGN": createHmac("sha256", process.env.BITGET_SECRET_KEY).update(`${ts}GET${path}`).digest("base64"),
      "ACCESS-TIMESTAMP": ts,
      "ACCESS-PASSPHRASE": process.env.BITGET_PASSPHRASE,
      paptrading: "1",
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(20_000),
  })
  const body = await res.json()
  return body.code === "00000" && Array.isArray(body.data) && body.data.some((c) => c.symbol === symbol)
}

/** @param {string[]} symbols @returns {Promise<Record<string, boolean>>} */
export async function demoListed(symbols) {
  const wanted = [...new Set(symbols.filter(Boolean).map((s) => s.toUpperCase()))]
  const out = {}
  const missing = wanted.filter((s) => !cache.has(s))

  if (missing.length && process.env.BITGET_API_KEY && process.env.BITGET_SECRET_KEY && process.env.BITGET_PASSPHRASE) {
    for (const s of missing) {
      try { cache.set(s, await signedDemoContract(s)) } catch { /* unknown stays unknown */ }
    }
  } else if (missing.length && process.env.WAKE_SCHEDULER_SECRET && (process.env.WAKE_AGENT_INTERPRET || process.env.WAKE_AGENT_EXECUTOR)) {
    const base = (process.env.WAKE_AGENT_INTERPRET || process.env.WAKE_AGENT_EXECUTOR).replace(/\/(interpret|execute)$/, "/demo-listed")
    try {
      const res = await fetch(`${base}?symbols=${missing.join(",")}`, {
        headers: { "x-wake-scheduler-secret": process.env.WAKE_SCHEDULER_SECRET },
        signal: AbortSignal.timeout(60_000),
      })
      if (res.ok) for (const [s, v] of Object.entries((await res.json()).listed ?? {})) cache.set(s, v === true)
    } catch { /* unknown stays unknown */ }
  }

  for (const s of wanted) out[s] = cache.get(s) === true
  return out
}
