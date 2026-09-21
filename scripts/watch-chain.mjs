// Live chain watcher: real incidents, found by WAKE itself.
//
// Every pass reads the blocks it has not seen yet on Ethereum, Base and Arbitrum, looks for a
// single transaction that removes most of a contract's balance of a major asset, and confirms each
// candidate against contract state. A confirmed drain becomes an incident: the loss path is
// measured with the same code used on captured incidents, Claude reviews it and may veto, and the
// deterministic policy decides. Nothing here trusts a feed, a headline or a label.
//
// Most passes will find nothing, and most of what they do find will be a legitimate treasury or
// bridge movement that the checks reject. That is the point: the detector has to survive a real
// chain, not a curated list.

import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { WATCHED, MIN_DRAIN_USD, confirmDrain, rpc, scanWindow, watchedTransfers } from "../lib/chain-watch.mjs"
import { quantifyExposure } from "../lib/onchain-exposure.mjs"
import { aiFalsifier, interpretAnywhere } from "../lib/ai-interpret.mjs"
import { deriveDecisionPolicy, evaluateRiskGatePolicy } from "../lib/wake-policy.mjs"
import { computePositionSizing } from "../lib/sizing.mjs"
import { appendHashLog } from "../lib/hash-log.mjs"

const OUT = path.join(process.cwd(), "data", "live")
const STATE = path.join(OUT, "state.json")
const LOG = path.join(OUT, "log.jsonl")
const PASSTHROUGH = 0.25
const sha256 = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex")
const now = () => new Date().toISOString()

async function ethUsdPrice() {
  try {
    const res = await fetch("https://api.bitget.com/api/v2/mix/market/symbol-price?symbol=ETHUSDT&productType=USDT-FUTURES", { signal: AbortSignal.timeout(20_000) })
    return Number((await res.json()).data[0].markPrice)
  } catch { return null }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let protocolList = null

// The market the loss would land in, and what it is worth, from DefiLlama's own protocol list.
async function protocolFor(chainName, address) {
  try {
    if (!protocolList) {
      const res = await fetch("https://api.llama.fi/protocols", { signal: AbortSignal.timeout(30_000) })
      protocolList = await res.json()
    }
    const list = protocolList
    const key = `${chainName}:${address}`.toLowerCase()
    const hit = list.find((p) => String(p.address ?? "").toLowerCase() === key || String(p.address ?? "").toLowerCase() === address)
    if (!hit) return null
    return { name: hit.name, slug: hit.slug, symbol: hit.symbol, mcapUsd: hit.mcap ?? null, category: hit.category }
  } catch { return null }
}

async function bitgetListed(symbol) {
  if (!symbol || symbol === "-") return null
  const instrument = `${symbol.toUpperCase()}USDT`
  try {
    const res = await fetch(`https://api.bitget.com/api/v2/mix/market/contracts?productType=USDT-FUTURES&symbol=${instrument}`, { signal: AbortSignal.timeout(20_000) })
    const body = await res.json()
    return body.code === "00000" && body.data?.[0]?.symbolStatus === "normal" ? instrument : null
  } catch { return null }
}

async function marketWindow(instrument) {
  const res = await fetch(`https://api.bitget.com/api/v2/mix/market/candles?symbol=${instrument}&productType=USDT-FUTURES&granularity=1H&limit=72`, { signal: AbortSignal.timeout(30_000) })
  const body = await res.json()
  const candles = body.data.map((k) => ({ timestamp: Number(k[0]), open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), quoteVolume: Number(k[6]) }))
  const rets = candles.slice(1).map((k, i) => Math.log(k.close / candles[i].close))
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length
  const sigma = Math.sqrt(rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1)) * Math.sqrt(24)
  const last24 = candles.slice(-24)
  const movePct = ((last24[last24.length - 1].close / last24[0].open - 1) * 100)
  return {
    candles, windowSigma: sigma,
    quoteVolumeUsd: candles.reduce((s, k) => s + k.quoteVolume, 0),
    movePct: Number(movePct.toFixed(3)),
  }
}

