import { getBitgetContractInfo } from "@/lib/bitget-client"

export async function GET(request: Request) {
  const symbol = new URL(request.url).searchParams.get("symbol")?.toUpperCase() || "BTCUSDT"
  if (!/^[A-Z0-9_-]{2,20}$/.test(symbol)) return Response.json({ error: "Invalid symbol" }, { status: 400 })
  try {
    return Response.json({ source: "bitget-public-contracts", contract: await getBitgetContractInfo(symbol) })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Contract lookup failed" }, { status: 502 })
  }
}
