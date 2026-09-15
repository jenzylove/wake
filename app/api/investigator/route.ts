import { anthropicConfigStatus, investigateWithAnthropic } from "@/lib/anthropic-investigator"
import { checkRateLimit, clientKey } from "@/lib/rate-limit"
import { deriveDecision, deriveGraphEdges, evaluateRiskGate, incidents } from "@/lib/wake-engine"

export async function GET() {
  return Response.json({ product: "WAKE", investigator: anthropicConfigStatus() })
}

export async function POST(request: Request) {
  const limit = checkRateLimit({ key: clientKey(request, "investigator"), limit: 3, windowMs: 60_000, dailyLimit: 40 })
  if (!limit.allowed) {
    return Response.json(
      { error: `Investigator rate limit: ${limit.reason}`, retryAfterSeconds: limit.retryAfterSeconds },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } },
    )
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
    })
    return Response.json({ source: "anthropic-server-investigator", generatedAt: new Date().toISOString(), ...result })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Investigator failed" }, { status: 502 })
  }
}
