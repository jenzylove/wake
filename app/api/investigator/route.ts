import { anthropicConfigStatus, investigateWithAnthropic } from "@/lib/anthropic-investigator"
import { deriveDecision, deriveGraphEdges, evaluateRiskGate, incidents } from "@/lib/wake-engine"
import { authorizeOperatorRequest } from "@/lib/request-auth.mjs"

export async function GET() {
  return Response.json({ product: "WAKE", investigator: anthropicConfigStatus() })
}

export async function POST(request: Request) {
  if (process.env.WAKE_PUBLIC_INVESTIGATOR !== "1") {
    const authorization = authorizeOperatorRequest(request)
    if (!authorization.ok) return Response.json({ error: authorization.error }, { status: authorization.status })
  }
  try {
    const body = await request.json() as { incidentId?: string }
    const incident = incidents.find((item) => item.id === body.incidentId)
    if (!incident) return Response.json({ error: "Unknown incident" }, { status: 404 })
    if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "Anthropic investigator is not configured on the server", configured: false }, { status: 503 })

    const allowedEvidenceRefs = [
      ...incident.evidence.map((item) => item.ref),
      ...incident.falsification.map((item) => item.evidenceRef),
      ...(incident.capture ? [incident.capture.txHash, incident.capture.integrity] : []),
    ]
    const result = await investigateWithAnthropic({
      incident: {
        id: incident.id,
        provenance: incident.provenance,
        time: incident.time,
        title: incident.title,
        subtitle: incident.subtitle,
        state: incident.state,
        workflowState: incident.workflowState,
        kind: incident.kind,
        chain: incident.chain,
        risk: incident.risk,
        move: incident.move,
        confidence: incident.confidence,
        instrument: incident.instrument,
        side: incident.side,
        consequence: incident.consequence,
        falsification: incident.falsification,
        evidence: incident.evidence,
      },
      graph: { nodes: incident.graphNodes, edges: deriveGraphEdges(incident) },
      riskGate: { deterministicDecision: deriveDecision(incident), gate: evaluateRiskGate(incident) },
      allowedEvidenceRefs,
      allowedFalsificationKeys: incident.falsification.map((item) => item.key),
    })
    return Response.json({ source: "anthropic-server-investigator", generatedAt: new Date().toISOString(), ...result })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Investigator failed" }, { status: 502 })
  }
}
