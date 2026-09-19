import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"

const dir = "data/discovered"
const records = readdirSync(dir).filter((f) => f !== "index.json").map((f) => JSON.parse(readFileSync(`${dir}/${f}`, "utf8")))

test("every discovered incident carries its source record and hash", () => {
  assert.ok(records.length > 0)
  for (const r of records) {
    assert.equal(r.source.feed, "https://api.llama.fi/hacks")
    assert.match(r.source.sha256, /^[0-9a-f]{64}$/)
  }
})

test("discovery never produces a trade decision or an executable incident", () => {
  for (const r of records) {
    assert.ok(["MONITOR", "NO_TRADE"].includes(r.decision), r.id)
  }
})
