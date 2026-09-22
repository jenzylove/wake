// Live supply to exchange watcher.
//
// Every pass reads the Ethereum blocks it has not seen, finds large deposits of the four tokens
// that have a Bitget Demo perpetual, and measures each against the token's real daily volume. The
// depositor is profiled from chain state (contract or wallet, transaction count, share of its own
// balance moved, share of supply), Claude decides whether this is supply that will be sold, and
// code refuses anything whose modeled move does not beat three times its own round trip cost.
//
// Records land in data/live beside the drain incidents, in the same format, so the agent, the
// executor and the console treat both classes alike and label them apart.

import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { WATCHED, rpc, scanWindow } from "../lib/chain-watch.mjs"
import { LABELLED_HUBS, MIN_DEPOSIT_USD, SUPPLY_TOKENS, findDeposits, hubCandidates, roundTripCost, supplyImpactPct, supplyMinEdgePct } from "../lib/supply-watch.mjs"
import { decideAnywhere, enforce } from "../lib/ai-decide.mjs"
import { demoListed } from "../lib/demo-listing.mjs"
import { computePositionSizing } from "../lib/sizing.mjs"
import { appendHashLog } from "../lib/hash-log.mjs"
import { writeLiveSummary } from "../lib/live-summary.mjs"

const OUT = path.join(process.cwd(), "data", "live")
const STATE = path.join(OUT, "supply-state.json")
const LOG = path.join(OUT, "log.jsonl")
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
const SCAN_MIN_USD = 50_000 // funding hops and sweeps are read from this size up
const chain = WATCHED["1"]
const call = (method, params) => rpc(chain.rpc, method, params, 3, chain.fallbacks)
const now = () => new Date().toISOString()
const sha256 = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex")
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const hex = (n) => `0x${n.toString(16)}`

async function json(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  return res.json()
}

async function prices() {
  const out = {}
  for (const t of Object.values(SUPPLY_TOKENS)) {
    const body = await json(`https://api.bitget.com/api/v2/mix/market/symbol-price?symbol=${t.instrument}&productType=USDT-FUTURES`)
    out[t.symbol] = Number(body.data[0].markPrice)
  }
  return out
}

async function transfersIn(from, to, px) {
  const out = []
  let step = 100
  let start = from
  while (start <= to) {
    const end = Math.min(start + step - 1, to)
    let logs
    try {
      logs = await call("eth_getLogs", [{ address: Object.keys(SUPPLY_TOKENS), topics: [TRANSFER], fromBlock: hex(start), toBlock: hex(end) }])
    } catch (error) {
      if (/too large|exceeds limit|range|limited/i.test(String(error.message ?? error)) && step > 5) { step = Math.floor(step / 2); continue }
      throw error
    }
    if (!Array.isArray(logs)) continue // an empty reply from a node; ask again
    for (const l of logs) {
      if (l.topics.length !== 3) continue
      const meta = SUPPLY_TOKENS[l.address.toLowerCase()]
      const amount = Number(BigInt(l.data === "0x" ? "0x0" : l.data)) / 10 ** meta.decimals
      const usd = amount * px[meta.symbol]
      if (usd < SCAN_MIN_USD) continue
      out.push({ token: l.address.toLowerCase(), symbol: meta.symbol, amount, usd, from: `0x${l.topics[1].slice(26)}`.toLowerCase(),
        to: `0x${l.topics[2].slice(26)}`.toLowerCase(), tx: l.transactionHash, block: Number(l.blockNumber) })
    }
    start = end + 1
  }
  return out
}

async function isContract(addr) {
  const code = await call("eth_getCode", [addr, "latest"])
  return Boolean(code && code !== "0x")
}

async function balanceAt(token, addr, block) {
  const raw = await call("eth_call", [{ to: token, data: `0x70a08231${addr.slice(2).padStart(64, "0")}` }, hex(block)])
  return Number(BigInt(raw === "0x" ? "0x0" : raw)) / 1e18
}

async function totalSupply(token) {
  const raw = await call("eth_call", [{ to: token, data: "0x18160ddd" }, "latest"])
  return Number(BigInt(raw)) / 1e18
}

