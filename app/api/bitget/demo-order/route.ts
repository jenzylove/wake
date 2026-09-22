import { getBitgetContractInfo, getBitgetDemoAccount, getBitgetMarkSnapshot, placeBitgetDemoOrder } from "@/lib/bitget-client"
import { deriveDecision, evaluateRiskGate, incidents } from "@/lib/wake-engine"
import { authorizeOperatorRequest } from "@/lib/request-auth.mjs"
import { executionEligibility } from "@/lib/wake-policy.mjs"
import { contractSize } from "@/lib/sizing.mjs"

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
    const tradeSide = input.tradeSide || "open"
    if (!["open", "close"].includes(tradeSide)) return Response.json({ error: "Invalid demo order payload" }, { status: 400 })

    // Opening is strategy-originated only: real capture, computed numbers, a trade decision,
    // a passing gate and a computed position size. A replay fixture can never open an order.
    if (tradeSide === "open") {
      const eligibility = executionEligibility(incident)
      if (!eligibility.eligible) {
        return Response.json({ error: "The incident is not eligible for execution", incidentId: incident.id, decision, riskGate, reasons: eligibility.reasons }, { status: 409 })
      }
    }

    const symbol = incident.instrument
    const [contract, mark, account] = await Promise.all([getBitgetContractInfo(symbol), getBitgetMarkSnapshot(symbol), getBitgetDemoAccount()])
    const venue = { sizeMultiplier: Number(contract.sizeMultiplier), minTradeNum: Number(contract.minTradeNum) }
    const maxDemoNotional = Number(process.env.WAKE_MAX_DEMO_NOTIONAL_USDT || "100")
    if (!Number.isFinite(maxDemoNotional) || maxDemoNotional <= 0) return Response.json({ error: "WAKE_MAX_DEMO_NOTIONAL_USDT is invalid" }, { status: 503 })

    let size: string
    let sizingBasis: Record<string, unknown>
    if (tradeSide === "open") {
      const sizing = incident.sizing
      if (!sizing || !sizing.computable) return Response.json({ error: "No computed position size" }, { status: 409 })
      // WAKE computes the size; the venue cap only ever shrinks it.
      const notional = Math.min(sizing.notionalUsd, maxDemoNotional)
      const contracts = contractSize(notional, mark.markPrice, venue)
      if (contracts <= 0) return Response.json({ error: "Computed size is below the Bitget contract minimum", notional, contract }, { status: 409 })
      size = String(contracts)
      sizingBasis = { computedNotionalUsd: sizing.notionalUsd, cappedNotionalUsd: notional, bindingConstraint: sizing.bindingConstraint, maxLossUsd: sizing.maxLossUsd, contracts }
    } else {
      // Closing an existing position uses the operator-supplied size.
      size = input.size || ""
      if (!/^\d+(\.\d+)?$/.test(size) || Number(size) <= 0) return Response.json({ error: "Invalid close size" }, { status: 400 })
      sizingBasis = { closeSize: size }
    }
    if (Number(size) * mark.markPrice < Number(contract.minTradeUSDT) && tradeSide === "open") {
      return Response.json({ error: "Demo order is below Bitget minimum notional", contract, mark }, { status: 400 })
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
    return Response.json({ source: "bitget-demo", incidentId: incident.id, decision, riskGate, preflight: { contract, mark, posMode, maxDemoNotional, sizingBasis, modelBasis: incident.consequence?.basis ?? "UNSPECIFIED" }, payload })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Bitget Demo order failed" }, { status: 502 })
  }
}
