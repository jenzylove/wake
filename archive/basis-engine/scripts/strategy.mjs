import { roundTripCostRate, TAKER_FEE_RATE } from "./cost-model.mjs"

// WAKE tier 2 · delta neutral perpetual basis arbitrage.
//
// ---------------------------------------------------------------------------
// Why this replaced the previous strategy
// ---------------------------------------------------------------------------
// v1 faded the gap between a perpetual's mark and its index while holding only
// the perpetual. The live log falsified it in a day: basis converged in 8 of 10
// trades and all 10 still lost money, with $7,444 of the $7,724 loss coming from
// directional price movement and only $432 from fees.
//
// Two root causes, both visible in the log:
//
//   1. One leg cannot express a spread. Convergence happened by the index moving
//      toward the mark, not the mark toward the index, so holding the perpetual
//      earned none of it. Two trades exited on TAKE_PROFIT, meaning the basis
//      reached target, and still lost money.
//
//   2. Adverse selection. A 25 bps trigger selected instruments whose mark and
//      index diverge for structural reasons rather than mispricing. Six of the
//      nine instruments traded have no spot listing at all, and several are
//      tokenised equity perpetuals. When the underlying market is closed the
//      perpetual trades on while the index sits stale, so the apparent basis is
//      the market pricing overnight gap risk. Fading it is selling gap
//      insurance, which is the opposite of an edge.
//
// v2 fixes both. It requires a tradeable spot leg, it trades only the direction
// whose hedge is executable without borrow, and it holds both legs so the
// position earns convergence rather than direction.
//
// The trade: when the perpetual is rich to spot by more than the cost of both
// round trips, sell the perpetual and buy spot in equal notional. The position
// is delta neutral, so it earns the gap closing plus any funding received while
// short, and a move in the underlying nets out.

export const CONFIG = {
  // Both legs must be liquid. The perpetual floor is unchanged; the spot floor
  // exists because a hedge you cannot fill is not a hedge.
  minPerpUsdtVolume24h: Number(process.env.WAKE_MIN_PERP_VOLUME ?? 1_000_000),
  minSpotUsdtVolume24h: Number(process.env.WAKE_MIN_SPOT_VOLUME ?? 100_000),

  // Widest quoted spread we will cross on either leg.
  maxLegSpreadRate: Number(process.env.WAKE_MAX_LEG_SPREAD ?? 0.0025),

  // Minimum gap before we look, and minimum edge left after both round trips.
  minGapRate: Number(process.env.WAKE_MIN_GAP ?? 0.0020),
  minNetEdgeRate: Number(process.env.WAKE_MIN_NET_EDGE ?? 0.0008),

  // Exit when the gap has closed to this fraction of where it started.
  takeProfitFraction: Number(process.env.WAKE_TAKE_PROFIT_FRACTION ?? 0.3),

  // A delta neutral pair has no directional stop. It has a divergence stop: if
  // the gap widens far beyond entry the premise is wrong, so cut it.
  divergenceStopMultiple: Number(process.env.WAKE_DIVERGENCE_STOP ?? 2.5),

  maxHoldMs: Number(process.env.WAKE_MAX_HOLD_MS ?? 48 * 60 * 60 * 1000),
  maxConcurrent: Number(process.env.WAKE_MAX_CONCURRENT ?? 4),

  // Notional per leg, as a share of equity. Delta neutral so this is not
  // directional exposure, but both legs still carry execution and funding risk.
  notionalShareOfEquity: Number(process.env.WAKE_NOTIONAL_SHARE ?? 0.05),
  maxNotionalShareOfVolume: Number(process.env.WAKE_MAX_VOLUME_SHARE ?? 0.002),

  stopCooldownMs: Number(process.env.WAKE_STOP_COOLDOWN_MS ?? 4 * 60 * 60 * 1000),
}

export const OPENING_ENABLED = process.env.WAKE_OPENING_ENABLED !== "false"

const num = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const spreadRate = (bid, ask) => {
  if (!(bid > 0) || !(ask > 0) || ask < bid) return null
  return (ask - bid) / ((ask + bid) / 2)
}

/**
 * A candidate needs a live two sided book on both legs. The spot requirement is
 * the change that matters: it removes every perpetual-only listing, which is
 * where the previous strategy did all of its losing.
 */
