import test from "node:test"
import assert from "node:assert/strict"
import { deriveDecisionPolicy, evaluateRiskGatePolicy } from "../lib/wake-policy.mjs"

function incident(overrides = {}) {
  return {
    state: "CONFIRMED",
    workflowState: "RISK_APPROVED",
    kind: "CONTAGION",
    modeledDelta: 5.4,
    marketDelta: 0.8,
    confidence: 88,
    maxLoss: "$100",
    evidence: [{}, {}, {}],
    falsification: [],
    ...overrides,
  }
}

test("trade decision requires both residual edge and confidence", () => {
  assert.equal(deriveDecisionPolicy(incident()), "TRADE_CONTAGION")
  assert.equal(deriveDecisionPolicy(incident({ confidence: 70 })), "NO_TRADE")
  assert.equal(deriveDecisionPolicy(incident({ marketDelta: 4.5 })), "NO_TRADE")
})

test("blocking falsifier forces monitor even when the numeric signal says trade", () => {
  const candidate = incident({ state: "RESOLVED", workflowState: "MONITORING", falsification: [{ blocksTrade: true }] })
  assert.equal(deriveDecisionPolicy(candidate), "MONITOR")
  assert.equal(evaluateRiskGatePolicy(candidate).passed, false)
})

test("missing model stays no-trade", () => {
  assert.equal(deriveDecisionPolicy(incident({ modeledDelta: null, confidence: null })), "NO_TRADE")
})
