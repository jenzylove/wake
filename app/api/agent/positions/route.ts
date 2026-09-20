import { authorizeSchedulerRequest } from "@/lib/request-auth.mjs"
import { getBitgetDemoAccount, getBitgetDemoPositions } from "@/lib/bitget-client"

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
    const data = (account.data ?? {}) as { accountEquity?: string; available?: string; marginCoin?: string }
    return Response.json({
      source: "bitget-demo",
      paptrading: true,
      account: { equity: Number(data.accountEquity ?? NaN), available: Number(data.available ?? NaN), marginCoin: data.marginCoin ?? "USDT" },
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
