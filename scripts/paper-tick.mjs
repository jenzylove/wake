#!/usr/bin/env node
// WAKE paper engine tick.
//
// Runs on a schedule, marks the book to market, applies exits, scans for new
// dislocations, and appends to an append only log that is committed to the repo.
// The commit history is the proof that the log was produced live rather than
// generated after the fact.

import { TAKER_FEE_RATE, fundingAccrual, halfSpreadRate, impactRate } from "./paper/cost-model.mjs"
import { CONFIG, evaluate, isEligible } from "./paper/strategy.mjs"
import { appendJsonl, loadState, readJsonl, saveState, writeJson, STARTING_EQUITY_USD } from "./paper/ledger.mjs"
import { computeMetrics } from "./paper/metrics.mjs"

const TICKERS_URL = "https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES"
const DECISION_RELOG_MS = 6 * 60 * 60 * 1000

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null }

async function fetchTickers() {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  try {
    const response = await fetch(TICKERS_URL, { signal: controller.signal, headers: { "Content-Type": "application/json", locale: "en-US" } })
    const payload = await response.json()
    if (!response.ok || payload.code !== "00000") throw new Error(`Bitget tickers failed: ${payload.msg || response.statusText}`)
    return payload.data
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Price we actually get when crossing, including impact beyond the touch.
 * Returns the fill plus the slippage against mid so both can be reported.
 */
function effectiveFill({ side, action, bid, ask, size, restingSize = null }) {
  const mid = (bid + ask) / 2
  const crossesAsk = (side === "LONG" && action === "OPEN") || (side === "SHORT" && action === "CLOSE")
  const touch = crossesAsk ? ask : bid
  const spread = halfSpreadRate(bid, ask) ?? 0
  const notionalUsd = size * touch
  const extra = impactRate({ notionalUsd, restingSize, price: touch, spreadRate: spread }) - spread
  const adverse = Math.max(0, extra)
  const fill = crossesAsk ? touch * (1 + adverse) : touch * (1 - adverse)
  return { fill, mid, slippageUsd: Math.abs(fill - mid) * size }
}

function closePosition({ position, row, now, exitReason }) {
  const bid = num(row?.bidPr)
  const ask = num(row?.askPr)
  const mark = num(row?.markPrice) ?? position.lastMarkPrice
  const usable = bid !== null && ask !== null && ask >= bid
  const exit = usable
    ? effectiveFill({ side: position.side, action: "CLOSE", bid, ask, size: position.size })
    : { fill: mark, mid: mark, slippageUsd: 0 }

  const gross = position.side === "LONG"
    ? (exit.fill - position.entryPrice) * position.size
    : (position.entryPrice - exit.fill) * position.size

  const exitNotional = exit.fill * position.size
  const exitFee = exitNotional * TAKER_FEE_RATE
  const feesUsd = position.entryFeeUsd + exitFee
  const slippageUsd = position.entrySlippageUsd + exit.slippageUsd
  const fundingUsd = position.fundingUsd
  const realizedPnlUsd = gross - feesUsd + fundingUsd

  return {
    ...position,
    status: "CLOSED",
    closedAt: new Date(now).toISOString(),
    exitPrice: exit.fill,
    exitMidPrice: exit.mid,
    exitReason,
    grossPnlUsd: Number(gross.toFixed(4)),
    feesUsd: Number(feesUsd.toFixed(4)),
    slippageUsd: Number(slippageUsd.toFixed(4)),
    fundingUsd: Number(fundingUsd.toFixed(4)),
    realizedPnlUsd: Number(realizedPnlUsd.toFixed(4)),
    returnOnNotionalRate: position.notionalUsd > 0 ? realizedPnlUsd / position.notionalUsd : 0,
  }
}

async function main() {
  const now = Date.now()
  const nowIso = new Date(now).toISOString()
  const rows = await fetchTickers()
  const bySymbol = new Map(rows.map((r) => [r.symbol, r]))

  const state = loadState()
  if (!state.startedAt) state.startedAt = nowIso
  state.tickCount = (state.tickCount ?? 0) + 1

  // 1. Mark to market and accrue funding on open positions.
  const stillOpen = []
  const closedThisTick = []
  for (const position of state.openPositions) {
    const row = bySymbol.get(position.symbol)
    const mark = num(row?.markPrice) ?? position.lastMarkPrice
    const index = num(row?.indexPrice)
    const funding = num(row?.fundingRate) ?? 0
    const elapsedMs = now - (position.lastTickAt ? new Date(position.lastTickAt).getTime() : new Date(position.openedAt).getTime())

    position.fundingUsd = (position.fundingUsd ?? 0) + fundingAccrual({
      side: position.side,
      fundingRate: funding,
      notionalUsd: position.notionalUsd,
      elapsedMs,
    })
    position.lastMarkPrice = mark
    position.lastTickAt = nowIso
    position.currentBasisRate = index && index > 0 ? (mark - index) / index : position.currentBasisRate

    const unrealized = position.side === "LONG"
      ? (mark - position.entryPrice) * position.size
      : (position.entryPrice - mark) * position.size
    position.unrealizedPnlUsd = Number(unrealized.toFixed(4))

    // 2. Exit rules, checked in priority order.
    const heldMs = now - new Date(position.openedAt).getTime()
    const stopHit = position.side === "LONG" ? mark <= position.stopPrice : mark >= position.stopPrice
    const reverted = Math.abs(position.currentBasisRate ?? 0) <= Math.abs(position.entryBasisRate) * CONFIG.takeProfitFraction

    let exitReason = null
    if (stopHit) exitReason = "STOP"
    else if (reverted) exitReason = "TAKE_PROFIT"
    else if (heldMs >= CONFIG.maxHoldMs) exitReason = "MAX_HOLD"
    else if (!row) exitReason = "INSTRUMENT_UNAVAILABLE"

    if (exitReason) {
      const closed = closePosition({ position, row, now, exitReason })
      closedThisTick.push(closed)
      appendJsonl("trades.jsonl", closed)
      state.realizedPnlUsd = Number(((state.realizedPnlUsd ?? 0) + closed.realizedPnlUsd).toFixed(4))
    } else {
      stillOpen.push(position)
    }
  }
  state.openPositions = stillOpen

  // 3. Scan for new candidates.
  const eligible = rows.filter(isEligible).filter((r) => (num(r.usdtVolume) ?? 0) >= CONFIG.minUsdtVolume24h)
  const openSymbols = new Set(state.openPositions.map((p) => p.symbol))
  const scan = { evaluated: eligible.length, triggered: 0, opened: 0, abstained: 0, reasons: {} }
  const lastLogged = state.lastLogged ?? {}

  for (const row of eligible) {
    const verdict = evaluate(row, {
      equityUsd: state.equityUsd,
      openSymbols,
      openCount: state.openPositions.length,
      now,
    })

    const hadDislocation = verdict.reason !== "no dislocation above trigger" && verdict.reason !== "ineligible instrument or incomplete book"
    if (hadDislocation) scan.triggered += 1

    if (verdict.decision === "NO_TRADE") {
      scan.abstained += 1
      scan.reasons[verdict.reason] = (scan.reasons[verdict.reason] ?? 0) + 1
      // Log a dislocated abstention, deduped so a symbol sitting wide all day
      // does not write the same row every ten minutes.
      if (hadDislocation) {
        const key = `${verdict.symbol}:${verdict.reason}`
        const last = lastLogged[key] ? new Date(lastLogged[key]).getTime() : 0
        if (now - last > DECISION_RELOG_MS) {
          appendJsonl("decisions.jsonl", verdict)
          lastLogged[key] = nowIso
        }
      }
      continue
    }

    // 4. Open the position.
    const bid = num(row.bidPr)
    const ask = num(row.askPr)
    const restingSize = verdict.side === "SHORT" ? num(row.bidSz) : num(row.askSz)
    const entry = effectiveFill({ side: verdict.side, action: "OPEN", bid, ask, size: verdict.order.size, restingSize })
    const notionalUsd = entry.fill * verdict.order.size
    const entryFeeUsd = notionalUsd * TAKER_FEE_RATE

    const position = {
      id: `wake-p2-${verdict.symbol.toLowerCase()}-${new Date(now).toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}`,
      tier: 2,
      strategy: "basis-funding-dislocation",
      symbol: verdict.symbol,
      side: verdict.side,
      status: "OPEN",
      openedAt: nowIso,
      entryPrice: entry.fill,
      entryMidPrice: entry.mid,
      size: verdict.order.size,
      notionalUsd: Number(notionalUsd.toFixed(4)),
      stopPrice: verdict.order.stopPrice,
      maxLossUsd: Number(verdict.order.maxLossUsd.toFixed(2)),
      entryBasisRate: verdict.order.entryBasisRate,
      currentBasisRate: verdict.order.entryBasisRate,
      entryFundingRate: verdict.observed.fundingRate,
      modeledRate: verdict.model.modeledRate,
      residualRate: verdict.model.residualRate,
      entryFeeUsd: Number(entryFeeUsd.toFixed(4)),
      entrySlippageUsd: Number(entry.slippageUsd.toFixed(4)),
      fundingUsd: 0,
      unrealizedPnlUsd: 0,
      lastMarkPrice: num(row.markPrice),
      lastTickAt: nowIso,
      evidence: { observed: verdict.observed, model: verdict.model, checks: verdict.checks },
    }

    state.openPositions.push(position)
    openSymbols.add(verdict.symbol)
    appendJsonl("trades.jsonl", position)
    appendJsonl("decisions.jsonl", verdict)
    lastLogged[`${verdict.symbol}:opened`] = nowIso
    scan.opened += 1
  }
  state.lastLogged = lastLogged

  // 5. Equity mark. Realized plus open mark to market.
  const openUnrealized = state.openPositions.reduce((s, p) => s + (p.unrealizedPnlUsd ?? 0) + (p.fundingUsd ?? 0) - p.entryFeeUsd, 0)
  const equityUsd = STARTING_EQUITY_USD + (state.realizedPnlUsd ?? 0) + openUnrealized
  state.equityUsd = Number(equityUsd.toFixed(4))

  appendJsonl("equity.jsonl", {
    at: nowIso,
    equityUsd: state.equityUsd,
    realizedPnlUsd: state.realizedPnlUsd ?? 0,
    openUnrealizedUsd: Number(openUnrealized.toFixed(4)),
    openPositions: state.openPositions.length,
    scan,
  })

  // 6. Recompute metrics from the log.
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
    config: CONFIG,
    universeSize: eligible.length,
    lastScan: scan,
  }
  writeJson("metrics.json", metrics)
  saveState(state)

  console.log(`[wake-paper] ${nowIso} tick=${state.tickCount} universe=${eligible.length} triggered=${scan.triggered} opened=${scan.opened} closed=${closedThisTick.length} open=${state.openPositions.length} equity=$${state.equityUsd.toFixed(2)}`)
  for (const c of closedThisTick) {
    console.log(`  CLOSE ${c.symbol} ${c.side} ${c.exitReason} pnl=$${c.realizedPnlUsd.toFixed(2)}`)
  }
}

main().catch((error) => {
  console.error("[wake-paper] tick failed:", error.message)
  process.exit(1)
})
