import index from "@/data/discovered/index.json"

// Incidents WAKE opened on its own from the public exploit feed. The records and the append
// only decision log are committed by the scheduled discovery workflow; this route serves the
// index as committed and asserts nothing beyond it.
export async function GET() {
  const incidents = index.incidents
  return Response.json({
    product: "WAKE",
    source: "autonomous-discovery",
    feed: "https://api.llama.fi/hacks",
    schedule: "every two hours (.github/workflows/discover.yml)",
    updatedAt: index.updatedAt,
    lastRun: index.lastRun,
    summary: {
      total: incidents.length,
      monitoring: incidents.filter((i) => i.decision === "MONITOR").length,
      noTrade: incidents.filter((i) => i.decision === "NO_TRADE").length,
      executable: 0,
    },
    note: "A feed entry is not an on-chain receipt. Discovered incidents stay at MONITOR until a receipt is attached and the exposure is quantified, so none is executable. Records and the hash chained log live in data/discovered/.",
    incidents,
  })
}
