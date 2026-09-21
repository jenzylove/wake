import { authorizeSchedulerRequest } from "@/lib/request-auth.mjs"
import { getBitgetDemoAccount, getBitgetDemoPositionHistory, getBitgetDemoPositions } from "@/lib/bitget-client"

// The exchange's own view of the Demo account, for the scheduled agent to reconcile against.
// Keys stay on the server; the scheduler only holds a token. Read only: this places no orders.
export async function GET(request: Request) {
  const auth = authorizeSchedulerRequest(request)
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })
  if ((process.env.WAKE_EXECUTION_MODE ?? "paper") !== "bitget-demo") {
    return Response.json({ error: "WAKE_EXECUTION_MODE is not bitget-demo on this deployment" }, { status: 409 })
  }
  try {
    const [positions, account] = await Promise.all([getBitgetDemoPositions(), getBitgetDemoAccount()])
    // Closed positions for the instruments the caller asks about, straight from the venue.
    const symbols = (new URL(request.url).searchParams.get("history") ?? "")
      .split(",").map((x) => x.trim().toUpperCase()).filter((x) => /^[A-Z0-9]{2,20}USDT$/.test(x)).slice(0, 20)
    const history: Array<Record<string, unknown>> = []
    for (const symbol of symbols) {
      try {
        const h = await getBitgetDemoPositionHistory(symbol)
        for (const x of h.data?.list ?? []) history.push({
          symbol: x.symbol, side: x.holdSide === "short" ? "SHORT" : "LONG",
          openedAt: new Date(Number(x.ctime)).toISOString(), closedAt: new Date(Number(x.utime)).toISOString(),
          entryPrice: Number(x.openAvgPrice), exitPrice: Number(x.closeAvgPrice),
          pnlUsd: Number(x.pnl), netProfitUsd: Number(x.netProfit),
          feesUsd: Number(x.openFee) + Number(x.closeFee), fundingUsd: Number(x.totalFunding),
        })
      } catch { /* one symbol failing does not hide the rest */ }
    }
    const data = (account.data ?? {}) as { accountEquity?: string; available?: string; marginCoin?: string }
    return Response.json({
      source: "bitget-demo",
      paptrading: true,
      account: { equity: Number(data.accountEquity ?? NaN), available: Number(data.available ?? NaN), marginCoin: data.marginCoin ?? "USDT" },
      history,
      positions: (positions.data as Array<Record<string, string>> ?? []).map((p) => ({
        symbol: p.symbol,
        side: p.holdSide === "short" ? "SHORT" : "LONG",
        size: Number(p.total),
        entryPrice: Number(p.openPriceAvg),
        markPrice: Number(p.markPrice),
        unrealizedPnlUsd: Number(p.unrealizedPL),
        marginMode: p.marginMode,
        leverage: Number(p.leverage),
      })),
    })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "position read failed" }, { status: 502 })
  }
}
