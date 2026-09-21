import { test } from "node:test"
import assert from "node:assert/strict"
import { enforce, validateDecision } from "../lib/ai-decide.mjs"

const candidates = [
  { kind: "DIRECT", instrument: "SOLUSDT", modeledDeltaPct: 3.1, marketDeltaPct: 0.2, sizing: { computable: true }, demoListed: true },
  { kind: "CONTAGION", instrument: "LINKUSDT", modeledDeltaPct: 0.4, marketDeltaPct: 0.0, sizing: { computable: true }, demoListed: true },
  { kind: "DIRECT", instrument: "ARBUSDT", modeledDeltaPct: 5, marketDeltaPct: 0, sizing: { computable: true }, demoListed: false },
]
const trade = (over = {}) => validateDecision({ action: "TRADE_DIRECT", candidate: 0, confidence: 88, thesis: "t", ...over })

test("the model's trade stands when every money check passes", () => {
  const r = enforce(trade(), candidates)
  assert.equal(r.decision, "TRADE_DIRECT")
  assert.equal(r.chosen.instrument, "SOLUSDT")
})

test("the model's refusal is final, however good the numbers", () => {
  assert.equal(enforce(validateDecision({ action: "NO_TRADE", candidate: null, confidence: 90 }), candidates).decision, "NO_TRADE")
})

test("code can refuse a thin edge, and lands on NO_TRADE rather than another trade", () => {
  const r = enforce(validateDecision({ action: "TRADE_CONTAGION", candidate: 1, confidence: 90 }), candidates)
  assert.equal(r.decision, "NO_TRADE")
  assert.equal(r.chosen, null)
  assert.ok(r.refusals.some((x) => x.includes("edge")))
})

test("code refuses an instrument Bitget Demo does not list", () => {
  const r = enforce(trade({ candidate: 2 }), candidates)
  assert.equal(r.decision, "NO_TRADE")
  assert.ok(r.refusals.some((x) => x.includes("not listed")))
})

test("a candidate the model invented is refused", () => {
  assert.equal(enforce(trade({ candidate: 9 }), candidates).decision, "NO_TRADE")
})

test("the action has to match the candidate's kind", () => {
  const r = enforce(validateDecision({ action: "TRADE_CONTAGION", candidate: 0, confidence: 90 }), candidates)
  assert.equal(r.decision, "NO_TRADE")
})

test("low conviction does not trade", () => {
  assert.equal(enforce(trade({ confidence: 60 }), candidates).decision, "NO_TRADE")
})

test("no model decision means nothing trades", () => {
  assert.equal(enforce(null, candidates).decision, "MONITOR")
})

test("an owner-signed outflow is refused even if the model wants it", () => {
  assert.equal(enforce(trade(), candidates, { authorised: true }).decision, "NO_TRADE")
})
