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
if (!/^\d+$/.test(chainId)) throw new Error("chain-id must be a numeric EVM chain id")
if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) throw new Error("tx must be a 32-byte transaction hash")
if (!/^[A-Z0-9_-]{2,20}$/.test(symbol)) throw new Error("symbol is invalid")
if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime >= endTime) throw new Error("start and end must be valid millisecond timestamps")
if (endTime - startTime > 90 * 24 * 60 * 60 * 1000) throw new Error("Bitget capture windows cannot exceed 90 days")

const receipt = await fetchReceipt(chainId, txHash)
const blockTimestamp = await fetchBlockTimestamp(chainId, receipt)
const candles = await fetchBitgetCandles(symbol, startTime, endTime)
const packet = {
  schema: "wake.historical-capture.v1",
  capturedAt: new Date().toISOString(),
  incident: { id: incident, chainId, txHash, blockTimestamp },
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
  const rpcUrl = process.env[`CHAIN_RPC_URL_${chain}`] || publicRpcForChain(chain) || process.env.CHAIN_RPC_URL
  if (rpcUrl) {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [tx] }),
    })
    const payload = await response.json()
    if (!response.ok || payload.error) throw new Error(payload.error?.message || "RPC receipt request failed")
    if (!payload.result) throw new Error("Transaction receipt was not found")
    if (payload.result.transactionHash && payload.result.transactionHash.toLowerCase() !== tx.toLowerCase()) throw new Error("RPC returned a receipt for a different transaction")
    return payload.result
  }
  if (!process.env.ETHERSCAN_API_KEY) throw new Error("Set CHAIN_RPC_URL or ETHERSCAN_API_KEY before capturing chain evidence")
  const url = new URL("https://api.etherscan.io/v2/api")
  url.search = new URLSearchParams({ chainid: chain, module: "proxy", action: "eth_getTransactionReceipt", txhash: tx, apikey: process.env.ETHERSCAN_API_KEY }).toString()
  const response = await fetch(url)
  const payload = await response.json()
  if (!response.ok || !payload.result) throw new Error(payload.message || "Etherscan receipt request failed")
  if (payload.result.transactionHash && payload.result.transactionHash.toLowerCase() !== tx.toLowerCase()) throw new Error("Explorer returned a receipt for a different transaction")
  return payload.result
}

async function fetchBlockTimestamp(chain, receipt) {
  const logTimestamp = receipt.logs?.find((log) => log.blockTimestamp)?.blockTimestamp
  if (logTimestamp) return Number.parseInt(logTimestamp, 16)
  const rpcUrl = process.env[`CHAIN_RPC_URL_${chain}`] || publicRpcForChain(chain) || process.env.CHAIN_RPC_URL
  if (!rpcUrl || !receipt.blockNumber) throw new Error("The receipt has no timestamp and no chain RPC is available for block metadata")
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "eth_getBlockByNumber", params: [receipt.blockNumber, false] }),
  })
  const payload = await response.json()
  if (!response.ok || payload.error || !payload.result?.timestamp) throw new Error(payload.error?.message || "Block timestamp request failed")
  return Number.parseInt(payload.result.timestamp, 16)
}

function publicRpcForChain(chain) {
  return {
    "1": "https://ethereum.publicnode.com",
    "8453": "https://mainnet.base.org",
    "42161": "https://arb1.arbitrum.io/rpc",
  }[chain]
}

async function fetchBitgetCandles(pair, start, end) {
  const captured = []
  let pageEnd = end
  let reachedStart = false
  for (let pageNumber = 0; pageNumber < 700; pageNumber += 1) {
    const url = new URL("https://api.bitget.com/api/v2/mix/market/history-mark-candles")
    url.search = new URLSearchParams({ symbol: pair, productType: "USDT-FUTURES", granularity: "1m", startTime: String(start), endTime: String(pageEnd), limit: "200" }).toString()
    const response = await fetch(url)
    const payload = await response.json()
    if (!response.ok || payload.code !== "00000") throw new Error(payload.msg || "Bitget historical market request failed")
    const page = (payload.data || []).map(([timestamp, open, high, low, close, baseVolume, quoteVolume]) => ({ timestamp: Number(timestamp), open: Number(open), high: Number(high), low: Number(low), close: Number(close), baseVolume: Number(baseVolume), quoteVolume: Number(quoteVolume) }))
    if (page.length === 0) break
    captured.push(...page)
    const oldest = Math.min(...page.map((candle) => candle.timestamp))
    if (oldest <= start) {
      reachedStart = true
      break
    }
    if (oldest >= pageEnd) throw new Error("Bitget returned a non-advancing candle page")
    pageEnd = oldest - 1
  }
  if (!reachedStart) throw new Error("Bitget market capture was incomplete before reaching the requested start time")
  const unique = new Map(captured.filter((candle) => candle.timestamp >= start && candle.timestamp <= end).map((candle) => [candle.timestamp, candle]))
  const candles = [...unique.values()].sort((left, right) => left.timestamp - right.timestamp)
  if (candles.length === 0) throw new Error("Bitget returned no candles for the requested window")
  return candles
}
