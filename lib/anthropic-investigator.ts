import { z } from "zod"

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages"

export const investigatorResultSchema = z.object({
  interpretation: z.string().min(1).max(1800),
  causalHypothesis: z.string().min(1).max(800),
  actionBias: z.enum(["TRADE_DIRECT", "TRADE_CONTAGION", "TRADE_RESOLUTION", "HEDGE", "MONITOR", "NO_TRADE"]),
  confidence: z.number().int().min(0).max(100),
  falsification: z.array(z.object({
    key: z.string().min(1).max(40),
    verdict: z.enum(["SUPPORTS", "WEAKENS", "UNKNOWN"]),
    explanation: z.string().min(1).max(600),
    evidenceRefs: z.array(z.string().min(1).max(500)).max(4),
  })).length(6),
  evidenceToSeek: z.array(z.string().min(1).max(300)).max(6),
  limitations: z.array(z.string().min(1).max(300)).max(6),
})

export type InvestigatorResult = z.infer<typeof investigatorResultSchema>

type IncidentContext = {
  incident: unknown
  graph: unknown
  riskGate: unknown
  allowedEvidenceRefs: string[]
}

type AnthropicResponse = {
  content?: Array<{ type?: string; text?: string }>
  error?: { message?: string }
}

export function anthropicConfigStatus() {
  return {
    configured: Boolean(process.env.ANTHROPIC_API_KEY),
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
    serverOnly: true,
  }
}

export async function investigateWithAnthropic(context: IncidentContext) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured on the server")

  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5"
  const response = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2200,
      system: "You are WAKE's evidence reviewer. Interpret only the supplied evidence. Never invent transaction facts, prices, counterparties, exposure values, or sources. Deterministic code owns numbers, risk gates, and execution. Return JSON only, with exactly six falsification items using the supplied keys. An actionBias is an interpretation label, not an order instruction.",
      messages: [{
        role: "user",
        content: `Review this WAKE investigation context and return the requested JSON schema. Preserve uncertainty.\n\n${JSON.stringify(context)}`,
      }],
    }),
  })

  const payload = await response.json() as AnthropicResponse
  if (!response.ok || payload.error) throw new Error(`Anthropic investigator failed: ${payload.error?.message || response.statusText}`)
  const text = payload.content?.filter((item) => item.type === "text").map((item) => item.text || "").join("\n") || ""
  const jsonText = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/)?.[1] || text
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    throw new Error("Anthropic investigator returned non-JSON output")
  }
  const result = investigatorResultSchema.parse(parsed)
  const allowed = new Set(context.allowedEvidenceRefs)
  return {
    model,
    result: {
      ...result,
      falsification: result.falsification.map((item) => ({
        ...item,
        evidenceRefs: item.evidenceRefs.filter((ref) => allowed.has(ref)),
      })),
    },
  }
}
