import { test } from "node:test"
import assert from "node:assert/strict"
import { agentEligibility, exitReason, AGENT_LIMITS } from "../lib/agent-policy.mjs"

const ok = { provenance: "REAL_CAPTURE", numbersProvenance: "COMPUTED", decision: "TRADE_DIRECT", gatePassed: true, sizing: { computable: true, notionalUsd: 500 }, instrument: "ETHUSDT", side: "SHORT" }

test("a real, gated, sized trade decision is eligible", () => assert.equal(agentEligibility(ok).eligible, true))
test("a blind test incident is eligible on Demo", () => assert.equal(agentEligibility({ ...ok, provenance: "BLIND_TEST" }).eligible, true))
test("replay fixtures never trade", () => assert.equal(agentEligibility({ ...ok, provenance: "REPLAY_FIXTURE" }).eligible, false))
test("MONITOR never trades", () => assert.equal(agentEligibility({ ...ok, decision: "MONITOR" }).eligible, false))
test("a held gate never trades", () => assert.equal(agentEligibility({ ...ok, gatePassed: false }).eligible, false))

const pos = { side: "SHORT", entryPrice: 100, stopPct: 0.02, openedAt: new Date(0).toISOString() }
test("a short stops out when price rises past the stop", () => assert.match(exitReason(pos, 102.5, { decision: "TRADE_DIRECT" }, 1000), /^stop/))
test("a changed decision closes the position", () => assert.match(exitReason(pos, 99, { decision: "MONITOR" }, 1000), /^thesis invalidated/))
test("the time stop closes a stale position", () => assert.match(exitReason(pos, 99, { decision: "TRADE_DIRECT" }, AGENT_LIMITS.maxHoldHours * 3_600_000), /^time stop/))
test("a live thesis inside the stop holds", () => assert.equal(exitReason(pos, 99, { decision: "TRADE_DIRECT" }, 1000), null))
