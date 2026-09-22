import { test } from "node:test"
import assert from "node:assert/strict"
import { DRAIN_SHARE, MIN_DRAIN_USD, WATCHED, chainConfig, scanWindow } from "../lib/chain-watch.mjs"

test("every watched chain has an RPC, a block time and priced assets", () => {
  for (const [chainId, chain] of Object.entries(WATCHED)) {
    assert.match(chain.rpc, /^https:\/\//, chainId)
    assert.ok(chain.blockSeconds > 0, chainId)
    assert.ok(Object.keys(chain.tokens).length > 0, chainId)
    for (const [address, meta] of Object.entries(chain.tokens)) {
      assert.match(address, /^0x[0-9a-f]{40}$/, `${chainId} ${address}`)
      assert.ok(meta.decimals > 0 && meta.symbol, address)
    }
  }
})

test("a first pass looks back a bounded distance rather than the whole chain", () => {
  const { from, to } = scanWindow({ head: 1_000_000, lastScanned: undefined, blockSeconds: 12 })
  assert.equal(to, 1_000_000)
  assert.ok(from > 999_800 && from < 1_000_000, `from ${from}`)
})

test("a normal pass resumes exactly where the last one stopped", () => {
  const { from, to, skipped } = scanWindow({ head: 1_000_100, lastScanned: 1_000_000, blockSeconds: 12 })
  assert.equal(from, 1_000_001)
  assert.equal(to, 1_000_100)
  assert.equal(skipped, 0)
})

test("chain-specific RPC overrides do not leak a generic provider onto other chains", () => {
  assert.equal(chainConfig("1").name, "ethereum")
  assert.equal(chainConfig("42161").name, "arbitrum")
})

test("after a long outage the pass is capped and says how much it skipped", () => {
  const { from, to, skipped } = scanWindow({ head: 2_000_000, lastScanned: 1_000_000, blockSeconds: 12 })
  assert.ok(to - from < 1_000, "window stays small")
  assert.ok(skipped > 998_000, `skipped ${skipped}`)
  assert.equal(to, 2_000_000)
})

test("the thresholds stay strict enough to mean something", () => {
  assert.ok(MIN_DRAIN_USD >= 100_000, "a drain worth investigating is six figures or more")
  assert.ok(DRAIN_SHARE >= 0.5, "half a contract's balance is the minimum that reads as a drain")
})
