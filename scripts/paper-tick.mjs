#!/usr/bin/env node
// WAKE paper engine tick · delta neutral basis arbitrage.
//
// Fetches both the perpetual and spot books, marks open pairs to market, applies
// exits, scans for new dislocations, and commits an append only log. The commit
// history is the proof the log was produced live rather than assembled after.
//
// A position here is a pair: short the perpetual, long spot, equal notional. A
// move in the underlying nets out between the legs, so what the position earns
// is the gap closing, plus funding received while short.

import { TAKER_FEE_RATE, fundingAccrual } from "./paper/cost-model.mjs"
import { CONFIG, OPENING_ENABLED, evaluate, isEligible } from "./paper/strategy.mjs"
import { appendJsonl, loadState, readJsonl, saveState, writeJson, STARTING_EQUITY_USD } from "./paper/ledger.mjs"
import { computeMetrics } from "./paper/metrics.mjs"

const PERP_URL = "https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES"
const SPOT_URL = "https://api.bitget.com/api/v2/spot/market/tickers"
const DECISION_RELOG_MS = 6 * 60 * 60 * 1000

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null }

async function fetchJson(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { "Content-Type": "application/json", locale: "en-US" } })
    const payload = await response.json()
    if (!response.ok || payload.code !== "00000") throw new Error(`Bitget request failed: ${payload.msg || response.statusText}`)
    return payload.data
  } finally {
    clearTimeout(timer)
  }
}

/** Mark both legs and return the pair's unrealised result. */
function markPair(position, perp, spot) {
  const perpMid = perp ? (num(perp.bidPr) + num(perp.askPr)) / 2 : position.legs.perp.lastPrice
  const spotMid = spot ? (num(spot.bidPr) + num(spot.askPr)) / 2 : position.legs.spot.lastPrice

  // Short perpetual gains when the perpetual falls; long spot gains when spot rises.
  const perpPnl = (position.legs.perp.entryPrice - perpMid) * position.legs.perp.size
  const spotPnl = (spotMid - position.legs.spot.entryPrice) * position.legs.spot.size
  const gapRate = spotMid > 0 ? (perpMid - spotMid) / spotMid : position.currentGapRate

  return { perpMid, spotMid, perpPnl, spotPnl, grossPnl: perpPnl + spotPnl, gapRate }
}

function closePair({ position, perp, spot, now, exitReason }) {
  // Buy the perpetual back at its ask, sell spot at its bid. Both cross again.
  const perpExit = perp ? num(perp.askPr) : position.legs.perp.lastPrice
  const spotExit = spot ? num(spot.bidPr) : position.legs.spot.lastPrice

  const perpPnl = (position.legs.perp.entryPrice - perpExit) * position.legs.perp.size
  const spotPnl = (spotExit - position.legs.spot.entryPrice) * position.legs.spot.size

  const perpExitFee = perpExit * position.legs.perp.size * TAKER_FEE_RATE
  const spotExitFee = spotExit * position.legs.spot.size * TAKER_FEE_RATE
  const feesUsd = position.legs.perp.feeUsd + position.legs.spot.feeUsd + perpExitFee + spotExitFee

  const grossPnlUsd = perpPnl + spotPnl
  const realizedPnlUsd = grossPnlUsd - feesUsd + (position.fundingUsd ?? 0)

  return {
    ...position,
    status: "CLOSED",
    closedAt: new Date(now).toISOString(),
    exitReason,
    exitGapRate: spotExit > 0 ? (perpExit - spotExit) / spotExit : null,
    legs: {
      perp: { ...position.legs.perp, exitPrice: perpExit, exitFeeUsd: Number(perpExitFee.toFixed(4)), legPnlUsd: Number(perpPnl.toFixed(4)) },
      spot: { ...position.legs.spot, exitPrice: spotExit, exitFeeUsd: Number(spotExitFee.toFixed(4)), legPnlUsd: Number(spotPnl.toFixed(4)) },
    },
    grossPnlUsd: Number(grossPnlUsd.toFixed(4)),
    feesUsd: Number(feesUsd.toFixed(4)),
    slippageUsd: Number((position.entrySlippageUsd ?? 0).toFixed(4)),
    fundingUsd: Number((position.fundingUsd ?? 0).toFixed(4)),
    realizedPnlUsd: Number(realizedPnlUsd.toFixed(4)),
    returnOnNotionalRate: position.notionalUsd > 0 ? realizedPnlUsd / position.notionalUsd : 0,
  }
}

