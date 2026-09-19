import { getBitgetContractInfo, getBitgetDemoAccount, getBitgetMarkSnapshot, placeBitgetDemoOrder } from "@/lib/bitget-client"
import { deriveDecision, evaluateRiskGate, incidents, isTradeDecision } from "@/lib/wake-engine"
import { authorizeOperatorRequest } from "@/lib/request-auth.mjs"

export async function POST(request: Request) {
  if ((process.env.WAKE_EXECUTION_MODE ?? "paper") !== "bitget-demo") {
    return Response.json({ error: "WAKE is in paper mode. Set WAKE_EXECUTION_MODE=bitget-demo to enable Bitget Demo Trading." }, { status: 409 })
  }

  const authorization = authorizeOperatorRequest(request)
  if (!authorization.ok) return Response.json({ error: authorization.error }, { status: authorization.status })

  try {
    const input = await request.json() as { incidentId?: string; tradeSide?: "open" | "close"; size?: string; clientOid?: string }
    const incident = incidents.find((item) => item.id === input.incidentId)
    if (!incident) return Response.json({ error: "A known WAKE incidentId is required" }, { status: 400 })
    const decision = deriveDecision(incident)
    const riskGate = evaluateRiskGate(incident)
    const size = input.size || ""
    const tradeSide = input.tradeSide || "open"
    if (!["open", "close"].includes(tradeSide) || !/^\d+(\.\d+)?$/.test(size) || Number(size) <= 0) {
      return Response.json({ error: "Invalid demo order payload" }, { status: 400 })
    }
    if (tradeSide === "open" && (!isTradeDecision(decision) || !riskGate.passed)) {
      return Response.json({ error: "The incident is not approved for execution", incidentId: incident.id, decision, riskGate }, { status: 409 })
    }
    const symbol = incident.instrument
    const [contract, mark, account] = await Promise.all([getBitgetContractInfo(symbol), getBitgetMarkSnapshot(symbol), getBitgetDemoAccount()])
    const minimumSize = Number(contract.minTradeNum)
    const sizeMultiplier = Number(contract.sizeMultiplier)
    const requestedSize = Number(size)
    if (!Number.isFinite(minimumSize) || !Number.isFinite(sizeMultiplier) || requestedSize < minimumSize || Math.abs(requestedSize / sizeMultiplier - Math.round(requestedSize / sizeMultiplier)) > 1e-8) {
      return Response.json({ error: "Demo order size does not satisfy Bitget contract limits", contract }, { status: 400 })
    }
    if (requestedSize * mark.markPrice < Number(contract.minTradeUSDT)) return Response.json({ error: "Demo order is below Bitget minimum notional", contract, mark }, { status: 400 })
    const maxDemoNotional = Number(process.env.WAKE_MAX_DEMO_NOTIONAL_USDT || "100")
    if (!Number.isFinite(maxDemoNotional) || maxDemoNotional <= 0) return Response.json({ error: "WAKE_MAX_DEMO_NOTIONAL_USDT is invalid" }, { status: 503 })
    if (tradeSide === "open" && requestedSize * mark.markPrice > maxDemoNotional) {
      return Response.json({ error: "Demo order exceeds WAKE's configured notional cap", requestedNotional: requestedSize * mark.markPrice, maxDemoNotional }, { status: 400 })
    }
    const posMode = (account.data as { posMode?: "hedge_mode" | "one_way_mode" } | undefined)?.posMode
    const directionalSide = incident.side === "LONG" ? "buy" : "sell"
    const side = posMode === "one_way_mode" && tradeSide === "close" ? (directionalSide === "buy" ? "sell" : "buy") : directionalSide
    const posSide = posMode === "hedge_mode" ? incident.side.toLowerCase() as "long" | "short" : undefined
    const payload = await placeBitgetDemoOrder({
      symbol,
      side,
      tradeSide,
      posSide,
      reduceOnly: posMode === "one_way_mode" && tradeSide === "close" ? "YES" : undefined,
      size,
      clientOid: (input.clientOid || `wake-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32),
    })
    return Response.json({ source: "bitget-demo", incidentId: incident.id, decision, riskGate, preflight: { contract, mark, posMode, maxDemoNotional, modelBasis: incident.consequence?.basis ?? "UNSPECIFIED" }, payload })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Bitget Demo order failed" }, { status: 502 })
  }
}
