// Point in time replay of the supply to exchange strategy over the competition window.
//
// This is a backtest, and it is labelled as one everywhere. It exists because the live class
// trades about once a day and the track is judged on paper trading Sharpe, drawdown and win rate.
// The rules that keep it honest:
//
//   1. Nothing is decided with hindsight. For each deposit, the snapshot holds only what the live
//      watcher would have had at its next hourly pass: chain state at that block (read from an
//      archive node), prices, volatility and volume up to that moment. The spread is not available
//      historically from Bitget, so the cost bar uses the spread measured on the live book when the
//      replay runs, recorded as a proxy.
//   2. Claude cannot know the outcome. The window starts on 3 September 2026, after the model's
//      training data ends, and Claude sees the same packet the live watcher sends.
//   3. Nothing is chosen. Every deposit of $500,000 or more in the window is replayed, and the gates
//      are the live gates, unchanged. Where code would refuse any trade regardless of Claude (edge
//      below the bar, no size), Claude is not consulted; the outcome is the same NO_TRADE the live
//      path would record.
//   4. The decision is saved before the outcome exists. Phase `decide` writes every decision to a
//      hash chained log. Phase `mark` reads only that log, then fetches the following 18 hours.
//
// Usage:
//   node --env-file=.env.local scripts/backtest-supply.mjs decide --from 2026-09-03 --to 2026-09-21T12:00:00Z
//   node scripts/backtest-supply.mjs mark

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { rpc } from "../lib/chain-watch.mjs"
import { LABELLED_HUBS, MIN_DEPOSIT_USD, SUPPLY_TOKENS, TAKER_FEE, findDeposits, hubCandidates, roundTripCost, supplyImpactPct, supplyMinEdgePct } from "../lib/supply-watch.mjs"
import { decideWithClaude, enforce } from "../lib/ai-decide.mjs"
import { computePositionSizing } from "../lib/sizing.mjs"
import { appendHashLog, sha256 } from "../lib/hash-log.mjs"
import { AGENT_LIMITS } from "../lib/agent-policy.mjs"

const OUT = path.join(process.cwd(), "data", "backtest")
const CACHE = path.join(OUT, "cache")
const DECISIONS = path.join(OUT, "supply-decisions.jsonl")
const RESULTS = path.join(OUT, "supply-results.json")
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
const ARCHIVE = ["https://rpc.mevblocker.io", "https://gateway.tenderly.co/public/mainnet", "https://mainnet.gateway.tenderly.co", "https://1rpc.io/eth"]
const call = (m, p) => rpc(ARCHIVE[0], m, p, 3, ARCHIVE.slice(1))
const HOUR = 3_600_000
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const hex = (n) => `0x${n.toString(16)}`
const arg = (k, d = null) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const cached = (name, fn) => async (...a) => {
  const f = path.join(CACHE, `${name}-${sha256(a).slice(0, 16)}.json`)
  if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8"))
  const v = await fn(...a)
  writeFileSync(f, JSON.stringify(v))
  return v
}
const getJson = async (u) => {
  for (let i = 0; i < 4; i += 1) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(30_000) })
      if (r.status === 429) { await sleep(15_000); continue }
      return await r.json()
    } catch { await sleep(3000) }
  }
  throw new Error(`fetch failed: ${u}`)
}

// ---------- chain ----------
const blockTime = cached("block", async (n) => Number((await call("eth_getBlockByNumber", [hex(n), false])).timestamp) * 1000)
async function blockAt(ms) {
  let lo = 20_000_000, hi = Number(await call("eth_blockNumber", []))
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if ((await blockTime(mid)) < ms) lo = mid; else hi = mid }
  return hi
}
const logs = cached("logs", async (from, to) => {
  const out = []
  for (let s = from, step = 1000; s <= to;) {
    const e = Math.min(s + step - 1, to)
    try {
      const r = await call("eth_getLogs", [{ address: Object.keys(SUPPLY_TOKENS), topics: [TRANSFER], fromBlock: hex(s), toBlock: hex(e) }])
      if (!Array.isArray(r)) throw new Error("no array")
      for (const l of r) if (l.topics.length === 3) out.push({ a: l.address.toLowerCase(), d: l.data, f: `0x${l.topics[1].slice(26)}`, t: `0x${l.topics[2].slice(26)}`, tx: l.transactionHash, b: Number(l.blockNumber) })
      s = e + 1
    } catch (err) { if (step > 10) step = Math.floor(step / 2); else throw err }
  }
  return out
})
const codeAt = cached("code", async (a, b) => { const c = await call("eth_getCode", [a, hex(b)]); return Boolean(c && c !== "0x") })
const nonceAt = cached("nonce", async (a, b) => Number(await call("eth_getTransactionCount", [a, hex(b)])))
const balanceAt = cached("bal", async (tok, a, b) => { const r = await call("eth_call", [{ to: tok, data: `0x70a08231${a.slice(2).padStart(64, "0")}` }, hex(b)]); return Number(BigInt(r === "0x" ? "0x0" : r)) / 1e18 })
const supplyOf = cached("supply", async (tok) => Number(BigInt(await call("eth_call", [{ to: tok, data: "0x18160ddd" }, "latest"]))) / 1e18)

