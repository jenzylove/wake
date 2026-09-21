import { getBitgetContractInfo, getBitgetDemoAccount, getBitgetDemoContract, getBitgetMarkSnapshot, placeBitgetDemoOrder } from "@/lib/bitget-client"
import { authorizeSchedulerRequest } from "@/lib/request-auth.mjs"
import { contractSize } from "@/lib/sizing.mjs"
import { AGENT_LIMITS } from "@/lib/agent-policy.mjs"
import blindSummary from "@/data/blind/summary.json"
import liveSummary from "@/data/live/summary.json"
import agentSummary from "@/data/wake-paper/summary.json"

// Demo order executor for the scheduled agent.
//
// The scheduler token proves who is asking, not that the request is right, so nothing it submits
// is taken on trust. An opening order is only placed for an incident that is already in the
// published record, whose recorded decision is a trade that cleared, whose instrument and side
// match, that is still fresh, that Bitget Demo actually lists, and whose size does not exceed
// what the record's own sizing and the Demo cap allow. A closing order must match a position the
// published record shows as open. Anything else is refused before the exchange is contacted.

type Intent = { incidentId?: string; tradeSide?: "open" | "close"; instrument?: string; side?: "LONG" | "SHORT"; size?: string; clientOid?: string }
type Published = { id: string; source: string; decision: string; gatePassed: boolean; instrument: string | null; side: string | null; notionalUsd: number | null; detectedAt: string | null }

function published(id: string): Published | null {
  const blind = (blindSummary as { incidents?: Array<Record<string, unknown>> }).incidents ?? []
  const live = (liveSummary as { incidents?: Array<Record<string, unknown>> }).incidents ?? []
  for (const [source, list] of [["blind", blind], ["live", live]] as const) {
    const r = list.find((x) => x.id === id)
    if (!r) continue
    const sizing = r.sizing as { notionalUsd?: number } | null | undefined
    return {
      id, source, decision: String(r.decision ?? ""), gatePassed: r.gatePassed === true,
      instrument: (r.instrument as string | null) ?? null, side: (r.side as string | null) ?? "SHORT",
      notionalUsd: typeof sizing?.notionalUsd === "number" ? sizing.notionalUsd : null,
      detectedAt: (r.detectedAt as string | null) ?? null,
    }
  }
  return null
}

function refuse(status: number, code: string, error: string, extra: Record<string, unknown> = {}) {
  return Response.json({ code, error, ...extra }, { status })
}

export async function POST(request: Request) {
  const auth = authorizeSchedulerRequest(request)
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })
  if ((process.env.WAKE_EXECUTION_MODE ?? "paper") !== "bitget-demo") {
    return refuse(409, "PAPER_MODE", "WAKE_EXECUTION_MODE is not bitget-demo on this deployment")
  }

  let intent: Intent
  try { intent = await request.json() as Intent } catch { return refuse(400, "BAD_REQUEST", "Expected a JSON intent") }
  const { incidentId, tradeSide, instrument, side, size, clientOid } = intent
  if (!incidentId || !instrument || !/^[A-Z0-9]{2,20}USDT$/.test(instrument)) return refuse(400, "BAD_REQUEST", "incidentId and a USDT perpetual instrument are required")
  if (tradeSide !== "open" && tradeSide !== "close") return refuse(400, "BAD_REQUEST", "tradeSide must be open or close")
  if (side !== "LONG" && side !== "SHORT") return refuse(400, "BAD_REQUEST", "side must be LONG or SHORT")
  if (!size || !/^\d+(\.\d+)?$/.test(size) || Number(size) <= 0) return refuse(400, "BAD_REQUEST", "Invalid size")

  // Re-derive everything from the published record rather than the request.
  if (tradeSide === "open") {
    const rec = published(incidentId)
    if (!rec) return refuse(409, "UNPUBLISHED", "incident is not in the published record yet; it will be retried once it is")
    const reasons: string[] = []
    if (!rec.decision.startsWith("TRADE")) reasons.push(`recorded decision is ${rec.decision}`)
    if (!rec.gatePassed) reasons.push("recorded decision did not clear")
    if (rec.instrument !== instrument) reasons.push(`instrument ${instrument} does not match the recorded ${rec.instrument}`)
    if ((rec.side ?? "SHORT") !== side) reasons.push(`side ${side} does not match the recorded ${rec.side}`)
    const ageHours = rec.detectedAt ? (Date.now() - Date.parse(rec.detectedAt)) / 3_600_000 : Infinity
    if (!(ageHours <= AGENT_LIMITS.maxSignalAgeHours)) reasons.push(`signal is ${Number.isFinite(ageHours) ? Math.round(ageHours) + "h" : "of unknown"} age`)
    if (reasons.length) return refuse(409, "NOT_ELIGIBLE", "the published record does not support this order", { reasons })
    if (!(await getBitgetDemoContract(instrument))) return refuse(409, "NOT_LISTED", `${instrument} is not listed on Bitget Demo`)
  } else {
    const open = ((agentSummary as { open?: Array<Record<string, unknown>> }).open ?? [])
      .find((p) => p.incidentId === incidentId && p.instrument === instrument && p.side === side)
    if (!open) return refuse(409, "NO_SUCH_POSITION", "the published record shows no matching open position")
    if (Number(size) > Number(open.size)) return refuse(409, "OVERSIZE_CLOSE", "close size exceeds the recorded position", { recorded: open.size })
  }

  try {
    const [contract, mark, account] = await Promise.all([getBitgetContractInfo(instrument), getBitgetMarkSnapshot(instrument), getBitgetDemoAccount()])
    const cap = Number(process.env.WAKE_MAX_DEMO_NOTIONAL_USDT || String(AGENT_LIMITS.demoNotionalCapUsd))
    const notional = Number(size) * mark.markPrice
    if (tradeSide === "open") {
      const rec = published(incidentId)!
      const allowedNotional = Math.min(rec.notionalUsd ?? cap, cap)
      const maxContracts = contractSize(allowedNotional * 1.05, mark.markPrice, { sizeMultiplier: Number(contract.sizeMultiplier), minTradeNum: Number(contract.minTradeNum) })
      if (Number(size) > maxContracts) return refuse(409, "OVERSIZE", "size exceeds what the recorded sizing and the Demo cap allow", { requested: size, allowed: maxContracts })
      if (notional < Number(contract.minTradeUSDT)) return refuse(409, "BELOW_MINIMUM", "order is below the Bitget minimum notional", { notional })
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
    return refuse(502, "VENUE_ERROR", error instanceof Error ? error.message : "Demo order failed")
  }
}
