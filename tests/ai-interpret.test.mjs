import { test } from "node:test"
import assert from "node:assert/strict"
import { aiFalsifier, validateInterpretation } from "../lib/ai-interpret.mjs"
import { deriveDecisionPolicy } from "../lib/wake-policy.mjs"

const trade = { falsification: [], modeledDelta: 3, marketDelta: 0, confidence: 90, kind: "DIRECT", state: "CONFIRMED", workflowState: "MARKET_CHECK" }

test("a veto holds a trade the numbers would take", () => {
  const ai = validateInterpretation({ exploitClass: "authorised-operation", veto: true, vetoReason: "owner signed it" })
  assert.equal(deriveDecisionPolicy(trade), "TRADE_DIRECT")
  assert.notEqual(deriveDecisionPolicy({ ...trade, falsification: [aiFalsifier(ai)] }), "TRADE_DIRECT")
})

test("no veto leaves the deterministic decision unchanged", () => {
  const ai = validateInterpretation({ exploitClass: "access-control", veto: false })
  assert.equal(deriveDecisionPolicy({ ...trade, falsification: [aiFalsifier(ai)] }), "TRADE_DIRECT")
})

test("the review can never turn a hold into a trade", () => {
  const hold = { ...trade, modeledDelta: 0.3 }
  const ai = validateInterpretation({ exploitClass: "access-control", veto: false, narrative: "clearly tradeable" })
  assert.equal(deriveDecisionPolicy({ ...hold, falsification: [aiFalsifier(ai)] }), deriveDecisionPolicy(hold))
})

test("a missing review blocks nothing", () => assert.equal(aiFalsifier(null).blocksTrade, false))

test("unknown classes and oversized text are clamped", () => {
  const r = validateInterpretation({ exploitClass: "magic", narrative: "x".repeat(5000), veto: "yes" })
  assert.equal(r.exploitClass, "unknown")
  assert.equal(r.narrative.length, 700)
  assert.equal(r.veto, false)
})
