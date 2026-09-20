// Autonomous incident discovery.
//
// Polls DefiLlama's public exploit feed, maps each new exploit to the Bitget perpetuals it could
// move, captures the market window around it, and opens a WAKE incident that the same tested
// policy decides on. Nothing here is hand-entered: every field is a feed record, an exchange
// response, or a computation over them, and the raw inputs are hashed into the record.
//
// A feed entry is not an on-chain receipt. Until a receipt is captured the incident has no
// causal confidence, so the policy holds it at MONITOR. Discovery opens investigations; it never
// turns an alert into an order, which is the PRD's hard rule.
//
// Run:  node scripts/discover-incidents.mjs        (writes data/discovered/)

import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { deriveDecisionPolicy, evaluateRiskGatePolicy } from "../lib/wake-policy.mjs"
import { computePositionSizing } from "../lib/sizing.mjs"
import { stockExposures } from "../lib/stock-exposure.mjs"
import { aiFalsifier, interpretAnywhere } from "../lib/ai-interpret.mjs"

const OUT_DIR = process.env.WAKE_DISCOVERY_DIR || path.join(process.cwd(), "data", "discovered")
const LOOKBACK_DAYS = Number(process.env.WAKE_DISCOVERY_DAYS || 21)
const MIN_USD = Number(process.env.WAKE_DISCOVERY_MIN_USD || 250_000)
const BITGET = "https://api.bitget.com"
const HOUR = 3_600_000

// Chain -> native token traded as a Bitget USDT-M perpetual. Exposure through the chain token is
// contagion, not direct damage, and is always recorded as an inference.
const CHAIN_TOKEN = {
  Ethereum: "ETH", Arbitrum: "ETH", Base: "ETH", Optimism: "ETH", Linea: "ETH", Blast: "ETH", Scroll: "ETH",
  "zkSync Era": "ETH", BSC: "BNB", Solana: "SOL", Tron: "TRX", Starknet: "STRK", Polygon: "POL",
  Avalanche: "AVAX", Sui: "SUI", Aptos: "APT", Sonic: "S", Berachain: "BERA", "Hyperliquid L1": "HYPE",
  Near: "NEAR", TON: "TON", Cosmos: "ATOM", Sei: "SEI", Mantle: "MNT", Cardano: "ADA",
}

const sha256 = (value) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex")
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)

async function getJson(url, attempts = 3) {
  let last
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url, { headers: { "user-agent": "wake-discovery/1.0" }, signal: AbortSignal.timeout(30_000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (error) {
      last = error
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)))
    }
  }
  throw new Error(`fetch failed: ${url}: ${last?.message ?? last}`)
}

async function bitgetContracts() {
  const body = await getJson(`${BITGET}/api/v2/mix/market/contracts?productType=USDT-FUTURES`)
  if (body.code !== "00000") throw new Error(`bitget contracts: ${body.msg}`)
  return new Set(body.data.filter((c) => c.symbolStatus === "normal").map((c) => c.symbol))
}

// Hourly traded candles around the exploit day: one day before, two days after.
async function marketWindow(symbol, dayStartMs) {
  const startTime = dayStartMs - 24 * HOUR
  const endTime = Math.min(dayStartMs + 48 * HOUR, Date.now())
  const url = `${BITGET}/api/v2/mix/market/history-candles?symbol=${symbol}&productType=USDT-FUTURES&granularity=1H&startTime=${startTime}&endTime=${endTime}&limit=200`
  const body = await getJson(url)
  if (body.code !== "00000") throw new Error(`bitget candles ${symbol}: ${body.msg}`)
  const candles = body.data
    .map((c) => ({ timestamp: Number(c[0]), open: Number(c[1]), high: Number(c[2]), low: Number(c[3]), close: Number(c[4]), baseVolume: Number(c[5]), quoteVolume: Number(c[6]) }))
    .sort((a, b) => a.timestamp - b.timestamp)
  if (candles.length < 6) return { source: "bitget-public-history-candles", granularity: "1H", symbol, startTime, endTime, candles, observed: null }
  const at = (t) => candles.reduce((best, c) => (Math.abs(c.timestamp - t) < Math.abs(best.timestamp - t) ? c : best))
  const pre = at(dayStartMs)
  const post = at(Math.min(dayStartMs + 24 * HOUR, candles[candles.length - 1].timestamp))
  const rets = []
  for (let i = 1; i < candles.length; i += 1) rets.push(Math.log(candles[i].close / candles[i - 1].close))
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length
  const hourlySigma = Math.sqrt(rets.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(1, rets.length - 1))
  return {
    source: "bitget-public-history-candles", granularity: "1H", symbol, startTime, endTime, candles,
    observed: {
      hours: candles.length,
      quoteVolumeUsd: Number(candles.reduce((s, c) => s + c.quoteVolume, 0).toFixed(2)),
      exploitDayMovePct: Number(((post.close / pre.open - 1) * 100).toFixed(3)),
      hourlySigma: Number(hourlySigma.toFixed(6)),
      windowSigma: Number((hourlySigma * Math.sqrt(24)).toFixed(6)),
    },
  }
}

