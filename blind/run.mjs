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
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
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

// Compact view of every blind incident, for the console.
function compactBlindIncidents(dir) {
  return readdirSync(dir)
    .filter((f) => f.startsWith("blind-") && f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")))
    .sort((a, b) => (a.detection.firstDetectedAt < b.detection.firstDetectedAt ? 1 : -1))
    .slice(0, 30)
    .map((r) => ({
      id: r.id, runId: r.runId, detectedAt: r.detection.firstDetectedAt, latencyMs: r.detection.latencyMs,
      victim: r.detection.victim, authorised: r.investigation.authorised, decision: r.decision,
      gatePassed: r.agent?.gatePassed ?? r.gate.passed, decidedBy: r.agent?.decidedBy ?? null,
      proposed: r.proposed ?? null, refusals: r.refusals ?? [],
      aiDecision: r.aiDecision ? { action: r.aiDecision.action, confidence: r.aiDecision.confidence, thesis: r.aiDecision.thesis, invalidation: r.aiDecision.invalidation, rationale: r.aiDecision.rationale } : null,
      confidence: r.confidence, instrument: r.agent?.instrument ?? null, kind: r.agent?.kind ?? null,
      side: r.agent?.side ?? null,
      sizing: r.agent?.sizing?.computable ? { notionalUsd: r.agent.sizing.notionalUsd, maxLossUsd: r.agent.sizing.maxLossUsd, stopPct: r.agent.sizing.stopPct } : null,
      lossUsd: r.candidates?.[0]?.lossUsd ?? null, target: r.candidates?.[0]?.name ?? null,
      modeledDeltaPct: r.candidates?.[0]?.modeledDeltaPct ?? null, marketDeltaPct: r.candidates?.[0]?.marketDeltaPct ?? null,
      integrators: r.investigation.integrators?.length ?? 0,
      ai: r.ai ? { exploitClass: r.ai.exploitClass, veto: r.ai.veto, narrative: r.ai.narrative, lossBearer: r.ai.lossBearer, concerns: r.ai.concerns } : null,
    }))
}

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
    gatePassed: onTarget ? (onTarget.agent?.gatePassed ?? onTarget.gate.passed) : null,
    decidedBy: onTarget?.agent?.decidedBy ?? null,
    proposed: onTarget?.proposed ?? null,
    falsePositives: records.filter((r) => r.detection.victim !== lc(answer.target) && r.decision !== "NO_TRADE").length,
  }
  const report = { runId: RUN_ID, answer: { ...answer, attackedAt, attacker }, score, incidents: ids }
  writeFileSync(path.join(RUN_DIR, "score.json"), JSON.stringify(report, null, 2) + "\n")
  appendHashLog(path.join(ROOT, "data", "blind", "runs.jsonl"), { event: "BLIND_RUN", runId: RUN_ID, commitment: registry.answerCommitment, ...score })
  // Aggregate scoreboard for the site.
  const runsFile = path.join(ROOT, "data", "blind", "runs.jsonl")
  const runs = readFileSync(runsFile, "utf8").split(String.fromCharCode(10)).filter(Boolean).map((l) => JSON.parse(l))
  const count = (f) => runs.filter(f).length
  const latencies = runs.map((r) => r.detectionLatencyMs).filter((x) => typeof x === "number").sort((a, b) => a - b)
  writeFileSync(path.join(ROOT, "data", "blind", "summary.json"), JSON.stringify({
    updatedAt: new Date().toISOString(),
    runs: runs.length,
    detected: count((r) => r.exploitDetected),
    decoysDismissed: count((r) => r.decoyDismissed === true),
    contagionFound: { found: count((r) => r.contagionFound === true), applicable: count((r) => r.contagionFound !== null) },
    tradeTargetCorrect: count((r) => r.tradeTargetCorrect === true),
    gateCleared: count((r) => r.gatePassed === true),
    falsePositives: runs.reduce((s, r) => s + (r.falsePositives ?? 0), 0),
    medianDetectionMs: latencies.length ? latencies[latencies.length >> 1] : null,
    recent: runs.slice(-12).reverse(),
    incidents: compactBlindIncidents(path.join(ROOT, "data", "blind")),
  }, null, 2) + String.fromCharCode(10))
  console.log(JSON.stringify(report, null, 2))
} finally {
  anvil.kill()
}
