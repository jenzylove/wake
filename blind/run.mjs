// Blind exploit challenge, one run end to end.
//
//   1. a fresh local chain starts empty
//   2. WAKE's watcher starts and waits
//   3. the red team deploys a randomized protocol set, commits to its answer, then attacks
//   4. WAKE detects, investigates, decides; its records land in data/blind/
//   5. the answer is revealed, checked against the commitment, and WAKE is scored
//
// Run:  node blind/run.mjs            (needs Foundry's anvil on PATH)

import { spawn } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { appendHashLog } from "../lib/hash-log.mjs"

const ROOT = process.cwd()
const RUN_ID = `${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}${randomBytes(2).toString("hex")}`
const RUN_DIR = path.join(ROOT, "data", "blind", "runs", RUN_ID)
const PORT = 8545 + Math.floor(Math.random() * 400)
const RPC = `http://127.0.0.1:${PORT}`
mkdirSync(RUN_DIR, { recursive: true })

const env = { ...process.env, BLIND_RPC: RPC, BLIND_RUN_DIR: RUN_DIR, BLIND_RUN_ID: RUN_ID }
const run = (cmd, args, name) => new Promise((resolve, reject) => {
  const p = spawn(cmd, args, { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] })
  let out = ""
  p.stdout.on("data", (d) => { out += d; process.stdout.write(`[${name}] ${d}`) })
  p.stderr.on("data", (d) => process.stderr.write(`[${name}] ${d}`))
  p.on("exit", (code) => (code === 0 ? resolve(out) : reject(new Error(`${name} exited ${code}`))))
})

const anvil = spawn("anvil", ["--port", String(PORT), "--silent"], { stdio: "ignore" })
try {
  for (let i = 0; i < 50; i += 1) {
    try { await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) }); break }
    catch { await new Promise((r) => setTimeout(r, 200)) }
  }
  const watcher = run("node", ["blind/watch.mjs"], "wake")
  await new Promise((r) => setTimeout(r, 1500))
  await run("node", ["blind/redteam.mjs"], "redteam")
  await watcher

  // Reveal and score.
  const sealed = JSON.parse(readFileSync(path.join(RUN_DIR, "answer.sealed.json"), "utf8"))
  const registry = JSON.parse(readFileSync(path.join(RUN_DIR, "registry.json"), "utf8"))
  const { attackedAt, attacker, ...answer } = sealed
  const commitmentHolds = createHash("sha256").update(JSON.stringify(answer)).digest("hex") === registry.answerCommitment
  const ids = existsSync(path.join(RUN_DIR, "wake-incidents.json")) ? JSON.parse(readFileSync(path.join(RUN_DIR, "wake-incidents.json"), "utf8")) : []
  const records = ids.map((id) => JSON.parse(readFileSync(path.join(ROOT, "data", "blind", `${id}.json`), "utf8")))
  const lc = (a) => a.toLowerCase()
  const onTarget = records.find((r) => r.detection.victim === lc(answer.target))
  const onDecoy = records.find((r) => r.detection.victim === lc(answer.decoy))
  const expected = answer.contagionMarkets.map(lc)
  const chosen = onTarget?.candidates?.[0]?.address ?? null
  const score = {
    commitmentHolds,
    exploitDetected: Boolean(onTarget),
    detectionLatencyMs: onTarget?.detection.latencyMs ?? null,
    decoyDismissed: onDecoy ? onDecoy.decision === "NO_TRADE" : null,
    contagionFound: expected.length ? expected.every((m) => onTarget?.investigation.integrators.some((i) => i.address === m)) : null,
    tradeTargetCorrect: onTarget && chosen ? (expected.length ? expected.includes(chosen) || chosen === lc(answer.target) : chosen === lc(answer.target)) : null,
    decision: onTarget?.decision ?? null,
    gatePassed: onTarget?.gate.passed ?? null,
    falsePositives: records.filter((r) => r.detection.victim !== lc(answer.target) && r.decision !== "NO_TRADE").length,
  }
  const report = { runId: RUN_ID, answer: { ...answer, attackedAt, attacker }, score, incidents: ids }
  writeFileSync(path.join(RUN_DIR, "score.json"), JSON.stringify(report, null, 2) + "\n")
  appendHashLog(path.join(ROOT, "data", "blind", "runs.jsonl"), { event: "BLIND_RUN", runId: RUN_ID, commitment: registry.answerCommitment, ...score })
  console.log(JSON.stringify(report, null, 2))
} finally {
  anvil.kill()
}
