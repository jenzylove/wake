import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

const args = new Map()
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index]
  const value = process.argv[index + 1]
  if (!key?.startsWith("--") || !value) throw new Error(`Expected a value after ${key || "the final argument"}`)
  args.set(key.slice(2), value)
}

const incident = required("incident")
const chainId = required("chain-id")
const txHash = required("tx")
const symbol = required("symbol").toUpperCase()
const startTime = Number(required("start"))
const endTime = Number(required("end"))
if (!/^INC-[A-Z0-9-]+$/i.test(incident)) throw new Error("incident must look like INC-REAL-001")
if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) throw new Error("tx must be a 32-byte transaction hash")
if (!/^[A-Z0-9_-]{2,20}$/.test(symbol)) throw new Error("symbol is invalid")
if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime >= endTime) throw new Error("start and end must be valid millisecond timestamps")
if (endTime - startTime > 90 * 24 * 60 * 60 * 1000) throw new Error("Bitget capture windows cannot exceed 90 days")

const receipt = await fetchReceipt(chainId, txHash)
const candles = await fetchBitgetCandles(symbol, startTime, endTime)
const packet = {
  schema: "wake.historical-capture.v1",
  capturedAt: new Date().toISOString(),
  incident: { id: incident, chainId, txHash },
  sources: {
    chain: process.env.CHAIN_RPC_URL ? "json-rpc" : "etherscan-v2",
    market: "bitget-public-history-mark-candles",
  },
  receipt,
  market: { symbol, startTime, endTime, candles },
}
const canonical = JSON.stringify(packet)
const integrity = createHash("sha256").update(canonical).digest("hex")
const outputDirectory = path.resolve("data", "incidents")
const outputPath = path.join(outputDirectory, `${incident.toLowerCase()}.json`)
await mkdir(outputDirectory, { recursive: true })
await writeFile(outputPath, JSON.stringify({ ...packet, integrity }, null, 2) + "\n", "utf8")
console.log(JSON.stringify({ outputPath, incident, txHash, symbol, candles: candles.length, integrity }, null, 2))

function required(name) {
  const value = args.get(name)
  if (!value) throw new Error(`Missing --${name}`)
  return value
}

async function fetchReceipt(chain, tx) {
  if (process.env.CHAIN_RPC_URL) {
    const response = await fetch(process.env.CHAIN_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [tx] }),
    })
    const payload = await response.json()
    if (!response.ok || payload.error) throw new Error(payload.error?.message || "RPC receipt request failed")
    if (!payload.result) throw new Error("Transaction receipt was not found")
    return payload.result
  }
  if (!process.env.ETHERSCAN_API_KEY) throw new Error("Set CHAIN_RPC_URL or ETHERSCAN_API_KEY before capturing chain evidence")
  const url = new URL("https://api.etherscan.io/v2/api")
  url.search = new URLSearchParams({ chainid: chain, module: "proxy", action: "eth_getTransactionReceipt", txhash: tx, apikey: process.env.ETHERSCAN_API_KEY }).toString()
  const response = await fetch(url)
  const payload = await response.json()
  if (!response.ok || !payload.result) throw new Error(payload.message || "Etherscan receipt request failed")
  return payload.result
}

async function fetchBitgetCandles(pair, start, end) {
  const url = new URL("https://api.bitget.com/api/v2/mix/market/history-mark-candles")
  url.search = new URLSearchParams({ symbol: pair, productType: "USDT-FUTURES", granularity: "1m", startTime: String(start), endTime: String(end), limit: "1000" }).toString()
  const response = await fetch(url)
  const payload = await response.json()
  if (!response.ok || payload.code !== "00000") throw new Error(payload.msg || "Bitget historical market request failed")
  return (payload.data || []).map(([timestamp, open, high, low, close, baseVolume, quoteVolume]) => ({ timestamp: Number(timestamp), open: Number(open), high: Number(high), low: Number(low), close: Number(close), baseVolume: Number(baseVolume), quoteVolume: Number(quoteVolume) }))
}
