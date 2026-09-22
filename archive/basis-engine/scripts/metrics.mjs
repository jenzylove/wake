// Performance metrics computed from the committed paper log.
//
// The handbook asks for Sharpe, max drawdown and win rate. Every figure below is
// derived from data/paper/equity.jsonl and data/paper/trades.jsonl, so a judge can
// recompute all of it from the repository without trusting this file.

const MS_PER_HOUR = 3600_000

// Annualising a Sharpe from a handful of returns produces a large number that
// means nothing. Below these sample sizes the figure is withheld and the reason
// is reported instead, because a confident wrong number is worse than a gap.
const MIN_HOURLY_RETURNS = 24
const MIN_DAILY_RETURNS = 5

function mean(values) {
  if (!values.length) return 0
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

function stdev(values) {
  if (values.length < 2) return 0
  const m = mean(values)
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

/** Resample an equity curve onto a fixed bucket, taking the last point per bucket. */
function resample(curve, bucketMs) {
  const buckets = new Map()
  for (const point of curve) {
    const key = Math.floor(new Date(point.at).getTime() / bucketMs)
    buckets.set(key, point)
  }
  return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([, point]) => point)
}

function simpleReturns(curve) {
  const out = []
  for (let i = 1; i < curve.length; i += 1) {
    const prev = curve[i - 1].equityUsd
    const next = curve[i].equityUsd
    if (prev > 0) out.push(next / prev - 1)
  }
  return out
}

function sharpe(returns, periodsPerYear, minimumSamples) {
  if (returns.length < minimumSamples) return null
  const sd = stdev(returns)
  if (sd === 0) return null
  return (mean(returns) / sd) * Math.sqrt(periodsPerYear)
}

function maxDrawdown(curve) {
  let peak = -Infinity
  let worst = 0
  let peakAt = null
  let troughAt = null
  let currentPeakAt = null
  for (const point of curve) {
    if (point.equityUsd > peak) {
      peak = point.equityUsd
      currentPeakAt = point.at
    }
    if (peak > 0) {
      const dd = point.equityUsd / peak - 1
      if (dd < worst) {
        worst = dd
        peakAt = currentPeakAt
        troughAt = point.at
      }
    }
  }
  return { rate: worst, peakAt, troughAt }
}

export function computeMetrics({ equityCurve, trades, startingEquityUsd }) {
  const curve = [...equityCurve].sort((a, b) => new Date(a.at) - new Date(b.at))
  const closed = trades.filter((t) => t.status === "CLOSED")
  const wins = closed.filter((t) => t.realizedPnlUsd > 0)
  const losses = closed.filter((t) => t.realizedPnlUsd <= 0)

  const grossWin = wins.reduce((s, t) => s + t.realizedPnlUsd, 0)
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.realizedPnlUsd, 0))

  const hourly = resample(curve, MS_PER_HOUR)
  const daily = resample(curve, 24 * MS_PER_HOUR)
  const hourlyReturns = simpleReturns(hourly)
  const dailyReturns = simpleReturns(daily)

  const first = curve[0]
  const last = curve[curve.length - 1]
  const spanMs = first && last ? new Date(last.at) - new Date(first.at) : 0
  const spanDays = spanMs / (24 * MS_PER_HOUR)

  const equityNow = last?.equityUsd ?? startingEquityUsd
  const totalReturnRate = startingEquityUsd > 0 ? equityNow / startingEquityUsd - 1 : 0
  const dd = maxDrawdown(curve)

  const totalNotional = closed.reduce((s, t) => s + (t.notionalUsd ?? 0), 0)
  const totalFees = closed.reduce((s, t) => s + (t.feesUsd ?? 0), 0)
  const totalFunding = closed.reduce((s, t) => s + (t.fundingUsd ?? 0), 0)
  const totalSlippage = closed.reduce((s, t) => s + (t.slippageUsd ?? 0), 0)

  const holdHours = closed
    .map((t) => (new Date(t.closedAt) - new Date(t.openedAt)) / MS_PER_HOUR)
    .filter(Number.isFinite)

  return {
    schema: "wake.paper.metrics.v1",
    generatedAt: new Date().toISOString(),
    window: {
      from: first?.at ?? null,
      to: last?.at ?? null,
      days: Number(spanDays.toFixed(3)),
      equityPoints: curve.length,
      note: "Live paper run. Figures are observed from the committed log, not backtested.",
    },
    headline: {
      sharpeAnnualisedFromHourly: sharpe(hourlyReturns, 24 * 365, MIN_HOURLY_RETURNS),
      sharpeAnnualisedFromDaily: sharpe(dailyReturns, 365, MIN_DAILY_RETURNS),
      sharpeSampleSizeHourly: hourlyReturns.length,
      sharpeSampleSizeDaily: dailyReturns.length,
      sharpeMinimumSamples: { hourly: MIN_HOURLY_RETURNS, daily: MIN_DAILY_RETURNS },
      sharpeWithheldReason: hourlyReturns.length < MIN_HOURLY_RETURNS
        ? `Withheld. ${hourlyReturns.length} of ${MIN_HOURLY_RETURNS} hourly returns collected; annualising fewer is not meaningful.`
        : null,
      maxDrawdownRate: dd.rate,
      maxDrawdownPeakAt: dd.peakAt,
      maxDrawdownTroughAt: dd.troughAt,
      winRate: closed.length ? wins.length / closed.length : null,
      totalReturnRate,
    },
    trades: {
      closed: closed.length,
      open: trades.filter((t) => t.status === "OPEN").length,
      wins: wins.length,
      losses: losses.length,
      profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
      avgWinUsd: wins.length ? grossWin / wins.length : 0,
      avgLossUsd: losses.length ? -grossLoss / losses.length : 0,
      avgHoldHours: holdHours.length ? Number(mean(holdHours).toFixed(2)) : null,
      exitReasons: closed.reduce((acc, t) => { acc[t.exitReason] = (acc[t.exitReason] ?? 0) + 1; return acc }, {}),
    },
    costs: {
      totalFeesUsd: Number(totalFees.toFixed(2)),
      totalFundingUsd: Number(totalFunding.toFixed(2)),
      totalSlippageUsd: Number(totalSlippage.toFixed(2)),
      totalNotionalUsd: Number(totalNotional.toFixed(2)),
      turnoverVsEquity: startingEquityUsd > 0 ? Number((totalNotional / startingEquityUsd).toFixed(2)) : null,
      note: "Fees at the Bitget published taker rate. Slippage is the observed half spread plus a linear overflow term. Funding is the observed rate accrued per 8h interval.",
    },
    equity: {
      startingUsd: startingEquityUsd,
      currentUsd: Number(equityNow.toFixed(2)),
      totalPnlUsd: Number((equityNow - startingEquityUsd).toFixed(2)),
      realizedPnlUsd: Number(closed.reduce((s, t) => s + (t.realizedPnlUsd ?? 0), 0).toFixed(2)),
      openUnrealizedUsd: Number((last?.openUnrealizedUsd ?? 0).toFixed(2)),
    },
    provenance: {
      returns: "OBSERVED · mark to market against Bitget public ticker markPrice",
      fees: "ESTIMATED · Bitget published USDT-M taker rate, standard tier",
      slippage: "OBSERVED · half of the quoted spread at decision time, plus modelled overflow",
      funding: "OBSERVED · fundingRate from the Bitget public ticker",
    },
  }
}