// ---------- market ----------
const candles = cached("candles", async (instrument, gran, startMs, endMs) => {
  const step = gran === "5m" ? 5 * 60_000 : HOUR
  const out = new Map()
  for (let end = endMs; end > startMs; end -= step * 190) {
    const body = await getJson(`https://api.bitget.com/api/v2/mix/market/history-candles?symbol=${instrument}&productType=USDT-FUTURES&granularity=${gran === "5m" ? "5m" : "1H"}&endTime=${end}&limit=200`)
    for (const k of body.data ?? []) out.set(Number(k[0]), { t: Number(k[0]), o: +k[1], h: +k[2], l: +k[3], c: +k[4], q: +k[6] })
    await sleep(120)
  }
  return [...out.values()].filter((k) => k.t >= startMs && k.t < endMs).sort((a, b) => a.t - b.t)
})
const volumes = cached("cgvol", async (id, fromMs, toMs) => {
  const body = await getJson(`https://api.coingecko.com/api/v3/coins/${id}/market_chart/range?vs_currency=usd&from=${Math.floor(fromMs / 1000)}&to=${Math.floor(toMs / 1000)}`)
  await sleep(6000)
  return body.total_volumes ?? []
})

async function decide(fromIso, toIso) {
  mkdirSync(CACHE, { recursive: true })
  const fromMs = Date.parse(fromIso), toMs = Date.parse(toIso)
  if (fromMs < Date.parse("2026-09-03T00:00:00Z")) throw new Error("the replay window starts on 3 September, after the model's training data ends")
  const done = new Set(existsSync(DECISIONS) ? readFileSync(DECISIONS, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l).id) : [])

  // Market context for the whole window, fetched once. Hourly candles from three days earlier feed volatility.
  const mk = {}
  for (const meta of Object.values(SUPPLY_TOKENS)) {
    const h1 = await candles(meta.instrument, "1H", fromMs - 4 * 24 * HOUR, toMs + HOUR)
    const m5 = await candles(meta.instrument, "5m", fromMs - 3 * HOUR, toMs + HOUR)
    const vol = await volumes(meta.coingecko, fromMs - 2 * 24 * HOUR, toMs)
    const tk = (await getJson(`https://api.bitget.com/api/v2/mix/market/ticker?symbol=${meta.instrument}&productType=USDT-FUTURES`)).data[0]
    mk[meta.symbol] = { h1, m5, vol, costProxy: roundTripCost({ bid: +tk.bidPr, ask: +tk.askPr }), book: { bid: +tk.bidPr, ask: +tk.askPr, measuredAt: new Date().toISOString() } }
  }
  const priceAt = (sym, ms) => { const xs = mk[sym].h1.filter((k) => k.t + HOUR <= ms); return xs.length ? xs[xs.length - 1].c : null }

  const firstBlock = await blockAt(fromMs), lastBlock = await blockAt(toMs)
  console.log(`blocks ${firstBlock}-${lastBlock}`)
  // One live pass per hour at minute 29: replay each pass over the blocks it would have read.
  const passes = []
  for (let t = Math.floor(fromMs / HOUR) * HOUR + 29 * 60_000; t <= toMs; t += HOUR) passes.push(t)
  let prevBlock = firstBlock
  const open = new Map() // depositor -> position close time, for the same-sender refusal
  let n = 0
  for (const passMs of passes) {
    const passBlock = await blockAt(passMs)
    if (passBlock <= prevBlock) continue
    const raw = await logs(prevBlock, passBlock - 1)
    prevBlock = passBlock
    const transfers = []
    for (const l of raw) {
      const meta = SUPPLY_TOKENS[l.a]
      const amount = Number(BigInt(l.d === "0x" ? "0x0" : l.d)) / 1e18
      const usd = amount * (priceAt(meta.symbol, passMs) ?? 0)
      if (usd >= 50_000) transfers.push({ token: l.a, symbol: meta.symbol, amount, usd, from: l.f, to: l.t, tx: l.tx, block: l.b })
    }
    const hubs = Object.fromEntries(Object.entries(LABELLED_HUBS).map(([a, x]) => [a, { exchange: x, source: "public label" }]))
    for (const a of hubCandidates(transfers)) if (!hubs[a] && !(await codeAt(a, passBlock))) hubs[a] = { exchange: "unlabelled exchange", source: "inferred: many distinct senders into one wallet" }
    for (const [d, until] of open) if (until <= passMs) open.delete(d)

    for (const dep of findDeposits(transfers, hubs).slice(0, 6)) { // the live pass investigates at most six
      const id = `replay-s${dep.txs[0].slice(2, 12)}`
      if (done.has(id)) continue
      const meta = SUPPLY_TOKENS[dep.token]
      const m = mk[meta.symbol]
      const h1 = m.h1.filter((k) => k.t + HOUR <= passMs).slice(-72) // closed hourly candles only
      const last5 = m.m5.filter((k) => k.t + 5 * 60_000 <= passMs).slice(-1)[0]
      const rets = h1.slice(1).map((k, i) => Math.log(k.c / h1[i].c))
      const mean = rets.reduce((s, r) => s + r, 0) / rets.length
      const sigma = Math.sqrt(rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1)) * Math.sqrt(24)
      const prior = h1[h1.length - 2] ?? h1[0]
      const movePct = Number((((last5?.c ?? h1[h1.length - 1].c) / prior.o - 1) * 100).toFixed(3))
      const volPoint = m.vol.filter(([t]) => t <= passMs).slice(-1)[0]
      const dailyVolumeUsd = volPoint ? volPoint[1] : null
      const sizing = computePositionSizing({ windowSigma: sigma, quoteVolumeUsd: h1.slice(-24).reduce((s, k) => s + k.q, 0), candles: h1.map((k) => ({ high: k.h, low: k.l })) })
      const modeled = supplyImpactPct({ usd: dep.usd, dailyVolumeUsd, dailySigma: sigma })
      const marketDelta = Number((-movePct).toFixed(3))
      const minEdge = supplyMinEdgePct(m.costProxy)
      const refBlock = (dep.fundingBlock ?? dep.block) - 1
      const before = await balanceAt(dep.token, dep.depositor, refBlock)
      const supply = await supplyOf(dep.token)
      const depositor = {
        address: dep.depositor, isContract: await codeAt(dep.depositor, dep.block), transactionCount: await nonceAt(dep.depositor, dep.block),
        balanceBefore: before, shareOfBalanceSent: before > 0 ? Number(Math.min(1, dep.amount / before).toFixed(4)) : null,
        shareOfSupply: supply > 0 ? Number((dep.amount / supply).toFixed(6)) : null, viaDepositAddress: dep.depositAddress,
      }
      const candidates = [{ kind: "DIRECT", instrument: meta.instrument, modeledDeltaPct: modeled, marketDeltaPct: marketDelta, minEdgePct: minEdge, sizing, demoListed: true, sameSenderOpen: open.has(dep.depositor) }]
      const packet = {
        eventClass: "SUPPLY_TO_EXCHANGE", token: meta.symbol, amount: Math.round(dep.amount), approxUsd: Math.round(dep.usd),
        exchange: { name: dep.exchange, hub: dep.hub, identifiedBy: dep.hubSource }, depositor,
        market: { dailyVolumeUsd: dailyVolumeUsd && Math.round(dailyVolumeUsd), dailySigma: Number(sigma.toFixed(4)), moveLastTwoHoursPct: movePct },
        candidates: candidates.map((c, i) => ({ index: i, kind: c.kind, instrument: c.instrument, modeledDeltaPct: c.modeledDeltaPct, marketDeltaPct: c.marketDeltaPct, minEdgePct: c.minEdgePct, sizeable: Boolean(c.sizing?.computable), demoListed: c.demoListed })),
      }
      // Code would refuse any trade here, whatever Claude said: same outcome as the live path, without the call.
      const edge = modeled == null ? null : modeled - Math.max(0, marketDelta) // same rule as enforce()
      const codeRefusesAnyTrade = edge === null || edge < minEdge || !sizing.computable || candidates[0].sameSenderOpen
      let ai = null, aiError = null
      if (!codeRefusesAnyTrade) {
        try { ai = await decideWithClaude(packet, { apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.ANTHROPIC_MODEL || "claude-opus-5" }) } catch (e) { aiError = String(e.message ?? e) }
      }
      const final = codeRefusesAnyTrade
        ? { decision: "NO_TRADE", chosen: null, proposed: null, refusals: [`edge ${edge === null ? "unknown" : edge.toFixed(3) + "%"} vs bar ${minEdge}%${candidates[0].sameSenderOpen ? "; depositor already in a position" : ""}`] }
        : enforce(ai, candidates)
      const rec = {
        id, kind: "REPLAY", eventClass: "SUPPLY_TO_EXCHANGE", decidedAt: new Date().toISOString(),
        detectedAt: new Date(passMs).toISOString(), block: dep.block, tx: dep.txs[0], token: meta.symbol, instrument: meta.instrument,
        usd: Math.round(dep.usd), exchange: dep.exchange, hubSource: dep.hubSource, depositor, dailyVolumeUsd, sigma, movePct,
        modeledDeltaPct: modeled, marketDeltaPct: marketDelta, minEdgePct: minEdge, costProxy: m.costProxy, book: m.book,
        sizing: sizing.computable ? { notionalUsd: sizing.notionalUsd, stopPct: sizing.stopPct } : null,
        claudeConsulted: !codeRefusesAnyTrade, aiDecision: ai, aiError, decision: final.decision, proposed: final.proposed, refusals: final.refusals,
        snapshotHash: sha256(packet),
      }
      appendHashLog(DECISIONS, rec)
      done.add(id)
      if (final.decision.startsWith("TRADE")) open.set(dep.depositor, passMs + AGENT_LIMITS.maxHoldHours * HOUR)
      n += 1
      console.log(`${rec.detectedAt} ${meta.symbol} $${rec.usd} edge ${edge?.toFixed(3)} bar ${minEdge} ${rec.decision}${rec.claudeConsulted ? ` (claude ${ai?.action ?? aiError} ${ai?.confidence ?? ""})` : ""}`)
    }
  }
  console.log(`decided ${n} new deposits`)
}

