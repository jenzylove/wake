import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { validateCapturePacket } from "../lib/capture-validation.mjs"

const input = process.argv[2]
const files = input
  ? [path.resolve(input)]
  : (await readdir(path.resolve("data", "incidents")))
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => path.resolve("data", "incidents", name))

if (files.length === 0) throw new Error("No JSON capture packets found")

const results = []
for (const filePath of files) {
  const parsed = JSON.parse(await readFile(filePath, "utf8"))
  const validation = validateCapturePacket(parsed)
  results.push({ filePath, incident: parsed.incident?.id, ...validation })
}

// The discovery log is hash chained: each line commits to the one before it.
const { verifyDiscoveryLog } = await import("../lib/discovery-log.mjs")
const discoveryLog = verifyDiscoveryLog(path.resolve("data", "discovered", "log.jsonl"))
const agentLog = verifyDiscoveryLog(path.resolve("data", "wake-paper", "log.jsonl"))

const blindLog = verifyDiscoveryLog(path.resolve("data", "blind", "runs.jsonl"))
const liveLog = verifyDiscoveryLog(path.resolve("data", "live", "log.jsonl"))
const replayLog = verifyDiscoveryLog(path.resolve("data", "backtest", "supply-decisions.jsonl"))

const ok = results.every((result) => result.ok) && discoveryLog.ok && agentLog.ok && blindLog.ok && liveLog.ok && replayLog.ok
console.log(JSON.stringify({ ok, packets: results, discoveryLog, agentLog, blindLog, liveLog, replayLog }, null, 2))
process.exit(ok ? 0 : 1)
