import { authorizeSchedulerRequest } from "@/lib/request-auth.mjs"
import { decideWithClaude } from "@/lib/ai-decide.mjs"

// Claude's trading decision for the scheduled agent. The Anthropic key stays on the server; the
// scheduler sends the measured evidence and candidates, and gets back the model's choice. Code
// on the caller's side can still refuse it, and can never replace it with a different trade.
export async function POST(request: Request) {
  const auth = authorizeSchedulerRequest(request)
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return Response.json({ error: "ANTHROPIC_API_KEY is not configured" }, { status: 503 })
  let body: { packet?: unknown }
  try { body = await request.json() as { packet?: unknown } } catch { return Response.json({ error: "Expected JSON" }, { status: 400 }) }
  if (!body.packet || JSON.stringify(body.packet).length > 60_000) return Response.json({ error: "packet missing or too large" }, { status: 400 })
  try {
    const decision = await decideWithClaude(body.packet, { apiKey, model: process.env.ANTHROPIC_MODEL || "claude-opus-5" })
    return Response.json({ source: "anthropic", decision })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "decision failed" }, { status: 502 })
  }
}
