// Rebuild data/blind/summary.json from the committed runs log and incident records.
//
// The blind run writes this after every run; this script exists so the summary can be rebuilt
// from the source files alone, for example after two runners committed at the same time.

import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import path from "node:path"

const dir = path.join(process.cwd(), "data", "blind")
const runs = readFileSync(path.join(dir, "runs.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
const count = (f) => runs.filter(f).length
const latencies = runs.map((r) => r.detectionLatencyMs).filter((x) => typeof x === "number").sort((a, b) => a - b)

const incidents = readdirSync(dir)
  .filter((f) => f.startsWith("blind-") && f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")))
  .sort((a, b) => (a.detection.firstDetectedAt < b.detection.firstDetectedAt ? 1 : -1))
  .map((r) => ({
    id: r.id, runId: r.runId, detectedAt: r.detection.firstDetectedAt, latencyMs: r.detection.latencyMs,
    victim: r.detection.victim, authorised: r.investigation.authorised, decision: r.decision,
    gatePassed: r.agent?.gatePassed ?? r.gate.passed, decidedBy: r.agent?.decidedBy ?? null,
    proposed: r.proposed ?? null, refusals: r.refusals ?? [],
    aiDecision: r.aiDecision ? { action: r.aiDecision.action, confidence: r.aiDecision.confidence, thesis: r.aiDecision.thesis, invalidation: r.aiDecision.invalidation, rationale: r.aiDecision.rationale } : null,
    confidence: r.confidence, instrument: r.agent?.instrument ?? null, kind: r.agent?.kind ?? null, side: r.agent?.side ?? null,
    sizing: r.agent?.sizing?.computable ? { notionalUsd: r.agent.sizing.notionalUsd, maxLossUsd: r.agent.sizing.maxLossUsd, stopPct: r.agent.sizing.stopPct } : null,
    lossUsd: r.candidates?.[0]?.lossUsd ?? null, target: r.candidates?.[0]?.name ?? null,
    modeledDeltaPct: r.candidates?.[0]?.modeledDeltaPct ?? null, marketDeltaPct: r.candidates?.[0]?.marketDeltaPct ?? null,
    integrators: r.investigation.integrators?.length ?? 0,
    ai: r.ai ? { exploitClass: r.ai.exploitClass, veto: r.ai.veto, narrative: r.ai.narrative, lossBearer: r.ai.lossBearer, concerns: r.ai.concerns } : null,
  }))

writeFileSync(path.join(dir, "summary.json"), JSON.stringify({
  updatedAt: new Date().toISOString(),
  runs: runs.length,
  detected: count((r) => r.exploitDetected),
  decoysDismissed: count((r) => r.decoyDismissed === true),
  contagionFound: { found: count((r) => r.contagionFound === true), applicable: count((r) => r.contagionFound !== null) },
  tradeTargetCorrect: count((r) => r.tradeTargetCorrect === true),
  gateCleared: count((r) => r.gatePassed === true),
  claudeProposedTrade: count((r) => typeof r.proposed === "string" && r.proposed.startsWith("TRADE")),
  falsePositives: runs.reduce((s, r) => s + (r.falsePositives ?? 0), 0),
  medianDetectionMs: latencies.length ? latencies[latencies.length >> 1] : null,
  recent: runs.slice(-12).reverse(),
  incidents,
}, null, 2) + "\n")
console.log(`summary rebuilt: ${runs.length} runs, ${incidents.length} incidents`)
