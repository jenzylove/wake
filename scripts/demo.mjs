// One continuous demonstration, start to finish, with nothing prepared by hand.
//
//   1. an empty chain starts and WAKE begins watching it
//   2. a red team deploys protocols WAKE has never seen and attacks one at a random moment
//   3. WAKE detects the drain, reconstructs it, and finds who else holds the damaged asset
//   4. Claude reads the evidence and makes the trading decision
//   5. code checks the money: edge after costs, size, Demo listing, conviction
//   6. if it clears, the agent places the order on Bitget Demo and prints the exchange order ID
//
// Run:  npm run demo        (needs Foundry's anvil, and Demo keys in .env.local to place the order)

import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"

const ROOT = process.cwd()
const line = (s = "") => console.log(s)
const say = (label, text) => console.log(`  ${label.padEnd(12)} ${text}`)

line("WAKE, end to end\n")
line("1-2  A fresh chain, a red team, an exploit nobody has seen before")
const blind = spawnSync("node", ["blind/run.mjs"], { cwd: ROOT, env: process.env, encoding: "utf8", timeout: 900_000 })
const runId = (blind.stdout.match(/"runId":\s*"([^"]+)"/) ?? [])[1]
if (!runId) { console.error(blind.stdout.slice(-800), blind.stderr.slice(-800)); process.exit(1) }

const score = JSON.parse(readFileSync(path.join(ROOT, "data", "blind", "runs", runId, "score.json"), "utf8"))
const ids = score.incidents ?? []
const records = ids.map((id) => JSON.parse(readFileSync(path.join(ROOT, "data", "blind", `${id}.json`), "utf8")))
const target = records.find((r) => r.detection.victim === score.answer.target.toLowerCase())
const decoy = records.find((r) => r.detection.victim === score.answer.decoy.toLowerCase())

say("answer", `sealed before the attack, commitment ${score.score.commitmentHolds ? "verified" : "BROKEN"}`)
say("attack", `${score.answer.exploitClass} on ${score.answer.targetName}`)
line()
line("3    Detection and investigation, from chain data alone")
if (!target) { say("result", "the exploit was not detected"); process.exit(0) }
say("detected", `${(target.detection.latencyMs / 1000).toFixed(1)}s after the block`)
say("mechanism", target.ai ? `${target.ai.exploitClass}: ${target.ai.mechanism}` : "no investigator review")
say("loss", target.candidates.map((c) => `${c.kind.toLowerCase()} ${c.name} $${Math.round(c.lossUsd).toLocaleString("en-US")}`).join("; ") || "none measured")
if (decoy) say("decoy", `${decoy.investigation.authorised ? "owner-signed" : "unsigned"} withdrawal, decided ${decoy.decision}`)
line()
line("4    Claude's decision")
const d = target.aiDecision
if (d) {
  say("action", `${d.action} (conviction ${d.confidence})`)
  say("thesis", d.thesis)
  say("invalidation", d.invalidation)
} else say("action", `none (${target.aiDecisionError ?? "model unavailable"}), so nothing trades`)
line()
line("5    Code checks the money")
if (!d || !String(d.action).startsWith("TRADE")) say("nothing", "Claude did not propose a trade, so there is nothing for code to check")
else if (target.refusals?.length) for (const r of target.refusals) say("refused", r)
else say("cleared", `${target.agent.instrument} short, size from the capture, capped at $100`)
say("final", target.decision)
line()
line("6    Execution on Bitget Demo")
if (!target.agent?.gatePassed) {
  say("order", "none placed; the decision was refused, which is the common and correct outcome")
  process.exit(0)
}
const tick = spawnSync("node", ["scripts/wake-agent.mjs"], { cwd: ROOT, env: { ...process.env, WAKE_EXECUTION_MODE: "bitget-demo" }, encoding: "utf8", timeout: 300_000 })
const log = readFileSync(path.join(ROOT, "data", "wake-paper", "log.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l))
const entry = log.reverse().find((e) => e.incidentId === target.id && /ENTRY/.test(e.event))
if (entry?.event === "ENTRY") {
  say("order", `${entry.side} ${entry.size} ${entry.instrument} at ${entry.entryPrice}`)
  say("order id", `${entry.orderId}  (look it up on Bitget Demo)`)
} else {
  say("order", entry ? `${entry.event}: ${entry.error ?? entry.reason ?? ""}` : `no entry recorded (${tick.stderr.slice(-200)})`)
}
