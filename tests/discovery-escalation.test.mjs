import { test } from "node:test"
import assert from "node:assert/strict"
import { assessDiscovered } from "../scripts/discover-incidents.mjs"
import { deriveDecisionPolicy } from "../lib/wake-policy.mjs"

const base = {
  exposures: [{ kind: "DIRECT" }], protocol: { mcapUsd: 50_000_000 },
  market: { observed: { exploitDayMovePct: 0.4 } }, sizing: { computable: true, maxLossUsd: 500 }, ai: { veto: false },
}
const withReceipt = { ...base, receipt: { txHash: "0x1" } }
const measured = { ...withReceipt, exposure: { quantified: true, drainedUsd: 8_000_000 } }
const decide = (r) => deriveDecisionPolicy(assessDiscovered(r))

test("a feed entry alone can only open an investigation", () => {
  assert.equal(decide(base), "MONITOR")
  assert.equal(assessDiscovered(base).modeledDelta, null)
})

test("a receipt alone is not enough: the loss path must be measured", () => {
  assert.equal(decide(withReceipt), "MONITOR")
})

test("a measured loss path against a known market cap can reach a trade", () => {
  assert.equal(decide(measured), "TRADE_DIRECT")
  assert.equal(assessDiscovered(measured).modeledDelta, 4)
})

test("a loss too small for the edge threshold is a no trade", () => {
  assert.equal(decide({ ...withReceipt, exposure: { quantified: true, drainedUsd: 200_000 } }), "NO_TRADE")
})

test("a Claude veto stops a trade the numbers would take", () => {
  assert.notEqual(decide({ ...measured, ai: { veto: true, vetoReason: "the loss path is not causal" } }), "TRADE_DIRECT")
})

test("contagion through a chain token has no market cap to size against, so it holds", () => {
  assert.equal(decide({ ...measured, exposures: [{ kind: "CONTAGION" }] }), "MONITOR")
})

test("an unknown market cap holds even with everything else measured", () => {
  assert.equal(decide({ ...measured, protocol: { mcapUsd: null } }), "MONITOR")
})