async function market(meta) {
  const body = await json(`https://api.bitget.com/api/v2/mix/market/candles?symbol=${meta.instrument}&productType=USDT-FUTURES&granularity=1H&limit=72`)
  const candles = body.data.map((k) => ({ timestamp: Number(k[0]), open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), quoteVolume: Number(k[6]) }))
  const rets = candles.slice(1).map((k, i) => Math.log(k.close / candles[i].close))
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length
  const hourly = Math.sqrt(rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1))
  const last = candles[candles.length - 1]
  const prior = candles[candles.length - 3] ?? candles[0]
  const tk = (await json(`https://api.bitget.com/api/v2/mix/market/ticker?symbol=${meta.instrument}&productType=USDT-FUTURES`)).data[0]
  const costPct = roundTripCost({ bid: Number(tk.bidPr), ask: Number(tk.askPr) })
  let dailyVolumeUsd = null
  for (let i = 0; i < 3 && dailyVolumeUsd === null; i += 1) {
    try {
      const cg = await json(`https://api.coingecko.com/api/v3/simple/price?ids=${meta.coingecko}&vs_currencies=usd&include_24hr_vol=true`)
      dailyVolumeUsd = cg[meta.coingecko]?.usd_24h_vol ?? null
    } catch { /* retried below */ }
    if (dailyVolumeUsd === null) await sleep(4000) // the free API rate limits; unknown volume means no modeled move
  }
  return {
    costPct, spread: { bid: Number(tk.bidPr), ask: Number(tk.askPr) }, candles, windowSigma: hourly * Math.sqrt(24), dailySigma: hourly * Math.sqrt(24),
    quoteVolumeUsd: candles.slice(-24).reduce((s, k) => s + k.quoteVolume, 0), dailyVolumeUsd,
    // how far price has already fallen over the last two hours, so the edge is what is left
    movePct: Number(((last.close / prior.open - 1) * 100).toFixed(3)),
  }
}

function openDepositors() {
  const f = path.join(process.cwd(), "data", "wake-paper", "summary.json")
  if (!existsSync(f)) return new Set()
  const open = JSON.parse(readFileSync(f, "utf8")).open ?? []
  const ids = new Set(open.map((p) => p.incidentId))
  const out = new Set()
  for (const n of readdirSync(OUT).filter((x) => x.startsWith("live-1-s") && x.endsWith(".json"))) {
    const r = JSON.parse(readFileSync(path.join(OUT, n), "utf8"))
    if (ids.has(r.id) && r.depositor?.address) out.add(r.depositor.address)
  }
  return out
}

