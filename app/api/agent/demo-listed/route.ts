import { authorizeSchedulerRequest } from "@/lib/request-auth.mjs"
import { getBitgetDemoContract } from "@/lib/bitget-client"

// Which instruments Bitget Demo actually lists. Demo lists fewer perpetuals than the live venue,
// so an opportunity is only executable if this says yes. Read only; the keys stay here.
export async function GET(request: Request) {
  const auth = authorizeSchedulerRequest(request)
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })
  const symbols = (new URL(request.url).searchParams.get("symbols") ?? "")
    .split(",").map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z0-9]{2,20}USDT$/.test(s)).slice(0, 30)
  const listed: Record<string, boolean> = {}
  for (const symbol of symbols) {
    try { listed[symbol] = await getBitgetDemoContract(symbol) } catch { listed[symbol] = false }
  }
  return Response.json({ source: "bitget-demo", listed })
}
