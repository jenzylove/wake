import https from "node:https"

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

export type BitgetMarketSnapshot = {
  symbol: string
  markPrice: number
  capturedAt: string
  source: "bitget-public-ticker"
}

export type BitgetContractInfo = {
  symbol: string
  minTradeNum: string
  sizeMultiplier: string
  minTradeUSDT: string
  volumePlace: string
  pricePlace: string
}

export type BitgetDemoOrderInput = {
  symbol: string
  side: "buy" | "sell"
  tradeSide: "open" | "close"
  posSide?: "long" | "short"
  reduceOnly?: "YES" | "NO"
  size: string
  clientOid: string
}

type BitgetEnvelope<T> = {
  code: string
  msg: string
  requestTime?: number
  data: T
}

type BitgetHttpMethod = "GET" | "POST"

const BITGET_TIMEOUT_MS = Number(process.env.BITGET_TIMEOUT_MS || 10000)

// DNS is the default path. BITGET_API_IP is an explicit opt in for networks that
// cannot resolve api.bitget.com; it pins a single edge address, so it must never
// be the default. A stale pinned address takes every market surface down at once.
async function bitgetFetch(url: string, init: RequestInit = {}) {
  const bitgetIp = process.env.BITGET_API_IP?.trim()
  if (!bitgetIp) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), BITGET_TIMEOUT_MS)
    try {
      return await fetch(url, { ...init, signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
  }
  const parsed = new URL(url)
  const headers = Object.fromEntries(new Headers(init.headers).entries())
  headers.Host = parsed.hostname
  return new Promise<Response>((resolve, reject) => {
    const request = https.request({
      hostname: bitgetIp,
      port: 443,
      servername: parsed.hostname,
      path: `${parsed.pathname}${parsed.search}`,
      method: init.method || "GET",
      headers,
      timeout: BITGET_TIMEOUT_MS,
    }, (response) => {
      const chunks: Buffer[] = []
      response.on("data", (chunk: Buffer) => chunks.push(chunk))
      response.on("end", () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode || 502, headers: response.headers as Record<string, string> })))
    })
    request.on("timeout", () => request.destroy(new Error(`Bitget request timed out after ${BITGET_TIMEOUT_MS}ms`)))
    request.on("error", reject)
    if (typeof init.body === "string") request.write(init.body)
    request.end()
  })
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
  const response = await bitgetFetch(`${BITGET_API_BASE}${path}?${queryString}`, {
    headers: { "Content-Type": "application/json", locale: "en-US" },
  })
  const payload = await response.json() as BitgetEnvelope<T>
  if (!response.ok || payload.code !== "00000") {
    throw new Error(`Bitget public request failed: ${payload.msg || response.statusText}`)
  }
  return payload.data
}

function bitgetCredentials() {
  const apiKey = process.env.BITGET_API_KEY
  const secretKey = process.env.BITGET_SECRET_KEY
  const passphrase = process.env.BITGET_PASSPHRASE
  if (!apiKey || !secretKey || !passphrase) {
    throw new Error("Bitget demo credentials are not configured")
  }
  return { apiKey, secretKey, passphrase }
}

async function signedBitget<T>(method: BitgetHttpMethod, path: string, body = "") {
  const { apiKey, secretKey, passphrase } = bitgetCredentials()
  const timestamp = String(Date.now())
  const signature = await sign(`${timestamp}${method}${path}${body}`, secretKey)
  const response = await bitgetFetch(`${BITGET_API_BASE}${path}`, {
    method,
    headers: {
      "ACCESS-KEY": apiKey,
      "ACCESS-SIGN": signature,
      "ACCESS-TIMESTAMP": timestamp,
      "ACCESS-PASSPHRASE": passphrase,
      "Content-Type": "application/json",
      locale: "en-US",
      paptrading: "1",
    },
    body: method === "POST" ? body : undefined,
  })
  const payload = await response.json() as BitgetEnvelope<T>
  if (!response.ok || payload.code !== "00000") {
    throw new Error(`Bitget demo request failed: ${payload.msg || response.statusText}`)
  }
  return payload
}

export async function getBitgetDemoAccount() {
  return signedBitget<unknown>(
    "GET",
    "/api/v2/mix/account/account?marginCoin=USDT&productType=USDT-FUTURES&symbol=BTCUSDT",
  )
}

