import { getBitgetContractInfo, getBitgetDemoAccount, getBitgetMarkSnapshot, placeBitgetDemoOrder } from "@/lib/bitget-client"

export async function POST(request: Request) {
  if ((process.env.WAKE_EXECUTION_MODE ?? "paper") !== "bitget-demo") {
    return Response.json({ error: "WAKE is in paper mode. Set WAKE_EXECUTION_MODE=bitget-demo to enable Bitget Demo Trading." }, { status: 409 })
  }

  try {
    const input = await request.json() as { symbol?: string; side?: "buy" | "sell"; tradeSide?: "open" | "close"; posSide?: "long" | "short"; size?: string; clientOid?: string }
    const symbol = (input.symbol || "").toUpperCase()
    const size = input.size || ""
    const tradeSide = input.tradeSide || "open"
    if (!/^[A-Z0-9_-]{2,20}$/.test(symbol) || !["buy", "sell"].includes(input.side || "") || !["open", "close"].includes(tradeSide) || (tradeSide === "close" && !input.posSide) || !/^\d+(\.\d+)?$/.test(size) || Number(size) <= 0) {
      return Response.json({ error: "Invalid demo order payload" }, { status: 400 })
    }
    const [contract, mark, account] = await Promise.all([getBitgetContractInfo(symbol), getBitgetMarkSnapshot(symbol), getBitgetDemoAccount()])
    const minimumSize = Number(contract.minTradeNum)
    const sizeMultiplier = Number(contract.sizeMultiplier)
    const requestedSize = Number(size)
    if (!Number.isFinite(minimumSize) || !Number.isFinite(sizeMultiplier) || requestedSize < minimumSize || Math.abs(requestedSize / sizeMultiplier - Math.round(requestedSize / sizeMultiplier)) > 1e-8) {
      return Response.json({ error: "Demo order size does not satisfy Bitget contract limits", contract }, { status: 400 })
    }
    if (requestedSize * mark.markPrice < Number(contract.minTradeUSDT)) return Response.json({ error: "Demo order is below Bitget minimum notional", contract, mark }, { status: 400 })
    const posMode = (account.data as { posMode?: "hedge_mode" | "one_way_mode" } | undefined)?.posMode
    if (posMode === "hedge_mode") {
      if (!input.posSide) return Response.json({ error: "posSide is required for this Demo account's hedge_mode" }, { status: 400 })
      const expectedSide = input.posSide === "long" ? "buy" : "sell"
      if (input.side !== expectedSide) return Response.json({ error: "side does not match posSide for hedge_mode", expectedSide }, { status: 400 })
    }
    if (posMode === "one_way_mode" && input.posSide) return Response.json({ error: "posSide is not accepted for one_way_mode" }, { status: 400 })
    const payload = await placeBitgetDemoOrder({
      symbol,
      side: input.side as "buy" | "sell",
      tradeSide,
      posSide: input.posSide,
      reduceOnly: posMode === "one_way_mode" && tradeSide === "close" ? "YES" : undefined,
      size,
      clientOid: (input.clientOid || `wake-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32),
    })
    return Response.json({ source: "bitget-demo", preflight: { contract, mark, posMode }, payload })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Bitget Demo order failed" }, { status: 502 })
  }
}
