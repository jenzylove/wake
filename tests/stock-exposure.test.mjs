import { test } from "node:test"
import assert from "node:assert/strict"
import { stockExposures } from "../lib/stock-exposure.mjs"

const syms = (hack) => stockExposures(hack).map((e) => e.symbol)

test("a USDC minting or reserve incident maps to Circle", () => {
  assert.deepEqual(syms({ name: "USDC CCTP", technique: "Unauthorized mint", chain: ["Ethereum"] }), ["CRCLUSDT"])
})

test("a protocol that merely holds USDC does not map to Circle", () => {
  assert.deepEqual(syms({ name: "Some Lending", technique: "Oracle manipulation drained USDC pool", chain: ["Ethereum"] }), [])
})

test("Coinbase custody incidents map to Coinbase", () => {
  assert.deepEqual(syms({ name: "Coinbase Custody", technique: "Private key compromise", chain: ["Ethereum"] }), ["COINUSDT"])
})

test("Base core infrastructure maps to Coinbase, a random Base dApp does not", () => {
  assert.deepEqual(syms({ name: "Base Bridge", technique: "Bridge message forgery", chain: ["Base"] }), ["COINUSDT"])
  assert.deepEqual(syms({ name: "Moonwell", technique: "Oracle misconfiguration", chain: ["Base"] }), [])
})

test("no DeFi exploit ever maps to MSTR or HOOD", () => {
  for (const name of ["Bitcoin Bridge", "Robinhood Chain dApp", "MicroStrategy vault"]) {
    assert.ok(!syms({ name, technique: "Reentrancy", chain: ["Ethereum"] }).some((s) => s === "MSTRUSDT" || s === "HOODUSDT"))
  }
})

test("an unlisted stock perp is never proposed", () => {
  assert.deepEqual(stockExposures({ name: "Coinbase Custody", technique: "key compromise" }, new Set(["BTCUSDT"])), [])
})
