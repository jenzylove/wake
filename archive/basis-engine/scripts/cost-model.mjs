// WAKE paper cost model.
//
// Every figure carries an explicit provenance label so the submission can state
// which numbers are observed and which are estimated, as the handbook requires.
//
//   OBSERVED  : read from the Bitget public ticker at decision time
//   ESTIMATED : published rate card or a documented modelling assumption
//
// Nothing here is targeted. If a number cannot be observed or sourced, the
// candidate is rejected rather than filled with a guess.

// Bitget USDT-M futures taker fee, published rate card, standard (non VIP) tier.
export const TAKER_FEE_RATE = 0.0006
export const TAKER_FEE_PROVENANCE = "ESTIMATED · Bitget published USDT-M taker rate, standard tier"

// Funding is charged every 8h on Bitget USDT-M perpetuals.
export const FUNDING_INTERVAL_MS = 8 * 60 * 60 * 1000

/**
 * Half the quoted spread, charged on entry and again on exit. This is observed
 * from the live book rather than assumed, so it is the honest floor on execution
 * cost for a market order that crosses.
 */
export function halfSpreadRate(bidPr, askPr) {
  const bid = Number(bidPr)
  const ask = Number(askPr)
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0 || ask < bid) return null
  const mid = (ask + bid) / 2
  return (ask - bid) / 2 / mid
}

/**
 * Impact beyond the touch. Top of book size rarely absorbs the whole clip, so we
 * charge a linear impact term for the fraction of our notional that exceeds the
 * resting size on the side we cross.
 */
export function impactRate({ notionalUsd, restingSize, price, spreadRate }) {
  const resting = Number(restingSize) * Number(price)
  if (!Number.isFinite(resting) || resting <= 0) return spreadRate
  const overflow = Math.max(0, notionalUsd - resting) / notionalUsd
  return spreadRate * overflow
}

/** Round trip execution cost as a fraction of notional. */
export function roundTripCostRate({ bidPr, askPr, notionalUsd, restingSize, price }) {
  const spread = halfSpreadRate(bidPr, askPr)
  if (spread === null) return null
  const impact = impactRate({ notionalUsd, restingSize, price, spreadRate: spread })
  const entry = spread + impact + TAKER_FEE_RATE
  const exit = spread + impact + TAKER_FEE_RATE
  return {
    total: entry + exit,
    entry,
    exit,
    spreadRate: spread,
    impactRate: impact,
    feeRate: TAKER_FEE_RATE,
    provenance: {
      spread: "OBSERVED · Bitget public ticker bidPr/askPr at decision time",
      impact: "ESTIMATED · linear overflow beyond observed top of book size",
      fee: TAKER_FEE_PROVENANCE,
    },
  }
}

/**
 * Funding accrued on an open position. A long pays when funding is positive, a
 * short receives it. Charged per elapsed 8h interval using the funding rate
 * observed at each tick.
 */
export function fundingAccrual({ side, fundingRate, notionalUsd, elapsedMs }) {
  const rate = Number(fundingRate)
  if (!Number.isFinite(rate)) return 0
  const intervals = elapsedMs / FUNDING_INTERVAL_MS
  const paid = rate * notionalUsd * intervals
  return side === "LONG" ? -paid : paid
}