// ---------- phase 2: outcomes, from the saved decisions only ----------
async function simulate(d) {
    const t0 = Date.parse(d.detectedAt)
    const horizon = t0 + AGENT_LIMITS.maxHoldHours * HOUR
    if (horizon > Date.now() - 10 * 60_000) { return { status: "INCOMPLETE", reason: "18 hour horizon not yet elapsed" } }
    const path5 = await candles(d.instrument, "5m", t0, horizon + 5 * 60_000)
    if (!path5.length) { return { status: "INCOMPLETE", reason: "no price data" } }
    const halfSpread = Math.max(0, d.costProxy - 2 * TAKER_FEE) / 2
    const entry = path5[0].o * (1 - halfSpread) // short: sell at the bid
    const notional = Math.min(d.sizing.notionalUsd, AGENT_LIMITS.demoNotionalCapUsd)
    const stopPx = entry * (1 + d.sizing.stopPct)
    let exit = null, exitReason = "time stop: held 18h", exitAt = null
    for (const k of path5) {
      if (k.h >= stopPx) { exit = Math.max(stopPx, k.o); exitReason = `stop: ${(d.sizing.stopPct * 100).toFixed(2)}% against`; exitAt = k.t; break }
    }
    if (exit === null) { const last = path5[path5.length - 1]; exit = last.c; exitAt = last.t + 5 * 60_000 }
    exit *= 1 + halfSpread // buy back at the ask
    const gross = (entry - exit) / entry
    const ret = gross - 2 * TAKER_FEE
    return { status: "CLOSED", token: d.token, instrument: d.instrument, openedAt: new Date(path5[0].t).toISOString(), closedAt: new Date(exitAt).toISOString(),
      entry, exit, exitReason, notionalUsd: notional, returnPct: Number((ret * 100).toFixed(4)), pnlUsd: Number((ret * notional).toFixed(4)),
    }
}

