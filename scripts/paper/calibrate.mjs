import { readFileSync } from "node:fs"
import { evaluate, isEligible, CONFIG } from "./strategy.mjs"

const j = JSON.parse(readFileSync(process.argv[2], "utf8"))
const rows = j.data
const eligible = rows.filter(isEligible)
console.log("total symbols:", rows.length, "| eligible perps:", eligible.length)

const liquid = eligible.filter((r) => Number(r.usdtVolume) >= CONFIG.minUsdtVolume24h)
console.log("liquid (>= $" + CONFIG.minUsdtVolume24h.toLocaleString() + " 24h):", liquid.length)

const stats = liquid.map((r) => ({
  basis: Math.abs((Number(r.markPrice) - Number(r.indexPrice)) / Number(r.indexPrice)),
  fund: Math.abs(Number(r.fundingRate) || 0),
  spread: (Number(r.askPr) - Number(r.bidPr)) / ((Number(r.askPr) + Number(r.bidPr)) / 2),
}))
const pct = (arr, p) => { const a = [...arr].sort((x, y) => x - y); return a[Math.floor(a.length * p)] ?? 0 }
const fmt = (arr) => [0.5, 0.75, 0.9, 0.99].map((p) => (pct(arr, p) * 1e4).toFixed(2)).join(" / ")
console.log("|basis|   bps p50/p75/p90/p99:", fmt(stats.map((x) => x.basis)))
console.log("|funding| bps p50/p75/p90/p99:", fmt(stats.map((x) => x.fund)))
console.log("spread    bps p50/p75/p90/p99:", fmt(stats.map((x) => x.spread)))

const res = liquid.map((r) => evaluate(r, { equityUsd: 100000, openSymbols: new Set(), openCount: 0, now: Date.now() }))
const fired = res.filter((r) => r.decision === "TRADE_DISLOCATION")
const byReason = {}
for (const r of res.filter((x) => x.decision === "NO_TRADE")) byReason[r.reason] = (byReason[r.reason] || 0) + 1
console.log("\n--- current thresholds ---")
console.log("basisTrigger", (CONFIG.basisTriggerRate * 1e4).toFixed(1), "bps | fundingTrigger", (CONFIG.fundingTriggerRate * 1e4).toFixed(1), "bps | minResidual", (CONFIG.minResidualRate * 1e4).toFixed(1), "bps | maxSpread", (CONFIG.maxSpreadRate * 1e4).toFixed(1), "bps")
console.log("FIRED this tick:", fired.length)
console.log("abstain reasons:", JSON.stringify(byReason))
for (const f of fired.slice(0, 10)) {
  console.log("  " + f.symbol.padEnd(14), f.side.padEnd(5), "basis", (f.observed.basisRate * 1e4).toFixed(1).padStart(7), "bps  fund", (f.observed.fundingRate * 1e4).toFixed(1).padStart(6), "bps  modeled", (f.model.modeledRate * 1e4).toFixed(1).padStart(6), "bps  cost", (f.model.cost.total * 1e4).toFixed(1).padStart(5), "bps  resid", (f.model.residualRate * 1e4).toFixed(1).padStart(6), "bps")
}