export function isEligible(perp, spot) {
  if (!perp || !spot) return false
  if (perp.deliveryStatus || perp.deliveryTime) return false
  const fields = [perp.markPrice, perp.bidPr, perp.askPr, perp.usdtVolume, spot.bidPr, spot.askPr, spot.lastPr, spot.usdtVolume]
  if (fields.some((value) => num(value) === null || num(value) <= 0)) return false
  if (num(perp.askPr) < num(perp.bidPr) || num(spot.askPr) < num(spot.bidPr)) return false
  return true
}

export function evaluate({ perp, spot }, { equityUsd, openSymbols, openCount, now, cooldownUntil = {} }) {
  const symbol = perp?.symbol ?? spot?.symbol ?? "UNKNOWN"
  const base = { symbol, at: new Date(now).toISOString(), tier: 2, strategy: "delta-neutral-basis" }

  if (!isEligible(perp, spot)) {
    return { ...base, decision: "NO_TRADE", reason: "no tradeable spot leg or incomplete book", checks: [] }
  }

  const perpBid = num(perp.bidPr)
  const perpAsk = num(perp.askPr)
  const spotBid = num(spot.bidPr)
  const spotAsk = num(spot.askPr)
  const perpMid = (perpBid + perpAsk) / 2
  const spotMid = (spotBid + spotAsk) / 2
  const funding = num(perp.fundingRate) ?? 0

  // OBSERVED: the gap between two things we can actually trade.
  const gapRate = (perpMid - spotMid) / spotMid

  // We sell the perpetual and buy spot. The opposite direction would need to
  // short spot, which needs borrow we do not model, so it is never taken.
  const executable = gapRate > 0

  if (Math.abs(gapRate) < CONFIG.minGapRate) {
    return {
      ...base,
      decision: "NO_TRADE",
      reason: "gap below trigger",
      observed: { gapRate, fundingRate: funding, perpVolume: num(perp.usdtVolume), spotVolume: num(spot.usdtVolume) },
      checks: [],
    }
  }

  const perpSpread = spreadRate(perpBid, perpAsk) ?? 1
  const spotSpread = spreadRate(spotBid, spotAsk) ?? 1
  const notionalUsd = equityUsd * CONFIG.notionalShareOfEquity

  // Both legs cross, both legs pay taker, on entry and on exit.
  const perpCost = roundTripCostRate({ bidPr: perpBid, askPr: perpAsk, notionalUsd, restingSize: num(perp.bidSz), price: perpMid })
  const spotCost = roundTripCostRate({ bidPr: spotBid, askPr: spotAsk, notionalUsd, restingSize: num(spot.askSz), price: spotMid })
  if (!perpCost || !spotCost) {
    return { ...base, decision: "NO_TRADE", reason: "could not price execution cost on both legs", checks: [] }
  }
  const totalCostRate = perpCost.total + spotCost.total

  // Short perpetual receives funding when funding is positive. It is a bonus,
  // not the thesis, so only a non negative contribution is counted.
  const expectedFundingRate = Math.max(0, funding)
  const modelledRate = Math.abs(gapRate) + expectedFundingRate
  const netEdgeRate = modelledRate - totalCostRate

  const perpVolume = num(perp.usdtVolume)
  const spotVolume = num(spot.usdtVolume)
  const coolingDown = Number(cooldownUntil[symbol] ?? 0) > now

  const checks = [
    { key: "opening-enabled", label: "Strategy opening enabled", passed: OPENING_ENABLED, value: OPENING_ENABLED ? "enabled" : "halted", threshold: "enabled" },
    { key: "hedgeable", label: "Hedge executable without borrow", passed: executable, value: executable ? "short perp / long spot" : "would need spot borrow", threshold: "perp richer than spot" },
    { key: "perp-liquidity", label: "Perp 24h volume", passed: perpVolume >= CONFIG.minPerpUsdtVolume24h, value: `$${Math.round(perpVolume).toLocaleString()}`, threshold: `>= $${CONFIG.minPerpUsdtVolume24h.toLocaleString()}` },
    { key: "spot-liquidity", label: "Spot 24h volume", passed: spotVolume >= CONFIG.minSpotUsdtVolume24h, value: `$${Math.round(spotVolume).toLocaleString()}`, threshold: `>= $${CONFIG.minSpotUsdtVolume24h.toLocaleString()}` },
    { key: "spread", label: "Widest leg spread", passed: Math.max(perpSpread, spotSpread) <= CONFIG.maxLegSpreadRate, value: `${(Math.max(perpSpread, spotSpread) * 1e4).toFixed(1)} bps`, threshold: `<= ${(CONFIG.maxLegSpreadRate * 1e4).toFixed(0)} bps` },
    { key: "net-edge", label: "Edge after both round trips", passed: netEdgeRate >= CONFIG.minNetEdgeRate, value: `${(netEdgeRate * 1e4).toFixed(1)} bps`, threshold: `>= ${(CONFIG.minNetEdgeRate * 1e4).toFixed(0)} bps` },
    { key: "concurrency", label: "Concurrent pairs", passed: openCount < CONFIG.maxConcurrent, value: `${openCount}`, threshold: `< ${CONFIG.maxConcurrent}` },
    { key: "duplicate", label: "No open pair in symbol", passed: !openSymbols.has(symbol), value: openSymbols.has(symbol) ? "already open" : "none", threshold: "none open" },
    { key: "cooldown", label: "Not in stop cooldown", passed: !coolingDown, value: coolingDown ? "cooling down" : "clear", threshold: `${Math.round(CONFIG.stopCooldownMs / 60000)}m after a divergence stop` },
    { key: "clip-size", label: "Clip vs thinner leg volume", passed: notionalUsd <= Math.min(perpVolume, spotVolume) * CONFIG.maxNotionalShareOfVolume, value: `${((notionalUsd / Math.min(perpVolume, spotVolume)) * 100).toFixed(3)}%`, threshold: `<= ${(CONFIG.maxNotionalShareOfVolume * 100).toFixed(3)}%` },
  ]

  const observed = {
    perpMid, spotMid, gapRate, fundingRate: funding,
    perpSpreadRate: perpSpread, spotSpreadRate: spotSpread,
    perpVolume, spotVolume,
  }
  const model = {
    gapRate,
    expectedFundingRate,
    modelledRate,
    totalCostRate,
    netEdgeRate,
    perpCost, spotCost,
    formula: "edge = |perpMid - spotMid| / spotMid + max(0, fundingRate) - (perp round trip + spot round trip)",
    provenance: {
      gap: "OBSERVED · mid prices from the Bitget public perpetual and spot tickers",
      funding: "OBSERVED · fundingRate from the perpetual ticker",
      cost: "OBSERVED spread plus ESTIMATED published taker fee, charged on both legs both ways",
    },
    deltaNeutral: true,
  }

  const passed = checks.every((check) => check.passed)
  if (!passed) {
    return { ...base, decision: "NO_TRADE", reason: checks.filter((c) => !c.passed).map((c) => c.key).join(","), observed, model, checks }
  }

  // Sell the perpetual at its bid, buy spot at its ask. Both cross.
  const perpEntry = perpBid
  const spotEntry = spotAsk
  const perpSize = notionalUsd / perpEntry
  const spotSize = notionalUsd / spotEntry

  return {
    ...base,
    decision: "TRADE_BASIS_ARB",
    reason: "perpetual rich to spot beyond both round trips",
    observed,
    model,
    checks,
    order: {
      symbol,
      notionalUsd,
      entryGapRate: gapRate,
      targetGapRate: gapRate * CONFIG.takeProfitFraction,
      divergenceStopGapRate: gapRate * CONFIG.divergenceStopMultiple,
      legs: {
        perp: { side: "SHORT", entryPrice: perpEntry, size: perpSize, feeUsd: notionalUsd * TAKER_FEE_RATE },
        spot: { side: "LONG", entryPrice: spotEntry, size: spotSize, feeUsd: notionalUsd * TAKER_FEE_RATE },
      },
      // Worst case is the gap widening to the divergence stop, on notional.
      maxLossUsd: notionalUsd * Math.abs(gapRate) * (CONFIG.divergenceStopMultiple - 1) + notionalUsd * totalCostRate,
    },
  }
}