/** Open Demo positions as the exchange reports them: its own average entry, mark and PnL. */
export async function getBitgetDemoPositions() {
  return signedBitget<unknown>(
    "GET",
    "/api/v2/mix/position/all-position?productType=USDT-FUTURES&marginCoin=USDT",
  )
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
  const captured: BitgetCandle[] = []
  let pageEnd = endTime
  let reachedStart = false
  for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
    const rows = await readBitget<string[][]>("/api/v2/mix/market/history-mark-candles", {
      symbol,
      productType: "USDT-FUTURES",
      granularity,
      startTime,
      endTime: pageEnd,
      limit: Math.min(limit, 200),
    })
    const page = rows.map(([timestamp, open, high, low, close, baseVolume, quoteVolume]) => ({
      timestamp: Number(timestamp),
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      baseVolume: Number(baseVolume),
      quoteVolume: Number(quoteVolume),
    } satisfies BitgetCandle))
    if (page.length === 0) break
    captured.push(...page)
    const oldest = Math.min(...page.map((candle) => candle.timestamp))
    if (oldest <= startTime) {
      reachedStart = true
      break
    }
    if (oldest >= pageEnd) throw new Error("Bitget returned a non-advancing candle page")
    pageEnd = oldest - 1
  }
  if (!reachedStart) throw new Error("Bitget market response did not cover the requested start time")
  return [...new Map(captured.filter((candle) => candle.timestamp >= startTime && candle.timestamp < endTime).map((candle) => [candle.timestamp, candle])).values()]
    .sort((left, right) => left.timestamp - right.timestamp)
}

export async function getBitgetMarkSnapshot(symbol: string): Promise<BitgetMarketSnapshot> {
  const rows = await readBitget<Array<{ symbol?: string; markPrice?: string; lastPr?: string }>>("/api/v2/mix/market/ticker", {
    symbol,
    productType: "USDT-FUTURES",
  })
  const row = rows[0]
  const markPrice = Number(row?.markPrice || row?.lastPr)
  if (!row || !Number.isFinite(markPrice) || markPrice <= 0) throw new Error("Bitget returned no valid mark price")
  return { symbol, markPrice, capturedAt: new Date().toISOString(), source: "bitget-public-ticker" }
}

export async function getBitgetContractInfo(symbol: string): Promise<BitgetContractInfo> {
  const rows = await readBitget<Array<Record<string, string>>>('/api/v2/mix/market/contracts', {
    productType: "USDT-FUTURES",
    symbol,
  })
  const row = rows[0]
  if (!row) throw new Error("Bitget returned no contract metadata")
  return {
    symbol,
    minTradeNum: row.minTradeNum || row.minTradeSize || "",
    sizeMultiplier: row.sizeMultiplier || "",
    minTradeUSDT: row.minTradeUSDT || "",
    volumePlace: row.volumePlace || "",
    pricePlace: row.pricePlace || "",
  }
}

export async function placeBitgetDemoOrder(input: BitgetDemoOrderInput) {
  if ((process.env.WAKE_EXECUTION_MODE ?? "paper") !== "bitget-demo") {
    throw new Error("WAKE is in paper mode; Bitget Demo execution is disabled")
  }

  const path = "/api/v2/mix/order/place-order"
  const body = JSON.stringify({
    symbol: input.symbol,
    productType: "USDT-FUTURES",
    marginMode: "isolated",
    marginCoin: "USDT",
    size: input.size,
    side: input.side,
    tradeSide: input.tradeSide,
    ...(input.posSide ? { posSide: input.posSide } : {}),
    ...(input.reduceOnly ? { reduceOnly: input.reduceOnly } : {}),
    orderType: "market",
    force: "gtc",
    clientOid: input.clientOid,
  })
  return signedBitget<unknown>("POST", path, body)
}

export function bitgetConfigStatus() {
  return {
    executionMode: process.env.WAKE_EXECUTION_MODE ?? "paper",
    marketData: "public",
    demoCredentialsConfigured: Boolean(process.env.BITGET_API_KEY && process.env.BITGET_SECRET_KEY && process.env.BITGET_PASSPHRASE),
    liveTradingEnabled: false,
  }
}
