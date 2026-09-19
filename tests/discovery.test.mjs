import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"

const dir = "data/discovered"
const records = readdirSync(dir).filter((f) => f.startsWith("disc-")).map((f) => JSON.parse(readFileSync(`${dir}/${f}`, "utf8")))

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

import { verifyDiscoveryLog } from "../lib/discovery-log.mjs"
import { writeFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"

test("the committed discovery log is an unbroken hash chain", () => {
  const r = verifyDiscoveryLog(`${dir}/log.jsonl`)
  assert.equal(r.ok, true, r.reason)
  assert.ok(r.entries > 0)
})

test("editing any past log entry breaks the chain", () => {
  const lines = readFileSync(`${dir}/log.jsonl`, "utf8").trim().split("\n")
  const first = JSON.parse(lines[0])
  first.decision = "TRADE_DIRECT"
  lines[0] = JSON.stringify(first)
  const tampered = `${mkdtempSync(`${tmpdir()}/wake-`)}/log.jsonl`
  writeFileSync(tampered, lines.join("\n") + "\n")
  assert.equal(verifyDiscoveryLog(tampered).ok, false)
})
