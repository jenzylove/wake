// WAKE agent tick: event -> decision -> execution, unattended.
//
// Each tick gathers every incident WAKE knows about (captured incidents as the deployed API
// derives them, incidents discovered from the exploit feed, and blind test incidents), applies
// the agent policy, opens a Bitget Demo position for anything eligible with the size WAKE
// computed, and manages open positions against their stop, their thesis and a time stop.
//
// Every evaluation, order and exit is appended to data/wake-paper/log.jsonl, a hash chained log
// that `npm run data:verify` replays. Without Demo credentials the tick still runs and logs its
// decisions; it simply records that no order could be sent. It never trades real money: every
// signed request carries paptrading: 1.

import { createHmac } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { appendHashLog } from "../lib/hash-log.mjs"
import { AGENT_LIMITS, agentEligibility, exitReason } from "../lib/agent-policy.mjs"
import { contractSize } from "../lib/sizing.mjs"

const ROOT = process.cwd()
const OUT = path.join(ROOT, "data", "wake-paper")
const LOG = path.join(OUT, "log.jsonl")
const STATE = path.join(OUT, "state.json")
const API = process.env.WAKE_API_BASE || "https://bitget-lilac.vercel.app"
const BITGET = "https://api.bitget.com"
const creds = { key: process.env.BITGET_API_KEY, secret: process.env.BITGET_SECRET_KEY, pass: process.env.BITGET_PASSPHRASE }
// Two ways to reach Bitget Demo. Scheduled runs call the deployed executor, so the exchange keys
// stay on the server and the scheduler holds only a token. Local runs may sign directly.
const EXECUTOR = process.env.WAKE_AGENT_EXECUTOR && process.env.WAKE_SCHEDULER_SECRET ? process.env.WAKE_AGENT_EXECUTOR : null
const DIRECT = !EXECUTOR && process.env.WAKE_EXECUTION_MODE === "bitget-demo" && creds.key && creds.secret && creds.pass
const DEMO = Boolean(EXECUTOR || DIRECT)
const TICK = new Date().toISOString()

async function bitget(method, requestPath, body = "", signed = false) {
  const ts = String(Date.now())
  const headers = { "Content-Type": "application/json", locale: "en-US" }
  if (signed) {
    Object.assign(headers, {
      "ACCESS-KEY": creds.key,
      "ACCESS-SIGN": createHmac("sha256", creds.secret).update(`${ts}${method}${requestPath}${body}`).digest("base64"),
      "ACCESS-TIMESTAMP": ts,
      "ACCESS-PASSPHRASE": creds.pass,
      paptrading: "1",
    })
  }
  const res = await fetch(`${BITGET}${requestPath}`, { method, headers, body: body || undefined, signal: AbortSignal.timeout(20_000) })
  const payload = await res.json()
  if (!res.ok || payload.code !== "00000") throw new Error(`bitget ${requestPath.split("?")[0]}: ${payload.msg || res.status}`)
  return payload
}

const mark = async (symbol) => Number((await bitget("GET", `/api/v2/mix/market/symbol-price?symbol=${symbol}&productType=USDT-FUTURES`)).data[0].markPrice)

async function venue(symbol) {
  const c = (await bitget("GET", `/api/v2/mix/market/contracts?productType=USDT-FUTURES&symbol=${symbol}`)).data[0]
  return { sizeMultiplier: Number(c.sizeMultiplier), minTradeNum: Number(c.minTradeNum), minTradeUSDT: Number(c.minTradeUSDT) }
}

async function placeOrder({ symbol, side, tradeSide, size, posMode, clientOid, incidentId }) {
  if (EXECUTOR) {
    const res = await fetch(EXECUTOR, {
      method: "POST",
      headers: { "content-type": "application/json", "x-wake-scheduler-secret": process.env.WAKE_SCHEDULER_SECRET },
      body: JSON.stringify({ incidentId, tradeSide, instrument: symbol, side, size: String(size), clientOid }),
      signal: AbortSignal.timeout(30_000),
    })
    const body = await res.json()
    if (!res.ok) throw new Error(`executor ${res.status}: ${body.error}`)
    return { orderId: body.orderId, clientOid: body.clientOid, executor: "vercel", posMode: body.posMode, markPrice: body.markPrice }
  }
  const hedge = posMode === "hedge_mode"
  const orderSide = hedge ? (side === "LONG" ? "buy" : "sell") : ((side === "LONG") === (tradeSide === "open") ? "buy" : "sell")
  const body = JSON.stringify({
    symbol, productType: "USDT-FUTURES", marginMode: "isolated", marginCoin: "USDT", size: String(size),
    side: orderSide, tradeSide, orderType: "market", force: "gtc", clientOid,
    ...(hedge ? { posSide: side.toLowerCase() } : {}),
    ...(!hedge && tradeSide === "close" ? { reduceOnly: "YES" } : {}),
  })
  const res = await bitget("POST", "/api/v2/mix/order/place-order", body, true)
  return { orderId: res.data?.orderId ?? null, clientOid, request: JSON.parse(body) }
}

