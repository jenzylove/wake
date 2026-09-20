import { test } from "node:test"
import assert from "node:assert/strict"
import { computeNetFlows, decodeTransfers, lossesByAddress } from "../lib/onchain-exposure.mjs"

const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
const pad = (a) => `0x${"0".repeat(24)}${a.slice(2)}`
const log = (token, from, to, valueHex) => ({ address: token, topics: [TRANSFER, pad(from), pad(to)], data: valueHex })

const VAULT = "0x1111111111111111111111111111111111111111"
const ATTACKER = "0x2222222222222222222222222222222222222222"
const USDC = "0x3333333333333333333333333333333333333333"

test("only ERC20 Transfer logs are decoded", () => {
  const logs = [log(USDC, VAULT, ATTACKER, "0x" + (10n ** 6n).toString(16)), { address: USDC, topics: ["0xdead"], data: "0x" }]
  const decoded = decodeTransfers(logs)
  assert.equal(decoded.length, 1)
  assert.deepEqual([decoded[0].token, decoded[0].from, decoded[0].to], [USDC, VAULT, ATTACKER])
})

test("net flows value the drain and show who gained it", () => {
  const transfers = decodeTransfers([log(USDC, VAULT, ATTACKER, "0x" + (2_000_000n * 10n ** 6n).toString(16))])
  const flows = computeNetFlows(transfers, { [USDC]: { priceUsd: 1, decimals: 6, symbol: "USDC" } })
  const victim = flows.find((f) => f.address === VAULT)
  const gainer = flows.find((f) => f.address === ATTACKER)
  assert.equal(victim.usd, -2_000_000)
  assert.equal(gainer.usd, 2_000_000)
})

test("an unpriced token stays unvalued rather than being guessed at", () => {
  const transfers = decodeTransfers([log(USDC, VAULT, ATTACKER, "0x64")])
  const flows = computeNetFlows(transfers, {}, { [USDC]: { decimals: 18 } })
  assert.equal(flows[0].usd, null)
})

test("mints and burns do not create a phantom loser", () => {
  const ZERO = "0x0000000000000000000000000000000000000000"
  const transfers = decodeTransfers([log(USDC, ZERO, VAULT, "0x64")])
  assert.equal(computeNetFlows(transfers).some((f) => f.address === ZERO), false)
})

test("losses are summed per address across tokens", () => {
  const other = "0x4444444444444444444444444444444444444444"
  const transfers = decodeTransfers([
    log(USDC, VAULT, ATTACKER, "0x" + (1_000n * 10n ** 6n).toString(16)),
    log(other, VAULT, ATTACKER, "0x" + (10n ** 18n).toString(16)),
  ])
  const flows = computeNetFlows(transfers, { [USDC]: { priceUsd: 1, decimals: 6 }, [other]: { priceUsd: 2000, decimals: 18 } })
  assert.equal(Math.round(lossesByAddress(flows).get(VAULT)), -3000)
})