// Live execution quality for the instrument right now: top of book spread, resting depth within
// 1% of mid, funding and open interest. Candles alone cannot show any of these.
async function microstructure(symbol) {
  const q = `symbol=${symbol}&productType=USDT-FUTURES`
  const [depth, funding, oi] = await Promise.all([
    getJson(`${BITGET}/api/v2/mix/market/merge-depth?${q}&limit=50`),
    getJson(`${BITGET}/api/v2/mix/market/current-fund-rate?${q}`),
    getJson(`${BITGET}/api/v2/mix/market/open-interest?${q}`),
  ])
  const asks = depth.data.asks.map(([p, s]) => [Number(p), Number(s)])
  const bids = depth.data.bids.map(([p, s]) => [Number(p), Number(s)])
  const mid = (asks[0][0] + bids[0][0]) / 2
  const within = (levels, lo, hi) => levels.filter(([p]) => p >= lo && p <= hi).reduce((sum, [p, s]) => sum + p * s, 0)
  return {
    observedAt: new Date().toISOString(),
    mid,
    spreadBps: Number((((asks[0][0] - bids[0][0]) / mid) * 10_000).toFixed(3)),
    bidDepthUsd1pct: Number(within(bids, mid * 0.99, mid).toFixed(0)),
    askDepthUsd1pct: Number(within(asks, mid, mid * 1.01).toFixed(0)),
    fundingRate: Number(funding.data[0]?.fundingRate ?? NaN),
    fundingIntervalHours: Number(funding.data[0]?.fundingRateInterval ?? NaN),
    openInterestContracts: Number(oi.data.openInterestList[0]?.size ?? NaN),
  }
}

// Append only decision log. Each line carries the hash of the line before it, so a rewritten
// history breaks the chain for anyone who replays it (npm run data:verify does).
function appendLog(entry) {
  const p = path.join(OUT_DIR, "log.jsonl")
  const lines = existsSync(p) ? readFileSync(p, "utf8").trim().split(String.fromCharCode(10)).filter(Boolean) : []
  const prevHash = lines.length ? JSON.parse(lines[lines.length - 1]).hash : "0".repeat(64)
  const body = { ...entry, at: new Date().toISOString(), prevHash }
  writeFileSync(p, lines.concat(JSON.stringify({ ...body, hash: sha256(body) })).join(String.fromCharCode(10)) + String.fromCharCode(10))
}

// Central conversion scenario, the same assumption the consequence model uses.
const PASSTHROUGH = 0.25

// What WAKE knows about an incident right now, in the policy's terms. A feed entry alone leaves
// both blockers open, so the incident holds at MONITOR. A receipt clears the first; a measured
// loss path clears the second. Only then can a modeled move exist, and only when the exposed
// protocol has a market capitalisation to measure the loss against.
export function assessDiscovered(record) {
  const hasReceipt = Boolean(record.receipt)
  const quantified = record.exposure?.quantified === true
  const primary = record.exposures?.[0] ?? null
  const mcap = record.protocol?.mcapUsd ?? null
  const lossUsd = quantified ? record.exposure.drainedUsd : null
  const modeledDelta = quantified && primary?.kind === "DIRECT" && mcap > 0 && lossUsd > 0
    ? Number((PASSTHROUGH * lossUsd / mcap * 100).toFixed(3))
    : null
  const evidence = [
    { key: "receipt", ok: hasReceipt, weight: 30 },
    { key: "loss-path", ok: quantified, weight: 30 },
    { key: "instrument", ok: Boolean(primary), weight: primary?.kind === "DIRECT" ? 20 : 10 },
    { key: "ai-review", ok: Boolean(record.ai) && record.ai.veto !== true, weight: 20 },
  ]
  const confidence = modeledDelta === null ? null : evidence.reduce((s, e) => s + (e.ok ? e.weight : 0), 0)
  return {
    falsification: [
      { key: "receipt", question: "Is there an on-chain receipt proving the loss path?", status: hasReceipt ? "REJECTED" : "UNRESOLVED", blocksTrade: !hasReceipt },
      { key: "loss-path", question: "Is the downstream exposure quantified from chain state?", status: quantified ? "REJECTED" : "UNRESOLVED", blocksTrade: !quantified },
      { key: "market-cap", question: "Is there a market capitalisation to measure the loss against?", status: modeledDelta === null ? "UNRESOLVED" : "REJECTED", blocksTrade: modeledDelta === null },
      ...(record.ai ? [aiFalsifier(record.ai)] : []),
    ],
    modeledDelta, confidence, marketDelta: record.market?.observed?.exploitDayMovePct ?? 0,
    kind: primary?.kind ?? "NO TRADE", state: quantified ? "CONFIRMED" : "INVESTIGATING", workflowState: quantified ? "MARKET_CHECK" : "WATCHING",
    maxLoss: record.sizing?.computable ? `$${Math.round(record.sizing.maxLossUsd)}` : "$0",
    evidence: evidence.filter((e) => e.ok),
  }
}