async function main() {
  const now = Date.now()
  const nowIso = new Date(now).toISOString()

  const [perpRows, spotRows] = await Promise.all([fetchJson(PERP_URL), fetchJson(SPOT_URL)])
  const perpBy = new Map(perpRows.map((r) => [r.symbol, r]))
  const spotBy = new Map(spotRows.map((r) => [r.symbol, r]))

  const state = loadState()
  if (!state.startedAt) state.startedAt = nowIso
  state.tickCount = (state.tickCount ?? 0) + 1

  // 1. Mark open pairs and apply exits.
  const stillOpen = []
  const closedThisTick = []
  for (const position of state.openPositions) {
    // Single leg positions from the retired strategy are closed on sight rather
    // than carried under rules that no longer describe them.
    if (!position.legs) {
      const row = perpBy.get(position.symbol)
      const mark = num(row?.markPrice) ?? position.lastMarkPrice
      const gross = position.side === "LONG"
        ? (mark - position.entryPrice) * position.size
        : (position.entryPrice - mark) * position.size
      const exitFee = mark * position.size * TAKER_FEE_RATE
      const closed = {
        ...position,
        status: "CLOSED",
        closedAt: nowIso,
        exitPrice: mark,
        exitReason: "STRATEGY_RETIRED",
        grossPnlUsd: Number(gross.toFixed(4)),
        feesUsd: Number(((position.entryFeeUsd ?? 0) + exitFee).toFixed(4)),
        fundingUsd: Number((position.fundingUsd ?? 0).toFixed(4)),
        realizedPnlUsd: Number((gross - (position.entryFeeUsd ?? 0) - exitFee + (position.fundingUsd ?? 0)).toFixed(4)),
      }
      closedThisTick.push(closed)
      appendJsonl("trades.jsonl", closed)
      state.realizedPnlUsd = Number(((state.realizedPnlUsd ?? 0) + closed.realizedPnlUsd).toFixed(4))
      continue
    }

    const perp = perpBy.get(position.symbol)
    const spot = spotBy.get(position.symbol)
    const marked = markPair(position, perp, spot)

    const funding = num(perp?.fundingRate) ?? 0
    const elapsedMs = now - new Date(position.lastTickAt ?? position.openedAt).getTime()
    // Short the perpetual, so positive funding is received.
    position.fundingUsd = (position.fundingUsd ?? 0) + fundingAccrual({
      side: "SHORT", fundingRate: funding, notionalUsd: position.notionalUsd, elapsedMs,
    })

    position.legs.perp.lastPrice = marked.perpMid
    position.legs.spot.lastPrice = marked.spotMid
    position.legs.perp.unrealizedPnlUsd = Number(marked.perpPnl.toFixed(4))
    position.legs.spot.unrealizedPnlUsd = Number(marked.spotPnl.toFixed(4))
    position.currentGapRate = marked.gapRate
    position.unrealizedPnlUsd = Number(marked.grossPnl.toFixed(4))
    position.lastTickAt = nowIso

    const heldMs = now - new Date(position.openedAt).getTime()
    const converged = marked.gapRate <= position.targetGapRate
    const diverged = marked.gapRate >= position.divergenceStopGapRate

    let exitReason = null
    if (diverged) exitReason = "DIVERGENCE_STOP"
    else if (converged) exitReason = "TAKE_PROFIT"
    else if (heldMs >= CONFIG.maxHoldMs) exitReason = "MAX_HOLD"
    else if (!perp || !spot) exitReason = "LEG_UNAVAILABLE"

    if (exitReason) {
      const closed = closePair({ position, perp, spot, now, exitReason })
      closedThisTick.push(closed)
      appendJsonl("trades.jsonl", closed)
      state.realizedPnlUsd = Number(((state.realizedPnlUsd ?? 0) + closed.realizedPnlUsd).toFixed(4))
      if (exitReason === "DIVERGENCE_STOP") {
        state.cooldownUntil = { ...(state.cooldownUntil ?? {}), [position.symbol]: now + CONFIG.stopCooldownMs }
      }
    } else {
      stillOpen.push(position)
    }
  }
  state.openPositions = stillOpen

  // 2. Scan. Only symbols listed on both venues are candidates at all. This one
  // filter is what removes the instruments the retired strategy lost on.
  const candidates = perpRows
    .map((perp) => ({ perp, spot: spotBy.get(perp.symbol) }))
    .filter(({ perp, spot }) => isEligible(perp, spot))
    .filter(({ perp, spot }) => (num(perp.usdtVolume) ?? 0) >= CONFIG.minPerpUsdtVolume24h && (num(spot.usdtVolume) ?? 0) >= CONFIG.minSpotUsdtVolume24h)

  const openSymbols = new Set(state.openPositions.map((p) => p.symbol))
  const scan = {
    perpsScanned: perpRows.length,
    spotSymbols: spotRows.length,
    pairsWithBothLegs: candidates.length,
    evaluated: candidates.length,
    triggered: 0, opened: 0, abstained: 0, reasons: {},
    openingEnabled: OPENING_ENABLED,
    // Edge against cost across the whole scanned universe. This is the
    // quantitative output of the gate on the ticks where it opens nothing.
    edgeBps: { best: null, median: null, worst: null, hedgeable: 0, clearedCost: 0 },
  }
  const edgeSamples = []
  const lastLogged = state.lastLogged ?? {}

  for (const pair of candidates) {
    const verdict = evaluate(pair, {
      equityUsd: state.equityUsd,
      openSymbols,
      openCount: state.openPositions.length,
      now,
      cooldownUntil: state.cooldownUntil ?? {},
    })

    if (verdict.model) {
      edgeSamples.push(verdict.model.netEdgeRate * 1e4)
      if (verdict.observed.gapRate > 0) scan.edgeBps.hedgeable += 1
      if (verdict.model.netEdgeRate >= CONFIG.minNetEdgeRate) scan.edgeBps.clearedCost += 1
    }

    const hadGap = verdict.reason !== "gap below trigger" && verdict.reason !== "no tradeable spot leg or incomplete book"
    if (hadGap) scan.triggered += 1

    if (verdict.decision === "NO_TRADE") {
      scan.abstained += 1
      scan.reasons[verdict.reason] = (scan.reasons[verdict.reason] ?? 0) + 1
      if (hadGap) {
        const key = `${verdict.symbol}:${verdict.reason}`
        const last = lastLogged[key] ? new Date(lastLogged[key]).getTime() : 0
        if (now - last > DECISION_RELOG_MS) {
          appendJsonl("decisions.jsonl", verdict)
          lastLogged[key] = nowIso
        }
      }
      continue
    }

    const order = verdict.order
    const position = {
      id: `wake-arb-${verdict.symbol.toLowerCase()}-${nowIso.replace(/[-:TZ.]/g, "").slice(0, 14)}`,
      tier: 2,
      strategy: "delta-neutral-basis",
      symbol: verdict.symbol,
      status: "OPEN",
      openedAt: nowIso,
      notionalUsd: Number(order.notionalUsd.toFixed(4)),
      entryGapRate: order.entryGapRate,
      currentGapRate: order.entryGapRate,
      targetGapRate: order.targetGapRate,
      divergenceStopGapRate: order.divergenceStopGapRate,
      maxLossUsd: Number(order.maxLossUsd.toFixed(2)),
      legs: {
        perp: { ...order.legs.perp, lastPrice: order.legs.perp.entryPrice, unrealizedPnlUsd: 0 },
        spot: { ...order.legs.spot, lastPrice: order.legs.spot.entryPrice, unrealizedPnlUsd: 0 },
      },
      entrySlippageUsd: Number((order.notionalUsd * (verdict.observed.perpSpreadRate + verdict.observed.spotSpreadRate) / 2).toFixed(4)),
      fundingUsd: 0,
      unrealizedPnlUsd: 0,
      lastTickAt: nowIso,
      evidence: { observed: verdict.observed, model: verdict.model, checks: verdict.checks },
    }

    state.openPositions.push(position)
    openSymbols.add(verdict.symbol)
    appendJsonl("trades.jsonl", position)
    appendJsonl("decisions.jsonl", verdict)
    scan.opened += 1
  }
  state.lastLogged = lastLogged

  if (edgeSamples.length) {
    const sorted = [...edgeSamples].sort((a, b) => a - b)
    scan.edgeBps.best = Number(sorted[sorted.length - 1].toFixed(2))
    scan.edgeBps.median = Number(sorted[Math.floor(sorted.length / 2)].toFixed(2))
    scan.edgeBps.worst = Number(sorted[0].toFixed(2))
    scan.edgeBps.sampled = sorted.length
  }

  // 3. Equity.
  const openUnrealized = state.openPositions.reduce(
    (sum, p) => sum + (p.unrealizedPnlUsd ?? 0) + (p.fundingUsd ?? 0) - (p.legs ? p.legs.perp.feeUsd + p.legs.spot.feeUsd : 0),
    0,
  )
  state.equityUsd = Number((STARTING_EQUITY_USD + (state.realizedPnlUsd ?? 0) + openUnrealized).toFixed(4))

  appendJsonl("equity.jsonl", {
    at: nowIso,
    equityUsd: state.equityUsd,
    realizedPnlUsd: state.realizedPnlUsd ?? 0,
    openUnrealizedUsd: Number(openUnrealized.toFixed(4)),
    openPositions: state.openPositions.length,
    scan,
  })

  // 4. Metrics, recomputed from the log.
  const trades = readJsonl("trades.jsonl")
  const latestByPosition = new Map()
  for (const record of trades) latestByPosition.set(record.id, record)
  const metrics = computeMetrics({
    equityCurve: readJsonl("equity.jsonl"),
    trades: [...latestByPosition.values()],
    startingEquityUsd: STARTING_EQUITY_USD,
  })
  metrics.engine = {
    tickCount: state.tickCount,
    startedAt: state.startedAt,
    lastTickAt: nowIso,
    strategy: "delta-neutral-basis",
    config: CONFIG,
    universeSize: candidates.length,
    lastScan: scan,
  }
  writeJson("metrics.json", metrics)
  saveState(state)

  console.log(`[wake-paper] ${nowIso} tick=${state.tickCount} perps=${scan.perpsScanned} pairs=${scan.pairsWithBothLegs} hedgeable=${scan.edgeBps.hedgeable} bestEdge=${scan.edgeBps.best ?? "n/a"}bps cleared=${scan.edgeBps.clearedCost} opened=${scan.opened} closed=${closedThisTick.length} open=${state.openPositions.length} equity=$${state.equityUsd.toFixed(2)}`)
  for (const c of closedThisTick) {
    console.log(`  CLOSE ${c.symbol} ${c.exitReason} pnl=$${c.realizedPnlUsd.toFixed(2)}`)
  }
}

main().catch((error) => {
  console.error("[wake-paper] tick failed:", error.message)
  process.exit(1)
})