async function mark() {
  const decisions = readFileSync(DECISIONS, "utf8").trim().split("\n").map((l) => JSON.parse(l))
  const trades = []
  // Rules only baseline: the same deposits, traded whenever code's gates cleared, ignoring Claude.
  // This is what the AI decision is measured against; it is never counted as strategy P&L.
  const baseline = []
  for (const d of decisions.filter((x) => x.claudeConsulted && x.sizing)) {
    const b = await simulate(d)
    baseline.push({ ...b, id: d.id, token: d.token, usd: d.usd, claude: d.aiDecision ? `${d.aiDecision.action} ${d.aiDecision.confidence}` : "none", why: d.aiDecision?.rationale ?? null })
  }
  for (const d of decisions.filter((x) => String(x.decision).startsWith("TRADE"))) {
    trades.push({ ...(await simulate(d)), id: d.id, thesis: d.aiDecision?.thesis ?? null, confidence: d.aiDecision?.confidence ?? null })
  }
  const closed = trades.filter((t) => t.status === "CLOSED")
  const rets = closed.map((t) => t.returnPct / 100)
  const mean = rets.reduce((s, r) => s + r, 0) / (rets.length || 1)
  const sd = rets.length > 1 ? Math.sqrt(rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1)) : null
  // Daily P&L on the capped book for an annualised Sharpe, and the equity path for drawdown.
  const byDay = new Map()
  for (const t of closed) byDay.set(t.closedAt.slice(0, 10), (byDay.get(t.closedAt.slice(0, 10)) ?? 0) + t.pnlUsd)
  const days = decisions.length ? Math.max(1, Math.round((Date.parse(decisions[decisions.length - 1].detectedAt) - Date.parse(decisions[0].detectedAt)) / 86_400_000) + 1) : 0
  const daily = Array.from({ length: days }, (_, i) => byDay.get(new Date(Date.parse(decisions[0].detectedAt.slice(0, 10)) + i * 86_400_000).toISOString().slice(0, 10)) ?? 0)
  const dm = daily.reduce((s, x) => s + x, 0) / (daily.length || 1)
  const dsd = daily.length > 1 ? Math.sqrt(daily.reduce((s, x) => s + (x - dm) ** 2, 0) / (daily.length - 1)) : null
  let eq = 0, peak = 0, mdd = 0
  for (const t of [...closed].sort((a, b) => (a.closedAt < b.closedAt ? -1 : 1))) { eq += t.pnlUsd; peak = Math.max(peak, eq); mdd = Math.min(mdd, eq - peak) }
  const result = {
    label: "POINT IN TIME REPLAY (backtest), not live paper trading",
    method: "Every deposit of $500k or more of LINK, UNI, PEPE or SHIB into an exchange hub in the window, replayed at the next hourly pass with chain state, prices and volume available at that time. Live gates unchanged. Decisions were hash chained in data/backtest/supply-decisions.jsonl before any outcome was fetched. Spread uses the live book at replay time as a proxy.",
    window: { from: decisions[0]?.detectedAt ?? null, to: decisions[decisions.length - 1]?.detectedAt ?? null, days },
    deposits: decisions.length, claudeConsulted: decisions.filter((d) => d.claudeConsulted).length,
    claudeTrade: decisions.filter((d) => String(d.proposed).startsWith("TRADE")).length,
    trades: closed.length, incomplete: trades.length - closed.length,
    rulesOnlyBaseline: (() => { const c = baseline.filter((b) => b.status === "CLOSED"); return { trades: c.length, wins: c.filter((b) => b.pnlUsd > 0).length, totalPnlUsd: Number(c.reduce((x, b) => x + b.pnlUsd, 0).toFixed(4)), meanReturnPct: c.length ? Number((c.reduce((x, b) => x + b.returnPct, 0) / c.length).toFixed(4)) : null, detail: baseline } })(),
    winRate: closed.length ? Number((closed.filter((t) => t.pnlUsd > 0).length / closed.length).toFixed(3)) : null,
    totalPnlUsd: Number(closed.reduce((s, t) => s + t.pnlUsd, 0).toFixed(4)),
    meanReturnPct: closed.length ? Number((mean * 100).toFixed(4)) : null,
    sharpePerTrade: sd ? Number((mean / sd).toFixed(3)) : null,
    sharpeDailyAnnualised: dsd ? Number(((dm / dsd) * Math.sqrt(365)).toFixed(3)) : null,
    maxDrawdownUsd: Number(mdd.toFixed(4)),
    trades_detail: trades,
    decisionsLogHead: sha256(readFileSync(DECISIONS, "utf8")),
  }
  writeFileSync(RESULTS, JSON.stringify(result, null, 2) + "\n")
  console.log(JSON.stringify({ ...result, trades_detail: undefined }, null, 2))
}

const phase = process.argv[2]
if (phase === "decide") await decide(arg("--from", "2026-09-03T00:00:00Z"), arg("--to", new Date(Date.now() - 19 * HOUR).toISOString()))
else if (phase === "mark") await mark()
else { console.error("usage: backtest-supply.mjs decide|mark"); process.exit(1) }
