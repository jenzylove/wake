import { test } from "node:test"
import assert from "node:assert/strict"
import { findDeposits, hubCandidates, supplyImpactPct, supplyMinEdgePct } from "../lib/supply-watch.mjs"
import { enforce, validateDecision } from "../lib/ai-decide.mjs"

const LINK = "0x514910771af9ca656af840dff83e8264ecf986ca"
const HUB = "0x28c6c06298d514db089934071355e5743bf21d60"
const hubs = { [HUB]: { exchange: "Binance", source: "public label" } }
const t = (from, to, amount, block, tx) => ({ token: LINK, symbol: "LINK", amount, usd: amount * 20, from, to, tx, block })

test("a deposit is traced from the sweep back to the wallet that funded the deposit address", () => {
  const d = findDeposits([t("0xteam", "0xdep", 100_000, 10, "0xa"), t("0xdep", HUB, 100_000, 12, "0xb")], hubs)
  assert.equal(d.length, 1)
  assert.equal(d[0].depositor, "0xteam")
  assert.equal(d[0].depositAddress, "0xdep")
  assert.equal(d[0].usd, 2_000_000)
})

test("exchange hub to exchange hub movement is not a deposit", () => {
  const other = "0x21a31ee1afc51d94c2efccaa2092ad1028285549"
  const both = { ...hubs, [other]: { exchange: "Binance", source: "public label" } }
  assert.equal(findDeposits([t(other, HUB, 100_000, 5, "0xc")], both).length, 0)
})

test("small deposits are ignored", () => {
  assert.equal(findDeposits([t("0xw", HUB, 1_000, 5, "0xd")], hubs).length, 0)
})

test("a wallet receiving from many distinct senders is a hub candidate", () => {
  const xs = Array.from({ length: 8 }, (_, i) => t(`0xs${i}`, "0xhot", 10, 1, `0x${i}`))
  assert.deepEqual(hubCandidates(xs), ["0xhot"])
})

test("square root impact and the cost bar", () => {
  assert.equal(supplyImpactPct({ usd: 1_000_000, dailyVolumeUsd: 100_000_000, dailySigma: 0.04 }), 0.4)
  assert.equal(supplyImpactPct({ usd: 1, dailyVolumeUsd: null, dailySigma: 0.04 }), null)
  assert.equal(supplyMinEdgePct(0.0015), 0.45)
})

const cand = (over = {}) => [{ kind: "DIRECT", instrument: "LINKUSDT", modeledDeltaPct: 0.6, marketDeltaPct: 0, minEdgePct: 0.45, sizing: { computable: true }, demoListed: true, ...over }]
const trade = validateDecision({ action: "TRADE_DIRECT", candidate: 0, confidence: 85 })

test("a supply trade clears its own cost based bar, not the exploit bar", () => {
  assert.equal(enforce(trade, cand()).decision, "TRADE_DIRECT")
})

test("a supply trade below its bar is refused", () => {
  assert.equal(enforce(trade, cand({ modeledDeltaPct: 0.3 })).decision, "NO_TRADE")
})

test("a depositor already in a position is refused", () => {
  const r = enforce(trade, cand({ sameSenderOpen: true }))
  assert.equal(r.decision, "NO_TRADE")
  assert.ok(r.refusals.some((x) => x.includes("already")))
})

test("a move against the trade never adds to its edge", () => {
  assert.equal(enforce(trade, cand({ modeledDeltaPct: 0.3, marketDeltaPct: -8 })).decision, "NO_TRADE")
})

test("a move already made in the trade's direction comes off the edge", () => {
  assert.equal(enforce(trade, cand({ modeledDeltaPct: 0.6, marketDeltaPct: 0.3 })).decision, "NO_TRADE")
})
