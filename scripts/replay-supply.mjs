// Replay persisted, point-in-time SUPPLY_TO_EXCHANGE decisions without re-running Claude or
// changing the live gates. The event record is the decision snapshot; Bitget historical candles
// are only used to mark the subsequent, explicitly modelled outcome.
//
// Usage:
//   node scripts/replay-supply.mjs --as-of 2026-09-22T10:45:00Z
//   node scripts/replay-supply.mjs --as-of 2026-09-22T10:45:00Z --out data/replays/supply.json
//
// A replay is not an execution receipt. Rejected records get a counterfactual mark only; they
// are never included in strategy P&L. A trade outcome is counted only when the persisted record
// already passed the unchanged gates and the requested holding horizon is complete.

import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const root = process.cwd()
const inputDir = path.join(root, "data", "live")
const arg = (name, fallback = null) => {
  const prefix = `${name}=`
  const hit = process.argv.find((x) => x === name || x.startsWith(prefix))
  if (!hit) return fallback
  return hit === name ? process.argv[process.argv.indexOf(hit) + 1] ?? fallback : hit.slice(prefix.length)
}
const asOfRaw = arg("--as-of")
if (!asOfRaw || !Number.isFinite(Date.parse(asOfRaw))) throw new Error("--as-of must be an ISO timestamp; a moving 'now' replay is not reproducible")
const asOfMs = Date.parse(asOfRaw)
const holdHours = Number(arg("--hold-hours", "18"))
if (!(holdHours > 0 && holdHours <= 18)) throw new Error("--hold-hours must be between 0 and the unchanged 18-hour maximum")
const outPath = arg("--out", path.join(root, "data", "replays", `supply-${asOfRaw.replace(/[:.]/g, "-")}.json`))

const sha256 = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex")
const json = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  const body = await response.json()
  if (!response.ok || body.code && body.code !== "00000") throw new Error(body.msg || `HTTP ${response.status}`)
  return body
}

function records() {
  if (!existsSync(inputDir)) return []
  return readdirSync(inputDir)
    .filter((name) => name.startsWith("live-") && name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(path.join(inputDir, name), "utf8")))
    .filter((record) => record.eventClass === "SUPPLY_TO_EXCHANGE")
    .filter((record) => Date.parse(record.detectedAt) <= asOfMs)
    .sort((a, b) => Date.parse(a.detectedAt) - Date.parse(b.detectedAt))
}

async function historicalCandles(record) {
  const symbol = record.instrument
  if (!symbol) return { candles: [], source: null, error: "missing instrument" }
  const start = Date.parse(record.detectedAt) - 72 * 3_600_000
  const end = Math.min(asOfMs, Date.parse(record.detectedAt) + holdHours * 3_600_000 + 3_600_000)
  const params = new URLSearchParams({ symbol, productType: "USDT-FUTURES", granularity: "1H", startTime: String(start), endTime: String(end), limit: "200" })
  const source = `https://api.bitget.com/api/v2/mix/market/history-candles?${params}`
  try {
    const body = await json(source)
    const candles = (body.data ?? []).map((k) => ({
      timestamp: Number(k[0]), open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), quoteVolume: Number(k[6]),
    })).filter((c) => Number.isFinite(c.timestamp) && c.close > 0).sort((a, b) => a.timestamp - b.timestamp)
    return { candles, source, requestTime: body.requestTime ?? null, error: null }
  } catch (error) {
    return { candles: [], source, requestTime: null, error: String(error.message ?? error) }
  }
}

