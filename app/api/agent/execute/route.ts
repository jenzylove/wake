import { getBitgetContractInfo, getBitgetDemoAccount, getBitgetMarkSnapshot, placeBitgetDemoOrder } from "@/lib/bitget-client"
import { authorizeSchedulerRequest } from "@/lib/request-auth.mjs"

// Demo order executor for the scheduled WAKE agent.
//
// The agent decides in the repository (scripts/wake-agent.mjs, lib/agent-policy.mjs) and its
// decisions land in the hash chained log. The exchange keys live only here, on the server, so
// the scheduler holds nothing but a token that can ask for a Demo order. This route enforces
// money, not meaning: Demo mode only, a hard notional cap, a real Bitget contract, and the venue
// minimum. It cannot withdraw, cannot trade live, and cannot exceed the cap whatever it is sent.

type Intent = { incidentId?: string; tradeSide?: "open" | "close"; instrument?: string; side?: "LONG" | "SHORT"; size?: string; clientOid?: string }

export async function POST(request: Request) {
  const auth = authorizeSchedulerRequest(request)
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })
  if ((process.env.WAKE_EXECUTION_MODE ?? "paper") !== "bitget-demo") {
    return Response.json({ error: "WAKE_EXECUTION_MODE is not bitget-demo on this deployment" }, { status: 409 })
  }

  let intent: Intent
  try { intent = await request.json() as Intent } catch { return Response.json({ error: "Expected a JSON intent" }, { status: 400 }) }
  const { incidentId, tradeSide, instrument, side, size, clientOid } = intent
  if (!incidentId || !instrument || !/^[A-Z0-9]{2,20}USDT$/.test(instrument)) return Response.json({ error: "incidentId and a USDT perpetual instrument are required" }, { status: 400 })
  if (tradeSide !== "open" && tradeSide !== "close") return Response.json({ error: "tradeSide must be open or close" }, { status: 400 })
  if (side !== "LONG" && side !== "SHORT") return Response.json({ error: "side must be LONG or SHORT" }, { status: 400 })
  if (!size || !/^\d+(\.\d+)?$/.test(size) || Number(size) <= 0) return Response.json({ error: "Invalid size" }, { status: 400 })

  try {
    const [contract, mark, account] = await Promise.all([getBitgetContractInfo(instrument), getBitgetMarkSnapshot(instrument), getBitgetDemoAccount()])
    const cap = Number(process.env.WAKE_MAX_DEMO_NOTIONAL_USDT || "100")
    const notional = Number(size) * mark.markPrice
    if (tradeSide === "open") {
      if (notional > cap * 1.05) return Response.json({ error: "Intent exceeds the Demo notional cap", notional, cap }, { status: 409 })
      if (notional < Number(contract.minTradeUSDT)) return Response.json({ error: "Intent is below the Bitget minimum notional", notional, contract }, { status: 409 })
    }
    const posMode = (account.data as { posMode?: "hedge_mode" | "one_way_mode" } | undefined)?.posMode
    const hedge = posMode === "hedge_mode"
    const orderSide = hedge ? (side === "LONG" ? "buy" : "sell") : ((side === "LONG") === (tradeSide === "open") ? "buy" : "sell")
    const oid = (clientOid || `wake-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32)
    const payload = await placeBitgetDemoOrder({
      symbol: instrument, side: orderSide, tradeSide, size, clientOid: oid,
      ...(hedge ? { posSide: side.toLowerCase() as "long" | "short" } : {}),
      ...(!hedge && tradeSide === "close" ? { reduceOnly: "YES" as const } : {}),
    }) as { data?: { orderId?: string } }
    return Response.json({ source: "bitget-demo", paptrading: true, incidentId, tradeSide, instrument, side, size, markPrice: mark.markPrice, notional, cap, posMode, orderId: payload.data?.orderId ?? null, clientOid: oid })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Demo order failed" }, { status: 502 })
  }
}
