import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { POLICY_THRESHOLDS } from "../lib/wake-policy.mjs"

// wake-engine.ts (UI + API) and wake-policy.mjs (decision + gate) must agree on the gate thresholds.
test("engine and policy gate thresholds are identical", () => {
  const src = readFileSync(new URL("../lib/wake-engine.ts", import.meta.url), "utf8")
  const block = src.match(/export const GATE_THRESHOLDS = \{([\s\S]*?)\}/)
  assert.ok(block, "GATE_THRESHOLDS not found in wake-engine.ts")
  const num = (re) => Number(block[1].match(re)[1])
  assert.equal(num(/minConfidence:\s*([\d.]+)/), POLICY_THRESHOLDS.minConfidence)
  assert.equal(num(/minResidualPct:\s*([\d.]+)/), POLICY_THRESHOLDS.minResidualPct)
})