// Every incident WAKE knows about, normalized for the agent policy.
async function gatherIncidents() {
  const out = []
  try {
    const res = await fetch(`${API}/api/incidents`, { signal: AbortSignal.timeout(30_000) })
    const body = await res.json()
    for (const r of body.incidents) {
      out.push({ id: r.id, source: "captured", provenance: r.provenance, numbersProvenance: r.numbersProvenance, decision: r.decision,
        gatePassed: r.gate.passed, sizing: r.sizing, instrument: r.instrument, side: r.side, stopPct: r.sizing?.stopPct ?? null })
    }
  } catch (error) {
    appendHashLog(LOG, { event: "SOURCE_ERROR", source: "captured", error: String(error.message ?? error) }, TICK)
  }
  const discovered = path.join(ROOT, "data", "discovered")
  if (existsSync(discovered)) {
    for (const f of readdirSync(discovered).filter((n) => n.startsWith("disc-"))) {
      const r = JSON.parse(readFileSync(path.join(discovered, f), "utf8"))
      const side = r.exposures?.[0] ? "SHORT" : undefined
      out.push({ id: r.id, source: "discovered", provenance: "REAL_CAPTURE", numbersProvenance: "COMPUTED", decision: r.decision,
        gatePassed: false, sizing: r.sizing, instrument: r.instrument, side, stopPct: r.sizing?.stopPct ?? null })
    }
  }
  const blind = path.join(ROOT, "data", "blind")
  if (existsSync(blind)) {
    for (const f of readdirSync(blind).filter((n) => n.startsWith("blind-") && n.endsWith(".json"))) {
      const r = JSON.parse(readFileSync(path.join(blind, f), "utf8"))
      if (!r.agent) continue
      out.push({ id: r.id, source: "blind", provenance: "BLIND_TEST", numbersProvenance: "COMPUTED", decision: r.agent.decision,
        gatePassed: r.agent.gatePassed, sizing: r.agent.sizing, instrument: r.agent.instrument, side: r.agent.side,
        stopPct: r.agent.sizing?.stopPct ?? null, detectedAt: r.detection?.firstDetectedAt ?? r.detection?.detectedAt ?? null })
    }
  }
  return out
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : { open: [], closed: [] }
  const incidents = await gatherIncidents()
  const byId = new Map(incidents.map((i) => [i.id, i]))
  let posMode = null
  // Auth probe: an empty intent is rejected as 400 when the token matches, 401 when it does not.
  if (EXECUTOR) {
    const res = await fetch(EXECUTOR, { method: "POST", headers: { "content-type": "application/json", "x-wake-scheduler-secret": process.env.WAKE_SCHEDULER_SECRET }, body: "{}" })
    if (res.status !== 400) appendHashLog(LOG, { event: "EXECUTOR_UNAVAILABLE", status: res.status, error: (await res.json().catch(() => ({}))).error ?? null }, TICK)
    state.executorOk = res.status === 400
  }
  if (DIRECT) {
    try { posMode = (await bitget("GET", "/api/v2/mix/account/account?marginCoin=USDT&productType=USDT-FUTURES&symbol=BTCUSDT", "", true)).data?.posMode ?? null }
    catch (error) { appendHashLog(LOG, { event: "ACCOUNT_ERROR", error: String(error.message ?? error) }, TICK) }
  }

  // 0. Reconcile against the exchange. The venue's own average entry and unrealised PnL replace
  // anything this script assumed, so the site never shows a number the exchange disagrees with.
  let exchange = null
  if (EXECUTOR) {
    try {
      const res = await fetch(EXECUTOR.replace("/execute", "/positions"), {
        headers: { "x-wake-scheduler-secret": process.env.WAKE_SCHEDULER_SECRET },
        signal: AbortSignal.timeout(30_000),
      })
      if (res.ok) exchange = await res.json()
    } catch (error) {
      appendHashLog(LOG, { event: "RECONCILE_FAILED", error: String(error.message ?? error) }, TICK)
    }
  } else if (DIRECT) {
    try {
      const [positions, account] = await Promise.all([
        bitget("GET", "/api/v2/mix/position/all-position?productType=USDT-FUTURES&marginCoin=USDT", "", true),
        bitget("GET", "/api/v2/mix/account/account?marginCoin=USDT&productType=USDT-FUTURES&symbol=BTCUSDT", "", true),
      ])
      exchange = {
        account: { equity: Number(account.data?.accountEquity), available: Number(account.data?.available), marginCoin: "USDT" },
        positions: (positions.data ?? []).map((p) => ({
          symbol: p.symbol, side: p.holdSide === "short" ? "SHORT" : "LONG", size: Number(p.total),
          entryPrice: Number(p.openPriceAvg), markPrice: Number(p.markPrice), unrealizedPnlUsd: Number(p.unrealizedPL),
        })),
      }
    } catch (error) {
      appendHashLog(LOG, { event: "RECONCILE_FAILED", error: String(error.message ?? error) }, TICK)
    }
  }
  if (exchange?.positions) {
    for (const p of state.open) {
      const live = exchange.positions.find((x) => x.symbol === p.instrument && x.side === p.side)
      if (!live) continue
      if (Number.isFinite(live.entryPrice) && live.entryPrice > 0 && live.entryPrice !== p.entryPrice) {
        appendHashLog(LOG, { event: "ENTRY_RECONCILED", incidentId: p.incidentId, instrument: p.instrument, recorded: p.entryPrice, filled: live.entryPrice }, TICK)
        p.entryPrice = live.entryPrice
        p.notionalUsd = Number((live.entryPrice * p.size).toFixed(4))
      }
      p.exchange = { markPrice: live.markPrice, unrealizedPnlUsd: live.unrealizedPnlUsd, size: live.size, at: TICK }
    }
  }

  // 1. Manage what is open.
  for (const p of [...state.open]) {
    let price
    try { price = await mark(p.instrument) } catch { continue }
    const reason = exitReason(p, price, byId.get(p.incidentId) ?? null)
    if (!reason) continue
    // A Demo position can only be closed by a run that can reach Demo. Never mark it closed here.
    if (p.mode === "bitget-demo" && !DEMO) {
      appendHashLog(LOG, { event: "EXIT_DEFERRED", incidentId: p.incidentId, reason, note: "exit due, but this run has no Demo executor" }, TICK)
      continue
    }
    let order = null
    let error = null
    if (p.mode === "bitget-demo" && DEMO) {
      try { order = await placeOrder({ symbol: p.instrument, side: p.side, tradeSide: "close", size: p.size, posMode, clientOid: `wake-x-${Date.now()}`, incidentId: p.incidentId }) }
      catch (e) { error = String(e.message ?? e) }
    }
    if (error) { appendHashLog(LOG, { event: "EXIT_FAILED", incidentId: p.incidentId, reason, error }, TICK); continue }
    const gross = (price / p.entryPrice - 1) * (p.side === "LONG" ? 1 : -1) * p.notionalUsd
    const fees = 2 * 0.0006 * p.notionalUsd
    const closed = { ...p, exitPrice: price, closedAt: TICK, exitReason: reason, pnlUsd: Number((gross - fees).toFixed(4)), exitOrder: order }
    state.open = state.open.filter((o) => o !== p)
    state.closed.push(closed)
    appendHashLog(LOG, { event: "EXIT", incidentId: p.incidentId, instrument: p.instrument, side: p.side, exitPrice: price, reason, pnlUsd: closed.pnlUsd, orderId: order?.orderId ?? null, mode: p.mode }, TICK)
  }

  // 2. Evaluate every incident; open what is eligible.
  for (const inc of incidents) {
    const e = agentEligibility(inc)
    const alreadyOpen = state.open.some((o) => o.incidentId === inc.id) || state.closed.some((o) => o.incidentId === inc.id)
    // Log a decision when it first appears or changes; the per tick summary covers the rest.
    const seen = `${inc.decision}|${e.eligible}`
    if (state.lastSeen?.[inc.id] !== seen) {
      appendHashLog(LOG, { event: "EVALUATED", incidentId: inc.id, source: inc.source, decision: inc.decision, eligible: e.eligible, reasons: e.reasons }, TICK)
      state.lastSeen = { ...(state.lastSeen ?? {}), [inc.id]: seen }
    }
    if (!e.eligible || alreadyOpen) continue
    // An entry the venue rejected (for example a symbol Demo does not list) is not retried every hour.
    if (state.failed?.[inc.id]) continue
    if (state.open.length >= AGENT_LIMITS.maxOpenPositions) { appendHashLog(LOG, { event: "SKIPPED", incidentId: inc.id, reason: "max open positions" }, TICK); continue }
    try {
      const [price, v] = await Promise.all([mark(inc.instrument), venue(inc.instrument)])
      const notional = Math.min(inc.sizing.notionalUsd, AGENT_LIMITS.demoNotionalCapUsd)
      const size = contractSize(notional, price, v)
      if (!size || size * price < v.minTradeUSDT) { appendHashLog(LOG, { event: "SKIPPED", incidentId: inc.id, reason: "computed size below the venue minimum", notional }, TICK); continue }
      const mode = DEMO ? "bitget-demo" : "unsent"
      const order = DEMO ? await placeOrder({ symbol: inc.instrument, side: inc.side, tradeSide: "open", size, posMode, clientOid: `wake-o-${Date.now()}`, incidentId: inc.id }) : null
      const position = { incidentId: inc.id, source: inc.source, instrument: inc.instrument, side: inc.side, size, notionalUsd: Number((size * price).toFixed(4)),
        entryPrice: price, stopPct: inc.stopPct ?? 0.02, openedAt: TICK, mode, entryOrder: order }
      if (DEMO) state.open.push(position)
      appendHashLog(LOG, { event: DEMO ? "ENTRY" : "ENTRY_UNSENT", incidentId: inc.id, instrument: inc.instrument, side: inc.side, size, entryPrice: price,
        stopPct: position.stopPct, computedNotionalUsd: inc.sizing.notionalUsd, cappedNotionalUsd: notional, orderId: order?.orderId ?? null, mode,
        ...(DEMO ? {} : { note: "Demo credentials are not configured in this environment, so no order was sent." }) }, TICK)
    } catch (error) {
      appendHashLog(LOG, { event: "ENTRY_FAILED", incidentId: inc.id, error: String(error.message ?? error) }, TICK)
      state.failed = { ...(state.failed ?? {}), [inc.id]: String(error.message ?? error) }
    }
  }

  const pnl = state.closed.map((c) => c.pnlUsd)
  let peak = 0, cum = 0, maxDd = 0
  for (const x of pnl) { cum += x; peak = Math.max(peak, cum); maxDd = Math.max(maxDd, peak - cum) }
  const metrics = {
    updatedAt: TICK, mode: DEMO ? "bitget-demo" : "no-credentials", executorOk: state.executorOk ?? null, incidentsEvaluated: incidents.length,
    eligibleNow: incidents.filter((i) => agentEligibility(i).eligible).length,
    open: state.open.length, closedTrades: pnl.length, realizedPnlUsd: Number(cum.toFixed(4)),
    winRate: pnl.length ? Number((pnl.filter((x) => x > 0).length / pnl.length).toFixed(3)) : null, maxDrawdownUsd: Number(maxDd.toFixed(4)),
    // Real incidents and blind test incidents are never blended into one number.
    closedBySource: Object.fromEntries(["captured", "discovered", "blind"].map((src) => {
      const xs = state.closed.filter((c) => c.source === src).map((c) => c.pnlUsd)
      return [src, { trades: xs.length, realizedPnlUsd: Number(xs.reduce((a, b) => a + b, 0).toFixed(4)), wins: xs.filter((x) => x > 0).length }]
    })),
    openBySource: state.open.reduce((a, o) => ((a[o.source] = (a[o.source] ?? 0) + 1), a), {}),
    bySource: incidents.reduce((a, i) => ((a[i.source] = (a[i.source] ?? 0) + 1), a), {}),
  }
  appendHashLog(LOG, { event: "TICK", mode: metrics.mode, evaluated: metrics.incidentsEvaluated, eligible: metrics.eligibleNow, open: metrics.open, closedTrades: metrics.closedTrades, realizedPnlUsd: metrics.realizedPnlUsd }, TICK)
  writeFileSync(STATE, JSON.stringify(state, null, 2) + "\n")
  writeFileSync(path.join(OUT, "metrics.json"), JSON.stringify(metrics, null, 2) + "\n")
  // Compact summary the site reads: positions, closed trades and the tail of the decision log.
  const logLines = existsSync(LOG) ? readFileSync(LOG, "utf8").split(String.fromCharCode(10)).filter(Boolean) : []
  writeFileSync(path.join(OUT, "summary.json"), JSON.stringify({
    metrics,
    exchange: exchange ? { account: exchange.account, positions: exchange.positions, at: TICK } : null,
    open: state.open.map(({ entryOrder, ...p }) => ({ ...p, orderId: entryOrder?.orderId ?? null })),
    closed: state.closed.slice(-20).map(({ entryOrder, exitOrder, ...c }) => ({ ...c, entryOrderId: entryOrder?.orderId ?? null, exitOrderId: exitOrder?.orderId ?? null })),
    recentLog: logLines.slice(-60).map((line) => JSON.parse(line)).reverse(),
    logEntries: logLines.length,
  }, null, 2) + "\n")
  console.log(JSON.stringify(metrics, null, 2))
}

main().catch((error) => { console.error(error); process.exit(1) })