async function investigate({ chainId, chain, transfer, drain }) {
  const id = `live-${chainId}-${transfer.tx.slice(2, 12)}`
  const file = path.join(OUT, `${id}.json`)
  if (existsSync(file)) return null

  const exposure = await quantifyExposure({ chainId, txHash: transfer.tx, etherscanKey: process.env.ETHERSCAN_API_KEY }).catch((e) => ({ quantified: false, reason: String(e.message ?? e) }))
  const victim = exposure.victim ?? transfer.from
  const protocol = await protocolFor(chain.name, victim)
  const instrument = protocol ? await bitgetListed(protocol.symbol) : null

  let market = null
  let sizing = { computable: false, reason: "no instrument" }
  if (instrument) {
    try {
      market = await marketWindow(instrument)
      sizing = computePositionSizing({ windowSigma: market.windowSigma, quoteVolumeUsd: market.quoteVolumeUsd, candles: market.candles })
    } catch { market = null }
  }

  const lossUsd = exposure.quantified ? exposure.drainedUsd : transfer.usd
  const mcap = protocol?.mcapUsd ?? null
  const modeledDelta = mcap > 0 && lossUsd > 0 ? Number((PASSTHROUGH * lossUsd / mcap * 100).toFixed(3)) : null
  const marketDelta = market ? Number((-market.movePct).toFixed(3)) : 0

  let ai = null
  let aiError = null
  try {
    ai = await interpretAnywhere({
      chain: chain.name,
      transaction: transfer.tx,
      drainedContract: victim,
      asset: { symbol: transfer.symbol, amount: transfer.amount, approxUsd: Math.round(transfer.usd) },
      balanceRemovedShare: Number(drain.removedShare.toFixed(4)),
      exposure: exposure.quantified ? { drainedUsd: Math.round(exposure.drainedUsd), integrators: exposure.integrators?.slice(0, 6) ?? [] } : { measured: false, reason: exposure.reason },
      protocol, instrument,
      note: "Detected live from chain state. A legitimate treasury movement, bridge settlement or migration looks similar; say so if that is what this is.",
    })
  } catch (error) { aiError = String(error.message ?? error) }

  const evidence = [
    { key: "drain", ok: drain.removedShare >= 0.6, weight: 25, detail: `${Math.round(drain.removedShare * 100)}% of the contract's ${transfer.symbol} left in one transaction` },
    { key: "loss-path", ok: exposure.quantified === true, weight: 25, detail: exposure.quantified ? `measured $${Math.round(exposure.drainedUsd).toLocaleString("en-US")}` : String(exposure.reason ?? "not measured") },
    { key: "protocol", ok: Boolean(protocol), weight: 20, detail: protocol ? `${protocol.name} (${protocol.symbol ?? "no token"})` : "contract does not match a known protocol" },
    { key: "instrument", ok: Boolean(instrument), weight: 15, detail: instrument ?? "no Bitget perpetual for the affected protocol" },
    { key: "ai-review", ok: Boolean(ai) && ai.veto !== true, weight: 15, detail: ai ? `${ai.exploitClass}${ai.veto ? " (vetoed)" : ""}` : (aiError ?? "not run") },
  ]
  const confidence = modeledDelta === null ? null : evidence.reduce((s, e) => s + (e.ok ? e.weight : 0), 0)

  const falsification = [
    { key: "loss-path", question: "Is the loss path measured from chain state?", status: exposure.quantified ? "REJECTED" : "UNRESOLVED", blocksTrade: !exposure.quantified },
    { key: "market", question: "Is there a listed instrument and a market capitalisation to size the consequence against?", status: modeledDelta === null ? "UNRESOLVED" : "REJECTED", blocksTrade: modeledDelta === null },
    ...(ai ? [aiFalsifier(ai)] : []),
  ]
  const policyInput = {
    falsification, modeledDelta, confidence, marketDelta,
    kind: "DIRECT", state: exposure.quantified ? "CONFIRMED" : "INVESTIGATING", workflowState: "MARKET_CHECK",
    maxLoss: sizing.computable ? `$${Math.round(sizing.maxLossUsd)}` : "$0",
    evidence: evidence.filter((e) => e.ok),
  }
  const decision = deriveDecisionPolicy(policyInput)
  const gate = evaluateRiskGatePolicy(policyInput)

  const record = {
    schema: "wake.live.incident.v1",
    id, provenance: "REAL_CAPTURE", numbersProvenance: "COMPUTED",
    detectedAt: now(),
    chain: { id: chainId, name: chain.name },
    detection: {
      tx: transfer.tx, block: transfer.block, contract: transfer.from, recipient: transfer.to,
      asset: transfer.symbol, amount: transfer.amount, approxUsd: Math.round(transfer.usd),
      balanceRemovedShare: Number(drain.removedShare.toFixed(4)),
    },
    exposure, protocol, instrument,
    market: market ? { movePct: market.movePct, windowSigma: Number(market.windowSigma.toFixed(6)), quoteVolumeUsd: Math.round(market.quoteVolumeUsd) } : null,
    sizing, evidence, falsification, confidence, modeledDeltaPct: modeledDelta, marketDeltaPct: marketDelta,
    decision, gate, ai, aiError,
    agent: { decision, gatePassed: gate.passed, instrument, side: "SHORT", kind: "DIRECT", sizing },
  }
  record.integrity = sha256({ ...record, integrity: undefined })
  writeFileSync(file, JSON.stringify(record, null, 2) + "\n")
  appendHashLog(LOG, { event: "LIVE_INCIDENT", id, chain: chain.name, tx: transfer.tx, usd: Math.round(transfer.usd), decision, gatePassed: gate.passed, protocol: protocol?.name ?? null, integrity: record.integrity })
  return record
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : { chains: {} }
  const ethUsd = await ethUsdPrice()
  const report = { at: now(), ethUsd, chains: {}, opened: [] }

  for (const [chainId, chain] of Object.entries(WATCHED)) {
    const seen = state.chains[chainId] ?? {}
    try {
      const head = Number(await rpc(chain.rpc, "eth_blockNumber", [], 3, chain.fallbacks ?? []))
      const { from, to, skipped } = scanWindow({ head, lastScanned: seen.lastBlock, blockSeconds: chain.blockSeconds })
      // Public nodes cap how much a single getLogs may return, and the cap differs per provider
      // and per range. Rather than guess, the range halves on refusal until it is accepted.
      const transfers = []
      let step = chain.blockSeconds < 1 ? 400 : 200
      let start = from
      let failures = 0
      while (start <= to && failures < 6) {
        const end = Math.min(start + step - 1, to)
        try {
          transfers.push(...await watchedTransfers({ url: chain.rpc, tokens: chain.tokens, fromBlock: start, toBlock: end, ethUsd, fallbacks: chain.fallbacks ?? [] }))
          start = end + 1
        } catch (error) {
          const msg = String(error.message ?? error)
          if (/too large|exceeds limit|range|limited/i.test(msg) && step > 12) { step = Math.floor(step / 2); continue }
          failures += 1
          report.chains[chainId] = { lastError: `${start}-${end}: ${msg.slice(0, 110)}` }
          start = end + 1
        }
      }

      // Public nodes throttle aggressively, so candidates are confirmed slowly and in order of size.
      const confirmed = []
      for (const t of transfers.sort((a, b) => b.usd - a.usd).slice(0, 14)) {
        try {
          const drain = await confirmDrain({ url: chain.rpc, transfer: t, fallbacks: chain.fallbacks ?? [] })
          if (drain.candidate) confirmed.push({ transfer: t, drain })
        } catch (error) {
          report.chains[chainId] = { ...(report.chains[chainId] ?? {}), lastError: String(error.message ?? error).slice(0, 110) }
        }
        await sleep(chain.blockSeconds < 1 ? 250 : 400)
      }
      for (const c of confirmed) {
        const record = await investigate({ chainId, chain, ...c })
        if (record) report.opened.push({ id: record.id, decision: record.decision, usd: record.detection.approxUsd, protocol: record.protocol?.name ?? null })
      }

      state.chains[chainId] = { lastBlock: to, scannedAt: now() }
      report.chains[chainId] = { ...(report.chains[chainId] ?? {}), name: chain.name, from, to, blocks: to - from + 1, skipped, largeTransfers: transfers.length, drains: confirmed.length }
    } catch (error) {
      report.chains[chainId] = { name: chain.name, error: String(error.message ?? error).slice(0, 160) }
    }
  }

  state.lastRun = report
  writeFileSync(STATE, JSON.stringify(state, null, 2) + "\n")

  // Compact view for the console: every live incident, newest first.
  const incidents = readdirSync(OUT)
    .filter((f) => f.startsWith("live-") && f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(path.join(OUT, f), "utf8")))
    .sort((a, b) => (a.detectedAt < b.detectedAt ? 1 : -1))
    .slice(0, 40)
    .map((r) => ({
      id: r.id, detectedAt: r.detectedAt, chain: r.chain.name, tx: r.detection.tx,
      contract: r.detection.contract, asset: r.detection.asset, approxUsd: r.detection.approxUsd,
      removedShare: r.detection.balanceRemovedShare, protocol: r.protocol, instrument: r.instrument,
      decision: r.decision, gatePassed: r.gate.passed, confidence: r.confidence,
      modeledDeltaPct: r.modeledDeltaPct, marketDeltaPct: r.marketDeltaPct,
      exposureMeasured: r.exposure?.quantified === true, sizing: r.sizing?.computable ? r.sizing : null,
      falsification: r.falsification,
      ai: r.ai ? { exploitClass: r.ai.exploitClass, veto: r.ai.veto, narrative: r.ai.narrative, lossBearer: r.ai.lossBearer, concerns: r.ai.concerns } : null,
    }))
  writeFileSync(path.join(OUT, "summary.json"), JSON.stringify({
    updatedAt: now(), minUsd: MIN_DRAIN_USD, chains: report.chains, scanned: state.chains, incidents,
  }, null, 2) + "\n")
  appendHashLog(LOG, { event: "SCAN", chains: Object.fromEntries(Object.entries(report.chains).map(([k, v]) => [v.name ?? k, v.error ? "error" : `${v.blocks} blocks, ${v.largeTransfers} large transfers, ${v.drains} drains`])), opened: report.opened.length })
  console.log(JSON.stringify({ minUsd: MIN_DRAIN_USD, ...report }, null, 2))
}

main().catch((error) => { console.error(error); process.exit(1) })