const policyInput = (record) => assessDiscovered(record)

// Every open incident is re-checked each run: fresh microstructure, the decision recomputed,
// and incidents older than the lookback with no receipt are retired as NO_TRADE.
async function reevaluate(index, skip = []) {
  let updated = 0
  for (const entry of index.incidents) {
    if (entry.decision !== "MONITOR" || skip.includes(entry.id)) continue
    const file = path.join(OUT_DIR, `${entry.id}.json`)
    if (!existsSync(file)) continue
    const record = JSON.parse(readFileSync(file, "utf8"))
    const ageDays = (Date.now() - Date.parse(`${entry.day}T00:00:00Z`)) / 86_400_000
    const previous = record.decision
    if (ageDays > LOOKBACK_DAYS && !record.receipt) {
      record.decision = "NO_TRADE"
      record.reason = `No on-chain receipt within ${LOOKBACK_DAYS} days of the exploit. The information gap WAKE trades has closed, so the incident is retired.`
    } else {
      try {
        const snap = await microstructure(record.instrument)
        record.timeline = (record.timeline ?? []).concat(snap).slice(-48)
      } catch (error) {
        record.timeline = (record.timeline ?? []).concat({ observedAt: new Date().toISOString(), error: String(error.message ?? error) }).slice(-48)
      }
      const input = policyInput(record)
      record.decision = deriveDecisionPolicy(input)
      record.gate = evaluateRiskGatePolicy(input)
      record.assessment = { modeledDeltaPct: input.modeledDelta, marketDeltaPct: input.marketDelta, confidence: input.confidence, falsification: input.falsification }
    }
    record.integrity = sha256({ ...record, integrity: undefined })
    writeFileSync(file, JSON.stringify(record, null, 2) + String.fromCharCode(10))
    entry.decision = record.decision
    if (previous !== record.decision) appendLog({ event: "DECISION_CHANGED", id: entry.id, from: previous, to: record.decision, integrity: record.integrity })
    updated += 1
  }
  return updated
}

