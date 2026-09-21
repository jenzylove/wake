import agent from "@/data/wake-paper/summary.json"
import blind from "@/data/blind/summary.json"
import live from "@/data/live/summary.json"
import discovered from "@/data/discovered/index.json"

// One read for the console: what the agent is holding, what it decided recently, and how it has
// scored on the blind challenge. Everything here is committed by the scheduled runs.
export async function GET() {
  return Response.json({
    product: "WAKE",
    generatedAt: new Date().toISOString(),
    agent: agent.metrics,
    exchange: (agent as { exchange?: unknown }).exchange ?? null,
    positions: { open: agent.open, closed: agent.closed },
    recentLog: agent.recentLog,
    logEntries: agent.logEntries,
    blind,
    live,
    discovery: { updatedAt: discovered.updatedAt, lastRun: discovered.lastRun, incidents: discovered.incidents },
  })
}
