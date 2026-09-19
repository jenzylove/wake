import { NextRequest } from "next/server"
import {
  GATE_THRESHOLDS,
  deriveDecision,
  deriveGraphEdges,
  evaluateRiskGate,
  exportEvidencePacket,
  getGraphNodeType,
  incidents,
} from "@/lib/wake-engine"

// Server derived tier 1 decisions.
//
// The paper order ledger for tier 1 lived only in the judge's browser, so a
// fresh visitor saw an empty surface and nothing about the decision could be
// checked without clicking through it.
//
// Storing that ledger server side would only move the trust problem. Every tier
// 1 decision is a pure function of a capture packet that is committed to this
// repository and hashed, so the stronger answer is to derive the decisions here
// on request. Nothing is remembered, so there is nothing to take on faith: the
// same inputs produce the same output for anyone who runs `npm run data:verify`
// and reads `lib/consequence-model.ts`.
//
// Interactive paper orders remain session local and are labelled as such. They
// are a judge's own actions, not a record WAKE is asserting.

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id")
  const selected = id ? incidents.filter((incident) => incident.id === id) : incidents

  if (id && selected.length === 0) {
    return Response.json({ error: "Unknown incident", knownIds: incidents.map((i) => i.id) }, { status: 404 })
  }

  const records = selected.map((incident) => {
    const decision = deriveDecision(incident)
    const gate = evaluateRiskGate(incident)
    return {
      id: incident.id,
      title: incident.title,
      chain: incident.chain,
      instrument: incident.instrument,
      side: incident.side,
      observedAt: `${incident.time} UTC`,
      provenance: incident.provenance ?? "REPLAY_FIXTURE",
      numbersProvenance: incident.numbersProvenance ?? "AUTHORED_SCENARIO",
      state: incident.state,
      workflowState: incident.workflowState,
      decision,
      decisionReason: incident.decisionReason,
      gate: {
        passed: gate.passed,
        thresholds: GATE_THRESHOLDS,
        checks: gate.checks,
      },
      model: {
        modeledDeltaPct: incident.modeledDelta,
        marketDeltaPct: incident.marketDelta,
        residualPct: incident.modeledDelta === null ? null : Number((incident.modeledDelta - incident.marketDelta).toFixed(3)),
        confidence: incident.confidence,
        consequence: incident.consequence,
        inputs: incident.consequenceInputs ?? null,
      },
      falsification: incident.falsification,
      graph: {
        nodes: incident.graphNodes.map((node) => ({ id: node.id, label: node.label, nodeType: getGraphNodeType(node) })),
        edges: deriveGraphEdges(incident),
      },
      sizing: incident.sizing ?? null,
      capture: incident.capture ?? null,
    }
  })

  return Response.json({
    product: "WAKE",
    source: "server-derived",
    generatedAt: new Date().toISOString(),
    note: "Decisions are recomputed on every request from committed capture packets. Nothing here is stored, so nothing here has to be trusted. Verify the inputs with `npm run data:verify`.",
    liveTrading: false,
    summary: {
      total: records.length,
      realCaptures: records.filter((r) => r.provenance === "REAL_CAPTURE").length,
      computedNumbers: records.filter((r) => r.numbersProvenance === "COMPUTED").length,
      gatePassed: records.filter((r) => r.gate.passed).length,
      abstained: records.filter((r) => !r.gate.passed).length,
      byDecision: records.reduce<Record<string, number>>((acc, r) => {
        acc[r.decision] = (acc[r.decision] ?? 0) + 1
        return acc
      }, {}),
    },
    incidents: records,
  })
}

/**
 * Full evidence packet for one incident, the same structure the interface
 * exports, but produced server side so it can be fetched without a browser.
 */
export async function POST(request: Request) {
  let body: { incidentId?: string }
  try {
    body = await request.json() as { incidentId?: string }
  } catch {
    return Response.json({ error: "Expected a JSON body with incidentId" }, { status: 400 })
  }

  const incident = incidents.find((item) => item.id === body.incidentId)
  if (!incident) {
    return Response.json({ error: "Unknown incident", knownIds: incidents.map((i) => i.id) }, { status: 404 })
  }

  // No paper orders or replay runs: those belong to a browser session, and this
  // route deliberately asserts only what it can derive.
  const packet = exportEvidencePacket(incident, deriveDecision(incident), [], [], null, [])
  return Response.json({ source: "server-derived", ...packet })
}
