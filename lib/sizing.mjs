// Deterministic position sizing from the capture packet.
//
// Replaces the hand-typed "10% of incident VaR" / "$1,200" strings. Every input is
// either observed in the capture (volatility, traded value, spread estimate) or a
// documented constant below. Nothing is tuned to produce a trade.
//
//   stop distance  = STOP_SIGMAS × observed window volatility
//   round-trip cost = 2 × taker fee + estimated spread
//   risk notional  = equity × RISK_FRACTION / (stop distance + round-trip cost)
//   liquidity cap  = PARTICIPATION_CAP × observed traded value in the window
//   notional       = min(risk notional, liquidity cap, venue cap)
//   max loss       = notional × (stop distance + round-trip cost)

export const SIZING_CONSTANTS = Object.freeze({
  equityUsd: 100_000,        // paper book, same base as the paper engine
  riskFraction: 0.005,       // 0.5% of equity at risk per incident
  stopSigmas: 2,             // stop at two window standard deviations
  participationCap: 0.005,   // never more than 0.5% of the window's traded value
  takerFee: 0.0006,          // Bitget USDT-M taker fee
})

// Corwin & Schultz (2012) high/low spread estimator, averaged over consecutive candle pairs.
/** @param {Array<{ high: number, low: number }>} candles */
export function estimateSpread(candles) {
  const k = 3 - 2 * Math.SQRT2
  const values = []
  for (let i = 0; i + 1 < candles.length; i += 1) {
    const a = candles[i]
    const b = candles[i + 1]
    if (!(a.high > 0 && a.low > 0 && b.high > 0 && b.low > 0)) continue
    const beta = Math.log(a.high / a.low) ** 2 + Math.log(b.high / b.low) ** 2
    const gamma = Math.log(Math.max(a.high, b.high) / Math.min(a.low, b.low)) ** 2
    const alpha = (Math.sqrt(2 * beta) - Math.sqrt(beta)) / k - Math.sqrt(gamma / k)
    values.push(Math.max(0, (2 * (Math.exp(alpha) - 1)) / (1 + Math.exp(alpha))))
  }
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : null
}

/**
 * @param {{ windowSigma: number, quoteVolumeUsd: number, candles?: Array<{ high: number, low: number }>, venueCapUsd?: number | null }} input
 * @param {typeof SIZING_CONSTANTS} [constants]
 */
export function computePositionSizing({ windowSigma, quoteVolumeUsd, candles = [], venueCapUsd = null }, constants = SIZING_CONSTANTS) {
  if (!(windowSigma > 0) || !(quoteVolumeUsd > 0)) {
    return { computable: false, reason: "capture lacks observed volatility or traded value" }
  }
  const spreadPct = estimateSpread(candles) ?? 0
  const stopPct = constants.stopSigmas * windowSigma
  const costPct = 2 * constants.takerFee + spreadPct
  const riskUsd = constants.equityUsd * constants.riskFraction
  const riskNotional = riskUsd / (stopPct + costPct)
  const liquidityNotional = constants.participationCap * quoteVolumeUsd
  const caps = [
    { key: "risk budget", value: riskNotional },
    { key: "liquidity participation", value: liquidityNotional },
  ]
  if (venueCapUsd !== null && venueCapUsd > 0) caps.push({ key: "venue notional cap", value: venueCapUsd })
  const binding = caps.reduce((a, b) => (b.value < a.value ? b : a))
  const notionalUsd = binding.value
  const maxLossUsd = notionalUsd * (stopPct + costPct)
  return {
    computable: true,
    notionalUsd,
    maxLossUsd,
    stopPct,
    costPct,
    spreadPct,
    bindingConstraint: binding.key,
    inputs: [
      { label: "Window volatility", value: windowSigma, provenance: "OBSERVED" },
      { label: "Window traded value (USD)", value: quoteVolumeUsd, provenance: "OBSERVED" },
      { label: "Spread (Corwin-Schultz on 1m candles)", value: spreadPct, provenance: "ESTIMATED" },
      { label: "Equity", value: constants.equityUsd, provenance: "ASSUMED" },
      { label: "Risk fraction", value: constants.riskFraction, provenance: "ASSUMED" },
      { label: "Stop, in window sigmas", value: constants.stopSigmas, provenance: "ASSUMED" },
      { label: "Participation cap", value: constants.participationCap, provenance: "ASSUMED" },
      { label: "Taker fee", value: constants.takerFee, provenance: "OBSERVED" },
    ],
  }
}

// Contract quantity for a notional, rounded down to the venue's size step. Returns 0 when the
// result falls below the venue minimum, which callers must treat as "cannot execute".
export function contractSize(notionalUsd, markPrice, { sizeMultiplier, minTradeNum }) {
  if (!(notionalUsd > 0) || !(markPrice > 0) || !(sizeMultiplier > 0)) return 0
  const steps = Math.floor(notionalUsd / markPrice / sizeMultiplier + 1e-9)
  const size = Number((steps * sizeMultiplier).toFixed(10))
  return size >= minTradeNum ? size : 0
}
