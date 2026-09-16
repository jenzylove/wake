import { getHistoricalMarkCandles } from "@/lib/bitget-client"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const symbol = (url.searchParams.get("symbol") || "BTCUSDT").toUpperCase()
  const endTime = Number(url.searchParams.get("endTime") || Date.now())
  const startTime = Number(url.searchParams.get("startTime") || endTime - 24 * 60 * 60 * 1000)
  if (!/^[A-Z0-9_-]{2,20}$/.test(symbol) || !Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime >= endTime) {
    return Response.json({ error: "Use a valid symbol and startTime before endTime" }, { status: 400 })
  }
  if (endTime - startTime > 24 * 60 * 60 * 1000) {
    return Response.json({ error: "The public API route is capped at a 24-hour window; use the authenticated capture CLI for larger evidence jobs" }, { status: 400 })
  }

  try {
    const candles = await getHistoricalMarkCandles({ symbol, startTime, endTime })
    return Response.json({ source: "bitget-public-mark-candles", capturedAt: new Date().toISOString(), symbol, candles })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Market data request failed" }, { status: 502 })
  }
}