function readIndex() {
  const p = path.join(OUT_DIR, "index.json")
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : { schema: "wake.discovered.index.v1", incidents: [] }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  const [hacks, protocols, contracts] = await Promise.all([
    getJson("https://api.llama.fi/hacks"),
    getJson("https://api.llama.fi/protocols"),
    bitgetContracts(),
  ])
  const protocolById = new Map(protocols.map((p) => [String(p.id), p]))
  const since = Date.now() / 1000 - LOOKBACK_DAYS * 86_400
  const index = readIndex()
  const known = new Set(index.incidents.map((i) => i.id))
  const recent = hacks.filter((h) => h.date >= since && (h.amount ?? 0) >= MIN_USD).sort((a, b) => b.date - a.date)
  const opened = []

  for (const hack of recent) {
    const day = new Date(hack.date * 1000).toISOString().slice(0, 10)
    const id = `disc-${slug(hack.name)}-${day}`
    if (known.has(id)) continue

    const protocol = hack.defillamaId != null ? protocolById.get(String(hack.defillamaId)) : undefined
    // Stock spillover first: a direct company path outranks a chain token proxy.
    const exposures = stockExposures(hack, contracts)
    const protocolSymbol = protocol?.symbol && protocol.symbol !== "-" ? `${protocol.symbol.toUpperCase()}USDT` : null
    if (protocolSymbol && contracts.has(protocolSymbol)) {
      exposures.push({ symbol: protocolSymbol, kind: "DIRECT", relation: "protocol token", epistemic: "INFERRED" })
    }
    for (const chain of hack.chain ?? []) {
      const token = CHAIN_TOKEN[chain]
      const symbol = token ? `${token}USDT` : null
      if (symbol && contracts.has(symbol) && !exposures.some((e) => e.symbol === symbol)) {
        exposures.push({ symbol, kind: "CONTAGION", relation: `native token of ${chain}`, epistemic: "INFERRED" })
      }
    }

    const primary = exposures[0] ?? null
    let market = null
    let marketError = null
    if (primary) {
      try {
        market = await marketWindow(primary.symbol, Date.parse(`${day}T00:00:00Z`))
      } catch (error) {
        marketError = String(error.message ?? error)
      }
    }

    // The policy decides, exactly as for captured incidents. With no on-chain receipt there is no
    // causal confidence, so it holds at MONITOR (open investigation), never at a trade.
    let micro = null
    if (primary) {
      try { micro = await microstructure(primary.symbol) } catch { micro = null }
    }
    const decision = !primary ? "NO_TRADE" : deriveDecisionPolicy(policyInput({ exposures, market, receipt: null }))
    // What WAKE would size if the incident escalated: same deterministic sizer as captured incidents.
    const sizing = market?.observed
      ? computePositionSizing({ windowSigma: market.observed.windowSigma, quoteVolumeUsd: market.observed.quoteVolumeUsd, candles: market.candles })
      : { computable: false, reason: "no market window" }

    const record = {
      schema: "wake.discovered.v1",
      id,
      discoveredAt: new Date().toISOString(),
      source: { feed: "https://api.llama.fi/hacks", record: hack, sha256: sha256(hack) },
      protocol: protocol ? { id: protocol.id, name: protocol.name, slug: protocol.slug, symbol: protocol.symbol, category: protocol.category, mcapUsd: protocol.mcap ?? null } : null,
      exposures,
      instrument: primary?.symbol ?? null,
      market,
      marketError,
      timeline: micro ? [micro] : [],
      sizing,
      receipt: null,
      decision,
      reason: primary
        ? "Discovered from the exploit feed. No on-chain receipt is captured yet, so causal confidence is unknown and the policy holds the incident at MONITOR."
        : "Discovered from the exploit feed, but no Bitget perpetual maps to the protocol or its chain, so there is nothing to trade.",
      nextStep: "Capture the exploit transaction receipt to escalate from MONITOR to a full causal investigation.",
    }
    // Claude explains the incident from the feed record and market window. On a MONITOR incident
    // a veto has nothing to block; the explanation is what a trader reads.
    try {
      record.ai = await interpretAnywhere({ feedRecord: hack, protocol: record.protocol, exposures, marketObserved: market?.observed ?? null,
        note: "Feed record only; no on-chain receipt has been captured yet." })
    } catch (error) { record.ai = null; record.aiError = String(error.message ?? error) }
    record.integrity = sha256({ ...record, integrity: undefined })
    writeFileSync(path.join(OUT_DIR, `${id}.json`), JSON.stringify(record, null, 2) + "\n")
    index.incidents.push({ id, day, name: hack.name, amountUsd: hack.amount, chains: hack.chain, technique: hack.technique,
      instrument: record.instrument, decision, exploitDayMovePct: market?.observed?.exploitDayMovePct ?? null, discoveredAt: record.discoveredAt })
    opened.push(id)
    appendLog({ event: "OPENED", id, decision, instrument: record.instrument, sourceSha256: record.source.sha256, integrity: record.integrity })
  }
  const reevaluated = await reevaluate(index, opened)

  index.incidents.sort((a, b) => (a.day < b.day ? 1 : -1))
  index.updatedAt = new Date().toISOString()
  index.lastRun = { lookbackDays: LOOKBACK_DAYS, minUsd: MIN_USD, feedRecords: hacks.length, inWindow: recent.length, opened: opened.length, reevaluated: 0 }
  index.lastRun.reevaluated = reevaluated
  writeFileSync(path.join(OUT_DIR, "index.json"), JSON.stringify(index, null, 2) + "\n")
  console.log(JSON.stringify({ opened, ...index.lastRun }, null, 2))
}

// Only run a discovery pass when this file is the entry point; tests import assessDiscovered.
import { pathToFileURL } from "node:url"
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
