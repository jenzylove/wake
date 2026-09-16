import { getBitgetMarkSnapshot } from "@/lib/bitget-client"
import { appendRuntimeRecord, readRuntimeRecords, runtimeStoreStatus } from "@/lib/runtime-store"
import { authorizeOperatorRequest } from "@/lib/request-auth.mjs"

type PositionObservation = {
  observationId: string
  positionId: string
  incidentId: string
  symbol: string
  side: "LONG" | "SHORT"
  entryPrice: number | null
  markPrice: number
  capturedAt: string
  source: "bitget-public-ticker"
}

function validSymbol(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z0-9_-]{2,20}$/.test(value)
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const positionId = url.searchParams.get("positionId")
  const incidentId = url.searchParams.get("incidentId")
  const records = await readRuntimeRecords<PositionObservation>("position-observations", 250)
  const observations = records.filter((item) => (!positionId || item.positionId === positionId) && (!incidentId || item.incidentId === incidentId))
  return Response.json({ source: "wake-runtime-store", positionId, incidentId, storage: runtimeStoreStatus(), observations })
}

export async function POST(request: Request) {
  const authorization = authorizeOperatorRequest(request)
  if (!authorization.ok) return Response.json({ error: authorization.error }, { status: authorization.status })
  try {
    const body = await request.json() as { positionId?: string; incidentId?: string; symbol?: string; side?: "LONG" | "SHORT"; entryPrice?: number | null }
    if (!body.positionId || !body.incidentId || !validSymbol(body.symbol) || !["LONG", "SHORT"].includes(body.side || "")) return Response.json({ error: "Invalid position observation payload" }, { status: 400 })
    const snapshot = await getBitgetMarkSnapshot(body.symbol)
    const observation: PositionObservation = {
      observationId: `obs_${snapshot.capturedAt.replace(/[-:TZ.]/g, "").slice(0, 14)}`,
      positionId: body.positionId,
      incidentId: body.incidentId,
      symbol: body.symbol,
      side: body.side as "LONG" | "SHORT",
      entryPrice: typeof body.entryPrice === "number" && Number.isFinite(body.entryPrice) ? body.entryPrice : null,
      markPrice: snapshot.markPrice,
      capturedAt: snapshot.capturedAt,
      source: snapshot.source,
    }
    const write = await appendRuntimeRecord("position-observations", observation)
    return Response.json({ source: "server-position-observation", observation, persisted: write.persisted, storage: write.status })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Position observation failed" }, { status: 502 })
  }
}
