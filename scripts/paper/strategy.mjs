import { roundTripCostRate } from "./cost-model.mjs"

// WAKE tier 2: perpetual basis and funding dislocation.
//
// Tier 1 is the causal incident path and is unchanged. Tier 2 exists because a
// causal incident of the size WAKE cares about is rare, and a paper log with one
// trade cannot produce a Sharpe. It is a different claim and is labelled as one:
// this is a microstructure dislocation trade, not a contagion thesis.
//
// The economic claim is narrow and checkable. A perpetual whose mark has pulled
// away from its own index is quoting a carry that the funding mechanism is built
// to close. We fade that gap, we size against a bounded stop, and we only take it
// when the modelled reversion clears the observed round trip cost.
//
// Every number below is computed from the observed ticker. None are literals.

export const CONFIG = {
  // Calibrated 2026-09-15 against a live Bitget ticker snapshot of 787 perps.
  // A $10M 24h floor leaves 52 instruments with a real book. Round trip taker
  // cost is ~12 bps of fee plus the full observed spread, so a basis trade only
  // clears cost above roughly 25 bps of dislocation. The triggers below are set
  // at that economic break even rather than at a level that manufactures trades.
  minUsdtVolume24h: Number(process.env.WAKE_MIN_VOLUME ?? 10_000_000),
  maxSpreadRate: Number(process.env.WAKE_MAX_SPREAD ?? 0.0020),
  basisTriggerRate: Number(process.env.WAKE_BASIS_TRIGGER ?? 0.0025),
  fundingTriggerRate: Number(process.env.WAKE_FUNDING_TRIGGER ?? 0.0010),
  reversionFraction: Number(process.env.WAKE_REVERSION_FRACTION ?? 0.6),
  targetHoldMs: Number(process.env.WAKE_TARGET_HOLD_MS ?? 8 * 60 * 60 * 1000),
  minResidualRate: Number(process.env.WAKE_MIN_RESIDUAL ?? 0.0005),
  riskPerTradeRate: Number(process.env.WAKE_RISK_PER_TRADE ?? 0.005),
  // Stop floor. The effective stop is scaled off the dislocation being faded,
  // because a stop narrower than the gap you are fading gets taken out by noise
  // in that same gap before the thesis can resolve. See stopRateFor().
  stopRate: Number(process.env.WAKE_STOP_RATE ?? 0.012),
  stopBasisMultiple: Number(process.env.WAKE_STOP_BASIS_MULTIPLE ?? 2.0),
  /** Minutes to stand down on a symbol after being stopped out of it. */
  stopCooldownMs: Number(process.env.WAKE_STOP_COOLDOWN_MS ?? 4 * 60 * 60 * 1000),
  maxConcurrent: Number(process.env.WAKE_MAX_CONCURRENT ?? 6),
  maxHoldMs: Number(process.env.WAKE_MAX_HOLD_MS ?? 24 * 60 * 60 * 1000),
  takeProfitFraction: Number(process.env.WAKE_TAKE_PROFIT_FRACTION ?? 0.25),
  // A paper clip that would be an implausible share of real daily turnover is
  // not a trade, it is a backtest artifact. Hard cap it rather than trusting the
  // impact term to price it honestly.
  maxNotionalShareOfVolume: Number(process.env.WAKE_MAX_VOLUME_SHARE ?? 0.002),
}

/**
 * Give the trade room proportional to the move it is fading, never less than the
 * floor. Position size is derived from this, so a wider stop automatically means
 * a smaller clip and identical risk per trade.
 */
export function stopRateFor(basisRate) {
  return Math.max(CONFIG.stopRate, Math.abs(basisRate) * CONFIG.stopBasisMultiple)
}

const num = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** Perpetuals only, with a live two sided book and a real index. */
export function isEligible(row) {
  if (row.deliveryStatus) return false
  if (row.deliveryTime) return false
  const mark = num(row.markPrice)
  const index = num(row.indexPrice)
  const bid = num(row.bidPr)
  const ask = num(row.askPr)
  const volume = num(row.usdtVolume)
  if (mark === null || index === null || bid === null || ask === null || volume === null) return false
  if (mark <= 0 || index <= 0 || bid <= 0 || ask <= 0 || ask < bid) return false
  return true
}

/**
 * Reads one ticker row into a decision. Returns the full reasoning either way so
 * that an abstention is logged with the same detail as a fill.
 */
