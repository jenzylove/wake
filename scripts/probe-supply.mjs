// Frequency probe: run the supply detector over the last N hours of Ethereum blocks without
// deciding or trading, and report how many deposits exist and how many would clear the cost bar.
// Usage: node scripts/probe-supply.mjs [hours=24]
import { WATCHED, rpc } from "../lib/chain-watch.mjs"
import { LABELLED_HUBS, SUPPLY_TOKENS, findDeposits, hubCandidates, roundTripCost, supplyImpactPct, supplyMinEdgePct } from "../lib/supply-watch.mjs"
import { computePositionSizing } from "../lib/sizing.mjs"

const chain = WATCHED["1"]
const call = (m, p) => rpc(chain.rpc, m, p, 3, chain.fallbacks)
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
const hours = Number(process.argv[2] || 24)
const j = async (u) => (await fetch(u, { signal: AbortSignal.timeout(30_000) })).json()

const px = {}, mk = {}
for (const t of Object.values(SUPPLY_TOKENS)) {
  px[t.symbol] = Number((await j(`https://api.bitget.com/api/v2/mix/market/symbol-price?symbol=${t.instrument}&productType=USDT-FUTURES`)).data[0].markPrice)
  const c = (await j(`https://api.bitget.com/api/v2/mix/market/candles?symbol=${t.instrument}&productType=USDT-FUTURES&granularity=1H&limit=72`)).data
    .map((k) => ({ high: +k[2], low: +k[3], close: +k[4], quoteVolume: +k[6] }))
  const r = c.slice(1).map((k, i) => Math.log(k.close / c[i].close)); const m = r.reduce((a, b) => a + b, 0) / r.length
  const sd = Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1)) * Math.sqrt(24)
  await new Promise((r) => setTimeout(r, 2500))
  const cg = await j(`https://api.coingecko.com/api/v3/simple/price?ids=${t.coingecko}&vs_currencies=usd&include_24hr_vol=true`)
  const sizing = computePositionSizing({ windowSigma: sd, quoteVolumeUsd: c.slice(-24).reduce((a, k) => a + k.quoteVolume, 0), candles: c })
  const tk = (await j(`https://api.bitget.com/api/v2/mix/market/ticker?symbol=${t.instrument}&productType=USDT-FUTURES`)).data[0]
  mk[t.symbol] = { sigma: sd, vol: cg[t.coingecko]?.usd_24h_vol, minEdge: supplyMinEdgePct(roundTripCost({ bid: +tk.bidPr, ask: +tk.askPr })) }
}
console.log("market", JSON.stringify(mk))
const head = Number(await call("eth_blockNumber", []))
const from = head - Math.ceil(hours * 300)
const tx = []
for (let s = from, step = 50; s <= head; s += step) {
  let logs
  try { logs = await call("eth_getLogs", [{ address: Object.keys(SUPPLY_TOKENS), topics: [TRANSFER], fromBlock: `0x${s.toString(16)}`, toBlock: `0x${Math.min(s + step - 1, head).toString(16)}` }]) }
  catch (e) { if (step > 10) { step = Math.floor(step / 2); s -= step; continue } throw e }
  if (!Array.isArray(logs)) { s -= step; continue }
  for (const l of logs) {
    if (l.topics.length !== 3) continue
    const meta = SUPPLY_TOKENS[l.address.toLowerCase()]
    const amount = Number(BigInt(l.data === "0x" ? "0x0" : l.data)) / 1e18
    const usd = amount * px[meta.symbol]
    if (usd >= 50_000) tx.push({ token: l.address.toLowerCase(), symbol: meta.symbol, amount, usd, from: `0x${l.topics[1].slice(26)}`, to: `0x${l.topics[2].slice(26)}`, tx: l.transactionHash, block: Number(l.blockNumber) })
  }
}
const hubs = Object.fromEntries(Object.entries(LABELLED_HUBS).map(([a, x]) => [a, { exchange: x, source: "label" }]))
for (const a of hubCandidates(tx)) {
  if (hubs[a]) continue
  const code = await call("eth_getCode", [a, "latest"])
  if (!code || code === "0x") hubs[a] = { exchange: "inferred", source: "inferred" }
}
const deps = findDeposits(tx, hubs)
console.log({ hours, blocks: head - from, transfers: tx.length, hubs: Object.keys(hubs).length, deposits: deps.length })
for (const d of deps.slice(0, 25)) {
  const m = mk[d.symbol]
  const imp = supplyImpactPct({ usd: d.usd, dailyVolumeUsd: m.vol, dailySigma: m.sigma })
  console.log(`${d.symbol.padEnd(4)} $${Math.round(d.usd).toLocaleString().padStart(12)} ${d.exchange.padEnd(9)} impact ${imp}% bar ${m.minEdge}% ${imp >= m.minEdge ? "CLEARS" : ""}`)
}