async function investigate(dep, hubs, px, busy) {
  const id = `live-1-s${dep.txs[0].slice(2, 12)}`
  const file = path.join(OUT, `${id}.json`)
  if (existsSync(file)) return null
  const meta = SUPPLY_TOKENS[dep.token]

  const contract = await isContract(dep.depositor)
  const nonce = Number(await call("eth_getTransactionCount", [dep.depositor, "latest"]))
  const refBlock = (dep.fundingBlock ?? dep.block) - 1
  const before = await balanceAt(dep.token, dep.depositor, refBlock)
  const supply = await totalSupply(dep.token)
  const m = await market(meta)
  const sizing = computePositionSizing({ windowSigma: m.windowSigma, quoteVolumeUsd: m.quoteVolumeUsd, candles: m.candles })
  const modeled = supplyImpactPct({ usd: dep.usd, dailyVolumeUsd: m.dailyVolumeUsd, dailySigma: m.dailySigma })
  const marketDelta = Number((-m.movePct).toFixed(3)) // a fall already seen counts against the short
  // The bar uses the order book the trade would actually cross, measured now, not a candle estimate.
  const minEdge = m.costPct ? supplyMinEdgePct(m.costPct) : null
  const depositor = {
    address: dep.depositor, isContract: contract, transactionCount: nonce,
    balanceBefore: before, shareOfBalanceSent: before > 0 ? Number(Math.min(1, dep.amount / before).toFixed(4)) : null,
    shareOfSupply: supply > 0 ? Number((dep.amount / supply).toFixed(6)) : null,
    viaDepositAddress: dep.depositAddress,
  }
  const candidates = [{
    kind: "DIRECT", instrument: meta.instrument, modeledDeltaPct: modeled, marketDeltaPct: marketDelta, minEdgePct: minEdge,
    sizing, demoListed: (await demoListed([meta.instrument]))[meta.instrument] === true, sameSenderOpen: busy.has(dep.depositor),
  }]

  let decisionAi = null
  let decisionError = null
  try {
    decisionAi = await decideAnywhere({
      eventClass: "SUPPLY_TO_EXCHANGE",
      token: meta.symbol, amount: Math.round(dep.amount), approxUsd: Math.round(dep.usd),
      exchange: { name: dep.exchange, hub: dep.hub, identifiedBy: dep.hubSource },
      depositor,
      market: { dailyVolumeUsd: m.dailyVolumeUsd && Math.round(m.dailyVolumeUsd), dailySigma: Number(m.dailySigma.toFixed(4)), moveLastTwoHoursPct: m.movePct },
      candidates: candidates.map((c, i) => ({ index: i, kind: c.kind, instrument: c.instrument, modeledDeltaPct: c.modeledDeltaPct,
        marketDeltaPct: c.marketDeltaPct, minEdgePct: c.minEdgePct, sizeable: Boolean(c.sizing?.computable), demoListed: c.demoListed })),
    })
  } catch (error) { decisionError = String(error.message ?? error) }
  const final = enforce(decisionAi, candidates)

  const record = {
    schema: "wake.live.incident.v1", eventClass: "SUPPLY_TO_EXCHANGE",
    id, provenance: "REAL_CAPTURE", numbersProvenance: "COMPUTED", detectedAt: now(),
    chain: { id: "1", name: "ethereum" },
    detection: {
      tx: dep.txs[0], txs: dep.txs, fundingTx: dep.fundingTx, block: dep.block, contract: dep.depositor, recipient: dep.hub,
      exchange: dep.exchange, hubSource: dep.hubSource, asset: meta.symbol, amount: dep.amount, approxUsd: Math.round(dep.usd),
      balanceRemovedShare: depositor.shareOfBalanceSent,
    },
    depositor, instrument: meta.instrument,
    market: { movePct: m.movePct, roundTripCostPct: m.costPct && Number((m.costPct * 100).toFixed(4)), book: m.spread, dailySigma: Number(m.dailySigma.toFixed(6)), dailyVolumeUsd: m.dailyVolumeUsd && Math.round(m.dailyVolumeUsd), bitgetVolume24hUsd: Math.round(m.quoteVolumeUsd) },
    sizing, modeledDeltaPct: modeled, marketDeltaPct: marketDelta, minEdgePct: minEdge,
    decision: final.decision, aiDecision: decisionAi, aiDecisionError: decisionError, refusals: final.refusals, proposed: final.proposed,
    agent: final.chosen
      ? { decision: final.decision, gatePassed: true, decidedBy: "claude", instrument: meta.instrument, side: "SHORT", kind: "DIRECT", sizing }
      : { decision: final.decision, gatePassed: false, decidedBy: decisionAi ? "claude" : "none", refusals: final.refusals, instrument: meta.instrument, side: "SHORT" },
  }
  record.integrity = sha256({ ...record, integrity: undefined })
  writeFileSync(file, JSON.stringify(record, null, 2) + "\n")
  appendHashLog(LOG, { event: "SUPPLY_INCIDENT", id, token: meta.symbol, usd: Math.round(dep.usd), exchange: dep.exchange, decision: final.decision, integrity: record.integrity })
  return record
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {}
  const px = await prices()
  const head = Number(await call("eth_blockNumber", []))
  const { from, to } = scanWindow({ head, lastScanned: state.lastBlock, blockSeconds: chain.blockSeconds })
  const transfers = await transfersIn(from, to, px)

  const hubs = Object.fromEntries(Object.entries(LABELLED_HUBS).map(([a, x]) => [a, { exchange: x, source: "public label" }]))
  for (const a of hubCandidates(transfers)) {
    if (hubs[a]) continue
    if (!(await isContract(a))) hubs[a] = { exchange: "unlabelled exchange", source: "inferred: many distinct senders into one wallet" }
    await sleep(200)
  }
  const deposits = findDeposits(transfers, hubs)
  const busy = openDepositors()
  const opened = []
  for (const d of deposits.slice(0, 6)) {
    try {
      const r = await investigate(d, hubs, px, busy)
      if (r) opened.push({ id: r.id, token: r.detection.asset, usd: r.detection.approxUsd, decision: r.decision })
    } catch (error) {
      appendHashLog(LOG, { event: "SUPPLY_ERROR", tx: d.txs[0], error: String(error.message ?? error).slice(0, 160) })
    }
    await sleep(400)
  }
  const report = { at: now(), from, to, blocks: to - from + 1, transfers: transfers.length,
    hubs: Object.keys(hubs).length, inferredHubs: Object.values(hubs).filter((h) => h.source.startsWith("inferred")).length,
    deposits: deposits.length, minUsd: MIN_DEPOSIT_USD, opened }
  writeFileSync(STATE, JSON.stringify({ lastBlock: to, lastRun: report }, null, 2) + "\n")
  writeLiveSummary(OUT, { supply: report })
  appendHashLog(LOG, { event: "SUPPLY_SCAN", blocks: report.blocks, transfers: report.transfers, deposits: report.deposits, opened: opened.length })
  console.log(JSON.stringify(report, null, 2))
}

main().catch((error) => { console.error(error); process.exit(1) })