export function evaluate(row, { equityUsd, openSymbols, openCount, now, cooldownUntil = {} }) {
  const symbol = row.symbol
  const base = { symbol, at: new Date(now).toISOString(), tier: 2 }
  const coolingDown = Number(cooldownUntil[symbol] ?? 0) > now

  if (!isEligible(row)) {
    return { ...base, decision: "NO_TRADE", reason: "ineligible instrument or incomplete book", checks: [] }
  }

  const mark = num(row.markPrice)
  const index = num(row.indexPrice)
  const bid = num(row.bidPr)
  const ask = num(row.askPr)
  const volume = num(row.usdtVolume)
  const funding = num(row.fundingRate) ?? 0

  // OBSERVED: the dislocation itself.
  const basis = (mark - index) / index
  const fundingTriggered = Math.abs(funding) >= CONFIG.fundingTriggerRate
  const basisTriggered = Math.abs(basis) >= CONFIG.basisTriggerRate

  if (!basisTriggered && !fundingTriggered) {
    return {
      ...base,
      decision: "NO_TRADE",
      reason: "no dislocation above trigger",
      observed: { basisRate: basis, fundingRate: funding, usdtVolume24h: volume },
      checks: [],
    }
  }

  // Fade the dislocation. Basis leads when present; funding is the tiebreak.
  const signalRate = basisTriggered ? basis : funding
  const side = signalRate > 0 ? "SHORT" : "LONG"

  // COMPUTED consequence model. Expected move is the share of the basis we
  // expect the funding mechanism to close over the target hold, plus the funding
  // carry earned by holding the receiving side across that window.
  const expectedReversionRate = Math.abs(basis) * CONFIG.reversionFraction
  const fundingIntervals = CONFIG.targetHoldMs / (8 * 60 * 60 * 1000)
  const expectedFundingRate = Math.max(0, (side === "SHORT" ? funding : -funding)) * fundingIntervals
  const modeledRate = expectedReversionRate + expectedFundingRate

  const stopRate = stopRateFor(basis)
  const notionalUsd = (equityUsd * CONFIG.riskPerTradeRate) / stopRate
  const restingSize = side === "SHORT" ? num(row.bidSz) : num(row.askSz)
  const cost = roundTripCostRate({ bidPr: bid, askPr: ask, notionalUsd, restingSize, price: mark })
  if (!cost) {
    return { ...base, decision: "NO_TRADE", reason: "could not price execution cost", checks: [] }
  }

  const residualRate = modeledRate - cost.total
  const spreadRate = cost.spreadRate * 2

  const checks = [
    { key: "liquidity", label: "24h quote volume", passed: volume >= CONFIG.minUsdtVolume24h, value: `$${Math.round(volume).toLocaleString()}`, threshold: `>= $${CONFIG.minUsdtVolume24h.toLocaleString()}` },
    { key: "spread", label: "Quoted spread", passed: spreadRate <= CONFIG.maxSpreadRate, value: `${(spreadRate * 1e4).toFixed(2)} bps`, threshold: `<= ${(CONFIG.maxSpreadRate * 1e4).toFixed(2)} bps` },
    { key: "residual", label: "Residual edge after cost", passed: residualRate >= CONFIG.minResidualRate, value: `${(residualRate * 1e4).toFixed(2)} bps`, threshold: `>= ${(CONFIG.minResidualRate * 1e4).toFixed(2)} bps` },
    { key: "concurrency", label: "Concurrent positions", passed: openCount < CONFIG.maxConcurrent, value: `${openCount}`, threshold: `< ${CONFIG.maxConcurrent}` },
    { key: "duplicate", label: "No open position in symbol", passed: !openSymbols.has(symbol), value: openSymbols.has(symbol) ? "already open" : "none", threshold: "none open" },
    { key: "cooldown", label: "Not in stop cooldown", passed: !coolingDown, value: coolingDown ? "cooling down" : "clear", threshold: `${Math.round(CONFIG.stopCooldownMs / 60000)}m after a stop` },
    { key: "clip-size", label: "Clip vs 24h volume", passed: notionalUsd <= volume * CONFIG.maxNotionalShareOfVolume, value: `${((notionalUsd / volume) * 100).toFixed(3)}%`, threshold: `<= ${(CONFIG.maxNotionalShareOfVolume * 100).toFixed(3)}%` },
  ]

  const observed = {
    markPrice: mark,
    indexPrice: index,
    basisRate: basis,
    fundingRate: funding,
    usdtVolume24h: volume,
    bidPr: bid,
    askPr: ask,
    spreadRate,
  }
  const model = {
    expectedReversionRate,
    expectedFundingRate,
    modeledRate,
    residualRate,
    cost,
    formula: "modeled = |basis| * reversionFraction + max(0, receivedFunding) * intervals ; residual = modeled - roundTripCost",
    provenance: {
      basis: "OBSERVED · (markPrice - indexPrice) / indexPrice from Bitget public ticker",
      funding: "OBSERVED · fundingRate from Bitget public ticker",
      reversionFraction: "ESTIMATED · assumed share of basis closed over the target hold",
      modeled: "COMPUTED · deterministic function of the two observed rates",
    },
  }

  const passed = checks.every((check) => check.passed)
  if (!passed) {
    return { ...base, decision: "NO_TRADE", reason: checks.filter((c) => !c.passed).map((c) => c.key).join(","), side, observed, model, checks }
  }

  const entryPrice = side === "SHORT" ? bid : ask
  const size = notionalUsd / entryPrice

  return {
    ...base,
    decision: "TRADE_DISLOCATION",
    reason: basisTriggered ? "basis dislocation above trigger" : "funding dislocation above trigger",
    side,
    observed,
    model,
    checks,
    order: {
      symbol,
      side,
      entryPrice,
      size,
      notionalUsd,
      stopPrice: side === "SHORT" ? entryPrice * (1 + stopRate) : entryPrice * (1 - stopRate),
      stopRate,
      targetBasisRate: basis * CONFIG.takeProfitFraction,
      entryBasisRate: basis,
      maxLossUsd: equityUsd * CONFIG.riskPerTradeRate,
      entryCostRate: cost.entry,
    },
  }
}
