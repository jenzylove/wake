import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { validateCapturePacket } from "../lib/capture-validation.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const captures = [
  "inc-real-afx-20260722.json",
  "inc-real-afx-resolution-20260723.json",
  "inc-real-moonwell-20260827.json",
]

for (const name of captures) {
  test(`${name} has a successful receipt, coherent market window, and valid hash`, async () => {
    const packet = JSON.parse(await readFile(path.join(root, "data", "incidents", name), "utf8"))
    assert.deepEqual(validateCapturePacket(packet).errors, [])
  })
}

test("tampering is detected", async () => {
  const packet = JSON.parse(await readFile(path.join(root, "data", "incidents", captures[0]), "utf8"))
  packet.market.candles[0].close += 1
  const result = validateCapturePacket(packet)
  assert.equal(result.ok, false)
  assert.ok(result.errors.includes("integrity hash mismatch"))
})
