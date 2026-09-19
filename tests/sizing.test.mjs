import { test } from "node:test"
import assert from "node:assert/strict"
import { SIZING_CONSTANTS, computePositionSizing, contractSize, estimateSpread } from "../lib/sizing.mjs"
import { executionEligibility } from "../lib/wake-policy.mjs"

const candles = [{ high: 101, low: 99 }, { high: 102, low: 100 }, { high: 101.5, low: 99.5 }]

test("risk-bound sizing loses exactly the risk budget at the stop", () => {
  const z = computePositionSizing({ windowSigma: 0.0045, quoteVolumeUsd: 26_000_000, candles })
  assert.equal(z.computable, true)
  assert.equal(z.bindingConstraint, "risk budget")
  assert.ok(Math.abs(z.maxLossUsd - SIZING_CONSTANTS.equityUsd * SIZING_CONSTANTS.riskFraction) < 1e-6)
})

test("thin windows are bound by liquidity participation, not the risk budget", () => {
  const z = computePositionSizing({ windowSigma: 0.0045, quoteVolumeUsd: 1_000_000, candles })
  assert.equal(z.bindingConstraint, "liquidity participation")
  assert.equal(z.notionalUsd, 1_000_000 * SIZING_CONSTANTS.participationCap)
  assert.ok(z.maxLossUsd < SIZING_CONSTANTS.equityUsd * SIZING_CONSTANTS.riskFraction)
})

test("a venue cap only ever shrinks the size", () => {
  const z = computePositionSizing({ windowSigma: 0.0045, quoteVolumeUsd: 26_000_000, candles, venueCapUsd: 100 })
  assert.equal(z.bindingConstraint, "venue notional cap")
  assert.equal(z.notionalUsd, 100)
})

test("no observed volatility or volume means no size", () => {
  assert.equal(computePositionSizing({ windowSigma: 0, quoteVolumeUsd: 1e6 }).computable, false)
  assert.equal(computePositionSizing({ windowSigma: 0.01, quoteVolumeUsd: 0 }).computable, false)
})

test("spread estimate is non-negative and absent without candles", () => {
  assert.ok(estimateSpread(candles) >= 0)
  assert.equal(estimateSpread([]), null)
})

test("contract size rounds down to the venue step and refuses sub-minimum sizes", () => {
  assert.equal(contractSize(100, 1928, { sizeMultiplier: 0.01, minTradeNum: 0.01 }), 0.05)
  assert.equal(contractSize(10, 1928, { sizeMultiplier: 0.01, minTradeNum: 0.01 }), 0)
})

const tradeable = {
  provenance: "REAL_CAPTURE", numbersProvenance: "COMPUTED", kind: "DIRECT", state: "CONFIRMED",
  workflowState: "TRADE_READY", modeledDelta: 3.7, marketDelta: 0.9, confidence: 86, maxLoss: "$500",
  evidence: [{}, {}, {}], falsification: [], sizing: { computable: true, notionalUsd: 35_000 },
}

test("a real capture that passes everything is eligible", () => {
  assert.deepEqual(executionEligibility(tradeable), { eligible: true, decision: "TRADE_DIRECT", reasons: [] })
})

test("a replay fixture is never executable, even when it passes the gate", () => {
  const fixture = { ...tradeable, provenance: "REPLAY_FIXTURE", numbersProvenance: "AUTHORED_SCENARIO" }
  const e = executionEligibility(fixture)
  assert.equal(e.eligible, false)
  assert.ok(e.reasons.some((r) => r.includes("not a real capture")))
})

test("no computed size, no order", () => {
  const e = executionEligibility({ ...tradeable, sizing: undefined })
  assert.equal(e.eligible, false)
  assert.ok(e.reasons.includes("no computed position size"))
})

test("a blocking falsifier stops execution through the decision", () => {
  const e = executionEligibility({ ...tradeable, falsification: [{ blocksTrade: true, status: "UNRESOLVED" }] })
  assert.equal(e.eligible, false)
  assert.equal(e.decision, "MONITOR")
})
