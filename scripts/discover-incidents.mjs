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
import { deriveDecisionPolicy } from "../lib/wake-policy.mjs"

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
    const exposures = []
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
    const decision = !primary ? "NO_TRADE" : deriveDecisionPolicy({
      falsification: [{ blocksTrade: true, status: "UNRESOLVED", question: "Is there an on-chain receipt proving the loss path?" }],
      modeledDelta: null, confidence: null, marketDelta: market?.observed?.exploitDayMovePct ?? 0,
      kind: primary?.kind ?? "NO TRADE", state: "INVESTIGATING", workflowState: "WATCHING",
    })

    const record = {
      schema: "wake.discovered.v1",
      id,
      discoveredAt: new Date().toISOString(),
      source: { feed: "https://api.llama.fi/hacks", record: hack, sha256: sha256(hack) },
      protocol: protocol ? { id: protocol.id, name: protocol.name, slug: protocol.slug, symbol: protocol.symbol, category: protocol.category } : null,
      exposures,
      instrument: primary?.symbol ?? null,
      market,
      marketError,
      decision,
      reason: primary
        ? "Discovered from the exploit feed. No on-chain receipt is captured yet, so causal confidence is unknown and the policy holds the incident at MONITOR."
        : "Discovered from the exploit feed, but no Bitget perpetual maps to the protocol or its chain, so there is nothing to trade.",
      nextStep: "Capture the exploit transaction receipt to escalate from MONITOR to a full causal investigation.",
    }
    record.integrity = sha256({ ...record, integrity: undefined })
    writeFileSync(path.join(OUT_DIR, `${id}.json`), JSON.stringify(record, null, 2) + "\n")
    index.incidents.push({ id, day, name: hack.name, amountUsd: hack.amount, chains: hack.chain, technique: hack.technique,
      instrument: record.instrument, decision, exploitDayMovePct: market?.observed?.exploitDayMovePct ?? null, discoveredAt: record.discoveredAt })
    opened.push(id)
  }

  index.incidents.sort((a, b) => (a.day < b.day ? 1 : -1))
  index.updatedAt = new Date().toISOString()
  index.lastRun = { lookbackDays: LOOKBACK_DAYS, minUsd: MIN_USD, feedRecords: hacks.length, inWindow: recent.length, opened: opened.length }
  writeFileSync(path.join(OUT_DIR, "index.json"), JSON.stringify(index, null, 2) + "\n")
  console.log(JSON.stringify({ opened, ...index.lastRun }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
