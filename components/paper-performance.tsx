"use client"

import * as React from "react"
import { Activity, GitCommitVertical, ShieldCheck, TrendingDown, TrendingUp } from "lucide-react"

type EquityPoint = {
  at: string
  equityUsd: number
  realizedPnlUsd: number
  openUnrealizedUsd: number
  openPositions: number
  scan?: { evaluated: number; triggered: number; opened: number; abstained: number; reasons: Record<string, number> }
}

type OpenPosition = {
  id: string
  symbol: string
  side: "LONG" | "SHORT"
  openedAt: string
  entryPrice: number
  notionalUsd: number
  unrealizedPnlUsd: number
  fundingUsd: number
  entryBasisRate: number
  currentBasisRate: number
  maxLossUsd: number
}

type PaperPayload = {
  running: boolean
  note?: string
  source?: string
  equityCurve?: EquityPoint[]
  equityPointsTotal?: number
  openPositions?: OpenPosition[]
  metrics?: {
    window?: { from: string | null; to: string | null; days: number; equityPoints: number }
    headline?: {
      sharpeAnnualisedFromHourly: number | null
      sharpeAnnualisedFromDaily: number | null
      sharpeSampleSizeHourly: number
      sharpeWithheldReason?: string | null
      maxDrawdownRate: number
      winRate: number | null
      totalReturnRate: number
    }
    trades?: { closed: number; open: number; wins: number; losses: number; profitFactor: number | null; avgHoldHours: number | null; exitReasons: Record<string, number> }
    costs?: { totalFeesUsd: number; totalFundingUsd: number; totalSlippageUsd: number; turnoverVsEquity: number | null }
    equity?: { startingUsd: number; currentUsd: number; totalPnlUsd: number; realizedPnlUsd: number }
    engine?: { tickCount: number; startedAt: string; lastTickAt: string; universeSize: number; lastScan?: EquityPoint["scan"] }
  }
}

const pct = (value: number | null | undefined, digits = 2) =>
  value === null || value === undefined || !Number.isFinite(value) ? "n/a" : `${(value * 100).toFixed(digits)}%`

const usd = (value: number | null | undefined) =>
  value === null || value === undefined || !Number.isFinite(value) ? "n/a" : `${value < 0 ? "-" : ""}$${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`

const ratio = (value: number | null | undefined) =>
  value === null || value === undefined || !Number.isFinite(value) ? "n/a" : value.toFixed(2)