function outcome(record, candles) {
  const eventMs = Date.parse(record.detectedAt)
  const targetMs = eventMs + holdHours * 3_600_000
  const future = candles.filter((c) => c.timestamp >= eventMs && c.timestamp <= asOfMs)
  const entry = future[0]
  if (!entry) return { status: "UNAVAILABLE", reason: "no closed candle at or after event", candlesUsed: 0 }
  if (asOfMs < targetMs) return { status: "INCOMPLETE", reason: "holding horizon is not complete at replay as-of", candlesUsed: future.length, entryPrice: entry.open }
  if ((future.at(-1)?.timestamp ?? 0) < targetMs) return { status: "INCOMPLETE", reason: "historical market candles do not cover the requested holding horizon", candlesUsed: future.length, entryPrice: entry.open }
  const path = future.filter((c) => c.timestamp <= targetMs)
  const notional = Number(record.sizing?.notionalUsd ?? 0)
  const stopPct = Number(record.sizing?.stopPct ?? 0)
  const costPct = Number(record.market?.roundTripCostPct ?? 0) / 100
  let exit = path[path.length - 1]
  let exitPrice = exit.close
  let exitReason = "time horizon"
  if (stopPct > 0) {
    const stop = entry.open * (1 + stopPct)
    const hit = path.find((c) => c.high >= stop)
    if (hit) { exit = hit; exitPrice = stop; exitReason = "stop" }
  }
  const grossPnl = notional > 0 ? notional * ((entry.open - exitPrice) / entry.open) : null
  const netPnl = grossPnl === null ? null : Number((grossPnl - notional * costPct).toFixed(4))
  return { status: "COMPLETE", entryAt: new Date(entry.timestamp).toISOString(), entryPrice: entry.open,
    exitAt: new Date(exit.timestamp).toISOString(), exitPrice, exitReason, grossPnl, costPct, netPnl, candlesUsed: path.length }
}

async function main() {
  const sourceRecords = records()
  const replayed = []
  for (const record of sourceRecords) {
    const market = await historicalCandles(record)
    const mark = outcome(record, market.candles)
    const passed = record.agent?.gatePassed === true && record.decision === "TRADE_DIRECT"
    replayed.push({
      id: record.id, eventClass: record.eventClass, detectedAt: record.detectedAt, sourceIntegrity: record.integrity,
      decision: record.decision, gatePassed: Boolean(record.agent?.gatePassed), instrument: record.instrument,
      rejection: passed ? null : { decision: record.decision, refusals: record.refusals ?? [], aiAction: record.aiDecision?.action ?? null },
      outcome: passed ? mark : null,
      counterfactualShort: passed ? null : mark,
      marketSnapshot: { roundTripCostPct: record.market?.roundTripCostPct ?? null, modeledDeltaPct: record.modeledDeltaPct ?? null, marketDeltaPct: record.marketDeltaPct ?? null, minEdgePct: record.minEdgePct ?? null },
      historicalMarket: { source: market.source, candles: market.candles, error: market.error },
    })
  }
  const trades = replayed.filter((r) => r.outcome?.status === "COMPLETE")
  const losses = trades.filter((r) => r.outcome.netPnl < 0)
  const counterfactualLosses = replayed.filter((r) => r.counterfactualShort?.status === "COMPLETE" && r.counterfactualShort.netPnl < 0)
  const snapshot = {
    schema: "wake.supply.replay.v1", replayType: "POINT_IN_TIME", asOf: new Date(asOfMs).toISOString(), holdHours,
    inputs: { sourceDirectory: "data/live", sourceRecordCount: sourceRecords.length, sourceRecordIds: sourceRecords.map((r) => r.id),
      decisionAndGateSource: "persisted event record; no Claude call and no gate changes during replay" },
    records: replayed,
    summary: { sourceRecords: sourceRecords.length, rejected: replayed.filter((r) => !r.gatePassed).length, gatePassed: replayed.filter((r) => r.gatePassed).length,
      completedStrategyTrades: trades.length, losingStrategyTrades: losses.length, completedCounterfactuals: replayed.filter((r) => r.counterfactualShort?.status === "COMPLETE").length,
      losingCounterfactuals: counterfactualLosses.length, incomplete: replayed.filter((r) => ["INCOMPLETE", "UNAVAILABLE"].includes(r.counterfactualShort?.status)).length },
    reproducibility: { command: `node scripts/replay-supply.mjs --as-of ${new Date(asOfMs).toISOString()} --hold-hours ${holdHours} --out ${path.relative(root, outPath).replaceAll("\\", "/")}` },
  }
  snapshot.integrity = sha256({ ...snapshot, integrity: undefined })
  mkdirSync(path.dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + "\n")
  console.log(JSON.stringify({ out: path.relative(root, outPath), integrity: snapshot.integrity, summary: snapshot.summary }, null, 2))
}

main().catch((error) => { console.error(error); process.exit(1) })
