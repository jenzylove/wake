import { getBitgetMarkSnapshot } from "@/lib/bitget-client"

export async function GET(request: Request) {
  const symbol = (new URL(request.url).searchParams.get("symbol") || "BTCUSDT").toUpperCase()
  if (!/^[A-Z0-9_-]{2,20}$/.test(symbol)) return Response.json({ error: "Use a valid Bitget symbol" }, { status: 400 })

  try {
    return Response.json(await getBitgetMarkSnapshot(symbol))
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Market snapshot request failed" }, { status: 502 })
  }
}
