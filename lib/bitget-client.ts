const BITGET_API_BASE = "https://api.bitget.com"

export type BitgetCandle = {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  baseVolume: number
  quoteVolume: number
}

export type BitgetDemoOrderInput = {
  symbol: string
  side: "buy" | "sell"
  size: string
  clientOid: string
}

type BitgetEnvelope<T> = {
  code: string
  msg: string
  requestTime?: number
  data: T
}

function sortedQuery(params: Record<string, string | number | undefined>) {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&")
}

function base64(bytes: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
}

async function sign(message: string, secretKey: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secretKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  return base64(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)))
}

async function readBitget<T>(path: string, query: Record<string, string | number | undefined>) {
  const queryString = sortedQuery(query)
  const response = await fetch(`${BITGET_API_BASE}${path}?${queryString}`, {
    headers: { "Content-Type": "application/json", locale: "en-US" },
  })
  const payload = await response.json() as BitgetEnvelope<T>
  if (!response.ok || payload.code !== "00000") {
    throw new Error(`Bitget public request failed: ${payload.msg || response.statusText}`)
  }
  return payload.data
}

export async function getHistoricalMarkCandles({
  symbol,
  startTime,
  endTime,
  granularity = "1m",
  limit = 1000,
}: {
  symbol: string
  startTime: number
  endTime: number
  granularity?: string
  limit?: number
}) {
  const rows = await readBitget<string[][]>("/api/v2/mix/market/history-mark-candles", {
    symbol,
    productType: "USDT-FUTURES",
    granularity,
    startTime,
    endTime,
    limit,
  })
  return rows.map(([timestamp, open, high, low, close, baseVolume, quoteVolume]) => ({
    timestamp: Number(timestamp),
    open: Number(open),
    high: Number(high),
    low: Number(low),
    close: Number(close),
    baseVolume: Number(baseVolume),
    quoteVolume: Number(quoteVolume),
  } satisfies BitgetCandle))
}

export async function placeBitgetDemoOrder(input: BitgetDemoOrderInput) {
  const apiKey = process.env.BITGET_API_KEY
  const secretKey = process.env.BITGET_SECRET_KEY
  const passphrase = process.env.BITGET_PASSPHRASE
  if (!apiKey || !secretKey || !passphrase) {
    throw new Error("Bitget demo credentials are not configured")
  }

  const path = "/api/v2/mix/order/place-order"
  const body = JSON.stringify({
    symbol: input.symbol,
    productType: "USDT-FUTURES",
    marginMode: "isolated",
    marginCoin: "USDT",
    size: input.size,
    side: input.side,
    tradeSide: "open",
    orderType: "market",
    force: "gtc",
    clientOid: input.clientOid,
  })
  const timestamp = String(Date.now())
  const signature = await sign(`${timestamp}POST${path}${body}`, secretKey)
  const response = await fetch(`${BITGET_API_BASE}${path}`, {
    method: "POST",
    headers: {
      "ACCESS-KEY": apiKey,
      "ACCESS-SIGN": signature,
      "ACCESS-TIMESTAMP": timestamp,
      "ACCESS-PASSPHRASE": passphrase,
      "Content-Type": "application/json",
      "locale": "en-US",
      "paptrading": "1",
    },
    body,
  })
  const payload = await response.json() as BitgetEnvelope<unknown>
  if (!response.ok || payload.code !== "00000") {
    throw new Error(`Bitget demo order failed: ${payload.msg || response.statusText}`)
  }
  return payload
}

export function bitgetConfigStatus() {
  return {
    executionMode: process.env.WAKE_EXECUTION_MODE ?? "paper",
    marketData: "public",
    demoCredentialsConfigured: Boolean(process.env.BITGET_API_KEY && process.env.BITGET_SECRET_KEY && process.env.BITGET_PASSPHRASE),
    liveTradingEnabled: false,
  }
}