function Sparkline({ points }: { points: EquityPoint[] }) {
  if (points.length < 2) return <div className="paper-spark-empty">Equity curve begins after the second tick.</div>
  const values = points.map((p) => p.equityUsd)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const width = 900
  const height = 120
  const coords = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width
    const y = height - ((value - min) / span) * (height - 12) - 6
    return `${x.toFixed(2)},${y.toFixed(2)}`
  })
  const up = values[values.length - 1] >= values[0]
  const stroke = up ? "var(--pass)" : "var(--hold)"
  return (
    <svg className="paper-spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Paper equity curve">
      <polyline points={`0,${height} ${coords.join(" ")} ${width},${height}`} fill={up ? "rgba(78,139,114,.09)" : "rgba(176,112,92,.09)"} stroke="none" />
      <polyline points={coords.join(" ")} fill="none" stroke={stroke} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export function PaperPerformance() {
  const [data, setData] = React.useState<PaperPayload | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let mounted = true
    const load = async () => {
      try {
        const response = await fetch("/api/paper?points=600")
        if (!response.ok) throw new Error("Ledger unavailable")
        const payload = await response.json() as PaperPayload
        if (mounted) { setData(payload); setError(null) }
      } catch {
        if (mounted) setError("Paper ledger unavailable")
      }
    }
    void load()
    const interval = window.setInterval(load, 60_000)
    return () => { mounted = false; window.clearInterval(interval) }
  }, [])

  if (error) return <div className="paper-panel paper-panel-empty">{error}</div>
  if (!data) return <div className="paper-panel paper-panel-empty">Loading paper ledger…</div>
  if (!data.running) return <div className="paper-panel paper-panel-empty">{data.note ?? "Paper engine has not produced a ledger yet."}</div>

  const head = data.metrics?.headline
  const trades = data.metrics?.trades
  const costs = data.metrics?.costs
  const equity = data.metrics?.equity
  const engine = data.metrics?.engine
  const logWindow = data.metrics?.window
  const curve = data.equityCurve ?? []
  const openPositions = data.openPositions ?? []
  const scan = engine?.lastScan

  const sharpe = head?.sharpeAnnualisedFromHourly
  const totalUp = (head?.totalReturnRate ?? 0) >= 0

  return (
    <section className="paper-panel" aria-labelledby="paper-performance-title">
      <div className="paper-head">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" /> LIVE PAPER RUN · TIER 2 DISLOCATION</div>
          <h2 id="paper-performance-title">Paper performance</h2>
        </div>
        <div className="paper-head-meta">
          <span className="paper-live"><Activity size={12} /> {engine?.tickCount ?? 0} ticks</span>
          <span><GitCommitVertical size={12} /> committed every 10 min</span>
          <span>{logWindow?.days?.toFixed(2) ?? "0"} days of log</span>
        </div>
      </div>

      <div className="paper-metrics">
        <div className="paper-cell">
          <div className="paper-label">SHARPE · ANNUALISED</div>
          <div className="paper-value value-cyan">{sharpe === null || sharpe === undefined ? "pending" : ratio(sharpe)}</div>
          <div className="paper-sub">
            {head?.sharpeWithheldReason
              ? `${head.sharpeSampleSizeHourly ?? 0} of 24 hourly returns`
              : `from ${head?.sharpeSampleSizeHourly ?? 0} hourly returns`}
          </div>
        </div>
        <div className="paper-cell">
          <div className="paper-label">MAX DRAWDOWN</div>
          <div className="paper-value value-orange">{pct(head?.maxDrawdownRate)}</div>
          <div className="paper-sub">peak to trough on the equity curve</div>
        </div>
        <div className="paper-cell">
          <div className="paper-label">WIN RATE</div>
          <div className="paper-value value-lime">{head?.winRate === null || head?.winRate === undefined ? "n/a" : pct(head.winRate, 1)}</div>
          <div className="paper-sub">{trades?.wins ?? 0}W / {trades?.losses ?? 0}L of {trades?.closed ?? 0} closed</div>
        </div>
        <div className="paper-cell">
          <div className="paper-label">TOTAL RETURN</div>
          <div className={`paper-value ${totalUp ? "value-lime" : "value-orange"}`}>
            {totalUp ? <TrendingUp size={14} /> : <TrendingDown size={14} />} {pct(head?.totalReturnRate, 3)}
          </div>
          <div className="paper-sub">{usd(equity?.currentUsd)} of {usd(equity?.startingUsd)}</div>
        </div>
      </div>

      <Sparkline points={curve} />

      <div className="paper-detail">
        <div className="paper-detail-block">
          <div className="paper-detail-head">EXECUTION COST · ALL OBSERVED OR PUBLISHED</div>
          <div className="paper-row"><span>Fees paid · taker rate</span><strong>{usd(costs?.totalFeesUsd)}</strong></div>
          <div className="paper-row"><span>Slippage · observed spread</span><strong>{usd(costs?.totalSlippageUsd)}</strong></div>
          <div className="paper-row"><span>Funding · observed rate</span><strong>{usd(costs?.totalFundingUsd)}</strong></div>
          <div className="paper-row"><span>Turnover vs equity</span><strong>{costs?.turnoverVsEquity === null || costs?.turnoverVsEquity === undefined ? "n/a" : `${costs.turnoverVsEquity.toFixed(2)}x`}</strong></div>
          <div className="paper-row"><span>Profit factor</span><strong>{ratio(trades?.profitFactor)}</strong></div>
          <div className="paper-row"><span>Average hold</span><strong>{trades?.avgHoldHours === null || trades?.avgHoldHours === undefined ? "n/a" : `${trades.avgHoldHours}h`}</strong></div>
        </div>

        <div className="paper-detail-block">
          <div className="paper-detail-head">LAST SCAN · THE GATE MOSTLY SAYS NO</div>
          <div className="paper-row"><span>Instruments evaluated</span><strong>{scan?.evaluated ?? engine?.universeSize ?? 0}</strong></div>
          <div className="paper-row"><span>Cleared dislocation trigger</span><strong>{scan?.triggered ?? 0}</strong></div>
          <div className="paper-row"><span>Opened</span><strong>{scan?.opened ?? 0}</strong></div>
          <div className="paper-row"><span>Refused by the gate</span><strong>{scan?.abstained ?? 0}</strong></div>
          {scan?.reasons && Object.entries(scan.reasons).filter(([key]) => key !== "no dislocation above trigger").slice(0, 3).map(([reason, count]) => (
            <div className="paper-row paper-row-quiet" key={reason}><span>refused · {reason}</span><strong>{count}</strong></div>
          ))}
        </div>

        <div className="paper-detail-block">
          <div className="paper-detail-head">OPEN BOOK · {openPositions.length} POSITION{openPositions.length === 1 ? "" : "S"}</div>
          {openPositions.length === 0 && <div className="paper-row paper-row-quiet"><span>Flat. No dislocation currently clears cost.</span></div>}
          {openPositions.map((position) => (
            <div className="paper-position" key={position.id}>
              <div className="paper-position-head">
                <strong>{position.symbol}</strong>
                <span className={position.side === "LONG" ? "paper-side-long" : "paper-side-short"}>{position.side}</span>
                <b className={(position.unrealizedPnlUsd ?? 0) >= 0 ? "value-lime" : "value-orange"}>{usd(position.unrealizedPnlUsd)}</b>
              </div>
              <div className="paper-position-sub">
                {usd(position.notionalUsd)} notional · basis {(position.entryBasisRate * 1e4).toFixed(0)}bps to {(position.currentBasisRate * 1e4).toFixed(0)}bps · max loss {usd(position.maxLossUsd)}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="paper-foot">
        <ShieldCheck size={13} />
        <span>
          Costs are modelled at the conservative end: entries and exits cross the spread at the observed touch, fees at the Bitget published taker rate, funding at the observed rate. Every figure here is recomputed from <code>data/paper/</code> on each tick and is reproducible from the repository.
        </span>
      </div>
    </section>
  )
}
