import { placeBitgetDemoOrder } from "@/lib/bitget-client"

export async function POST(request: Request) {
  if ((process.env.WAKE_EXECUTION_MODE ?? "paper") !== "bitget-demo") {
    return Response.json({ error: "WAKE is in paper mode. Set WAKE_EXECUTION_MODE=bitget-demo to enable Bitget Demo Trading." }, { status: 409 })
  }

  try {
    const input = await request.json() as { symbol?: string; side?: "buy" | "sell"; size?: string; clientOid?: string }
    const symbol = (input.symbol || "").toUpperCase()
    const size = input.size || ""
    if (!/^[A-Z0-9_-]{2,20}$/.test(symbol) || !["buy", "sell"].includes(input.side || "") || !/^\d+(\.\d+)?$/.test(size) || Number(size) <= 0) {
      return Response.json({ error: "Invalid demo order payload" }, { status: 400 })
    }
    const payload = await placeBitgetDemoOrder({
      symbol,
      side: input.side as "buy" | "sell",
      size,
      clientOid: (input.clientOid || `wake-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32),
    })
    return Response.json({ source: "bitget-demo", payload })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Bitget Demo order failed" }, { status: 502 })
  }
}
