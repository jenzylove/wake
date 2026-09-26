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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { WATCHED, MIN_DRAIN_USD, RESTING_MINUTES, chainConfig, confirmDrain, recurringSenders, rpc, scanWindow, watchedTransfers } from "../lib/chain-watch.mjs"
import { quantifyExposure } from "../lib/onchain-exposure.mjs"
import { aiFalsifier, interpretAnywhere } from "../lib/ai-interpret.mjs"
import { codeRefusesAnyTrade, decideAnywhere, enforce } from "../lib/ai-decide.mjs"
import { demoListed } from "../lib/demo-listing.mjs"
import { deriveDecisionPolicy, evaluateRiskGatePolicy } from "../lib/wake-policy.mjs"
import { computePositionSizing } from "../lib/sizing.mjs"
import { appendHashLog } from "../lib/hash-log.mjs"
import { writeLiveSummary } from "../lib/live-summary.mjs"

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
  // With no listed market there is nothing to trade, so the model is not asked to explain or decide.
  if (instrument) try {
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
  const policyDecision = deriveDecisionPolicy(policyInput)
  const gate = evaluateRiskGatePolicy(policyInput)

  // Claude decides; code can only refuse. The single candidate is the drained protocol itself.
  const candidates = instrument ? [{
    kind: "DIRECT", instrument, protocol: protocol?.name ?? null, lossUsd, marketCapUsd: mcap,
    modeledDeltaPct: modeledDelta, marketDeltaPct: marketDelta, sizing,
    demoListed: (await demoListed([instrument]))[instrument] === true,
  }] : []
  let decisionAi = null
  let decisionError = null
  const precheck = codeRefusesAnyTrade(candidates)
  if (!precheck) try {
    decisionAi = await decideAnywhere({
      chain: chain.name, transaction: transfer.tx, drainedContract: victim,
      asset: { symbol: transfer.symbol, approxUsd: Math.round(transfer.usd) },
      balanceRemovedShare: Number(drain.removedShare.toFixed(4)),
      exposure: exposure.quantified ? { drainedUsd: Math.round(exposure.drainedUsd) } : { measured: false },
      investigator: ai ? { exploitClass: ai.exploitClass, mechanism: ai.mechanism, lossBearer: ai.lossBearer, veto: ai.veto } : null,
      candidates: candidates.map((c, i) => ({ index: i, kind: c.kind, protocol: c.protocol, instrument: c.instrument, lossUsd: Math.round(c.lossUsd ?? 0),
        marketCapUsd: c.marketCapUsd, modeledDeltaPct: c.modeledDeltaPct, marketDeltaPct: c.marketDeltaPct, sizeable: Boolean(c.sizing?.computable), demoListed: c.demoListed })),
      note: candidates.length ? undefined : "No listed instrument maps to this contract, so there is nothing to trade.",
    })
  } catch (error) { decisionError = String(error.message ?? error) }
  const final = precheck
    ? { decision: candidates.length ? "NO_TRADE" : "MONITOR", chosen: null, side: null, proposed: null, refusals: [precheck] }
    : enforce(decisionAi, candidates)
  const decision = final.decision

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
    policyDecision, aiDecision: decisionAi, aiDecisionError: decisionError, refusals: final.refusals, proposed: final.proposed,
    agent: final.chosen
      ? { decision, gatePassed: true, decidedBy: "claude", instrument: final.chosen.instrument, side: "SHORT", kind: "DIRECT", sizing: final.chosen.sizing }
      : { decision, gatePassed: false, decidedBy: decisionAi ? "claude" : "none", refusals: final.refusals },
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

  for (const chainId of Object.keys(WATCHED)) {
    const chain = chainConfig(chainId)
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
      const failedRanges = []
      while (start <= to && failures < 6) {
        const end = Math.min(start + step - 1, to)
        try {
          transfers.push(...await watchedTransfers({ url: chain.rpc, tokens: chain.tokens, fromBlock: start, toBlock: end, ethUsd, fallbacks: chain.fallbacks ?? [] }))
          start = end + 1
        } catch (error) {
          const msg = String(error.message ?? error)
          if (/too large|exceeds limit|range|limited/i.test(msg) && step > 12) { step = Math.floor(step / 2); continue }
          failures += 1
          failedRanges.push({ from: start, to: end, error: msg.slice(0, 160) })
          report.chains[chainId] = { lastError: `${start}-${end}: ${msg.slice(0, 110)}` }
          // Do not step over an unread range. The next scheduled pass must retry it.
          break
        }
      }

      // A contract that empties itself more than once in a pass is being refilled: a forwarder.
      const recurring = recurringSenders(transfers)
      const restingBlocks = Math.ceil((RESTING_MINUTES * 60) / chain.blockSeconds)
      // One candidate per contract: the largest outflow represents it.
      const bySender = new Map()
      for (const t of transfers.sort((a, b) => b.usd - a.usd)) if (!recurring.has(t.from) && !bySender.has(t.from)) bySender.set(t.from, t)

      // Public nodes throttle aggressively, so candidates are confirmed slowly and in order of size.
      const confirmed = []
      let rejected = 0
      const confirmationErrors = []
      for (const t of [...bySender.values()].slice(0, 14)) {
        try {
          const drain = await confirmDrain({ url: chain.rpc, transfer: t, fallbacks: chain.fallbacks ?? [], restingBlocks })
          if (!drain.candidate) rejected += 1
          if (drain.candidate) confirmed.push({ transfer: t, drain })
        } catch (error) {
          const message = String(error.message ?? error).slice(0, 160)
          confirmationErrors.push({ tx: t.tx, block: t.block, error: message })
          report.chains[chainId] = { ...(report.chains[chainId] ?? {}), lastError: message }
        }
        await sleep(chain.blockSeconds < 1 ? 250 : 400)
      }
      for (const c of confirmed) {
        const record = await investigate({ chainId, chain, ...c })
        if (record) report.opened.push({ id: record.id, decision: record.decision, usd: record.detection.approxUsd, protocol: record.protocol?.name ?? null })
      }

      const logCoverageComplete = failedRanges.length === 0 && start > to
      // Historical balance errors do not invalidate the log scan, but they do invalidate a claim
      // that the event evidence is complete. Keep the distinction visible in both state and UI.
      const evidenceComplete = logCoverageComplete && confirmationErrors.length === 0
      const scannedTo = evidenceComplete ? to : Math.max(from - 1, start - 1)
      state.chains[chainId] = { lastBlock: scannedTo, scannedAt: now(), logCoverageComplete, evidenceComplete,
        failedRanges, confirmationErrors }
      report.chains[chainId] = { ...(report.chains[chainId] ?? {}), name: chain.name, from, to, blocks: to - from + 1, skipped,
        largeTransfers: transfers.length, recurringSenders: recurring.size, rejectedCandidates: rejected, drains: confirmed.length,
        logCoverageComplete, evidenceComplete, failedRanges, confirmationErrors }
    } catch (error) {
      report.chains[chainId] = { name: chain.name, error: String(error.message ?? error).slice(0, 160) }
    }
  }

  state.lastRun = report
  writeFileSync(STATE, JSON.stringify(state, null, 2) + "\n")

  writeLiveSummary(OUT, { minUsd: MIN_DRAIN_USD, chains: report.chains, scanned: state.chains })
  appendHashLog(LOG, { event: "SCAN", chains: Object.fromEntries(Object.entries(report.chains).map(([k, v]) => [v.name ?? k, v.error ? "error" : `${v.blocks} blocks, ${v.largeTransfers} large transfers, ${v.drains} drains`])), opened: report.opened.length })
  console.log(JSON.stringify({ minUsd: MIN_DRAIN_USD, ...report }, null, 2))
}

main().catch((error) => { console.error(error); process.exit(1) })
