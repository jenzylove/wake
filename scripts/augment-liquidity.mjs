#!/usr/bin/env node
// Attach observed traded liquidity to each incident capture.
//
// The packets store Bitget mark candles, which are derived prices and carry no
// volume. That is fine for measuring what the market did, but it leaves the
// consequence model with no denominator: you cannot ask whether a flow is large
// without knowing what it is large relative to.
//
// This fetches the real traded candles for the same instrument and window from
// the public history-candles endpoint, stores them alongside the mark candles,
// and recomputes the packet hash. Both series are preserved so the packet still
// shows its own workings.

import { createHash } from "node:crypto"
import { readdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

const CANDLES_URL = "https://api.bitget.com/api/v2/mix/market/history-candles"

async function fetchTradeCandles({ symbol, startTime, endTime }) {
  const rows = []
  let cursor = startTime
  // The endpoint pages at 200 rows; walk forward until the window is covered.
  for (let guard = 0; guard < 25 && cursor < endTime; guard += 1) {
    const url = new URL(CANDLES_URL)
    url.search = new URLSearchParams({
      symbol,
      productType: "USDT-FUTURES",
      granularity: "1m",
      startTime: String(cursor),
      endTime: String(endTime),
      limit: "200",
    }).toString()

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20000)
    let payload
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { "Content-Type": "application/json", locale: "en-US" } })
      payload = await response.json()
      if (!response.ok || payload.code !== "00000") throw new Error(`Bitget history-candles failed: ${payload.msg || response.statusText}`)
    } finally {
      clearTimeout(timer)
    }

    const page = payload.data ?? []
    if (page.length === 0) break
    for (const row of page) {
      const ts = Number(row[0])
      if (ts >= startTime && ts < endTime && !rows.some((existing) => existing.timestamp === ts)) {
        rows.push({
          timestamp: ts,
          open: Number(row[1]),
          high: Number(row[2]),
          low: Number(row[3]),
          close: Number(row[4]),
          baseVolume: Number(row[5]),
          quoteVolume: Number(row[6]),
        })
      }
    }
    const lastTs = Number(page[page.length - 1][0])
    if (!Number.isFinite(lastTs) || lastTs + 60000 <= cursor) break
    cursor = lastTs + 60000
  }
  return rows.sort((a, b) => a.timestamp - b.timestamp)
}

/** Realised volatility and traded value, both computed from the observed series. */
function summarise(candles) {
  const closes = candles.map((c) => c.close).filter((v) => Number.isFinite(v) && v > 0)
  const logReturns = []
  for (let i = 1; i < closes.length; i += 1) logReturns.push(Math.log(closes[i] / closes[i - 1]))
  const mean = logReturns.length ? logReturns.reduce((a, b) => a + b, 0) / logReturns.length : 0
  const variance = logReturns.length > 1
    ? logReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / (logReturns.length - 1)
    : 0
  const perMinuteSigma = Math.sqrt(variance)
  const quoteVolumeUsd = candles.reduce((a, c) => a + (Number.isFinite(c.quoteVolume) ? c.quoteVolume : 0), 0)
  return {
    minutes: candles.length,
    perMinuteSigma,
    windowSigma: perMinuteSigma * Math.sqrt(Math.max(candles.length, 1)),
    quoteVolumeUsd,
    baseVolume: candles.reduce((a, c) => a + (Number.isFinite(c.baseVolume) ? c.baseVolume : 0), 0),
  }
}

const dir = path.resolve("data", "incidents")
const files = (await readdir(dir)).filter((name) => name.endsWith(".json")).sort()

for (const name of files) {
  const filePath = path.join(dir, name)
  const parsed = JSON.parse(await readFile(filePath, "utf8"))
  const packet = { ...parsed }
  delete packet.integrity

  const { symbol, startTime, endTime } = packet.market
  const candles = await fetchTradeCandles({ symbol, startTime, endTime })
  if (candles.length === 0) {
    console.error(`${name}: no traded candles returned; packet left unchanged`)
    continue
  }

  const stats = summarise(candles)
  packet.liquidity = {
    source: "bitget-public-history-candles",
    granularity: "1m",
    capturedAt: new Date().toISOString(),
    symbol,
    startTime,
    endTime,
    observed: {
      minutes: stats.minutes,
      quoteVolumeUsd: Number(stats.quoteVolumeUsd.toFixed(2)),
      baseVolume: Number(stats.baseVolume.toFixed(6)),
      perMinuteSigma: Number(stats.perMinuteSigma.toFixed(8)),
      windowSigma: Number(stats.windowSigma.toFixed(8)),
    },
    candles,
  }
  packet.sources = { ...packet.sources, liquidity: "bitget-public-history-candles" }

  const canonical = JSON.stringify(packet)
  const integrity = createHash("sha256").update(canonical).digest("hex")
  await writeFile(filePath, `${JSON.stringify({ ...packet, integrity }, null, 2)}\n`, "utf8")

  console.log(`${name}: ${stats.minutes}m traded volume $${(stats.quoteVolumeUsd / 1e6).toFixed(2)}M, window sigma ${(stats.windowSigma * 100).toFixed(3)}%, hash ${integrity.slice(0, 12)}…`)
}
