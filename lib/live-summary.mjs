// The compact view of every live incident, for the console and for the executor's published record.
// Both live watchers (drains and supply to exchange) write through this, so the summary always
// holds every class and the executor sees one list.

import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

export function writeLiveSummary(dir, extra = {}) {
  const incidents = readdirSync(dir)
    .filter((f) => f.startsWith("live-") && f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")))
    .sort((a, b) => (a.detectedAt < b.detectedAt ? 1 : -1))
    .slice(0, 60)
    .map((r) => ({
      id: r.id, eventClass: r.eventClass ?? "DRAIN", detectedAt: r.detectedAt, chain: r.chain.name, tx: r.detection.tx,
      contract: r.detection.contract, asset: r.detection.asset, approxUsd: r.detection.approxUsd,
      removedShare: r.detection.balanceRemovedShare, protocol: r.protocol ?? null, instrument: r.instrument ?? r.agent?.instrument ?? null,
      exchange: r.detection.exchange ?? null, depositor: r.depositor ?? null,
      decision: r.decision, gatePassed: r.agent?.gatePassed ?? r.gate?.passed ?? false, confidence: r.confidence ?? null,
      side: r.agent?.side ?? "SHORT",
      proposed: r.proposed ?? null, refusals: r.refusals ?? [],
      aiDecision: r.aiDecision ? { action: r.aiDecision.action, confidence: r.aiDecision.confidence, thesis: r.aiDecision.thesis, rationale: r.aiDecision.rationale } : null,
      modeledDeltaPct: r.modeledDeltaPct, marketDeltaPct: r.marketDeltaPct, minEdgePct: r.minEdgePct ?? null,
      exposureMeasured: r.exposure?.quantified === true, sizing: r.sizing?.computable ? r.sizing : null,
      falsification: r.falsification ?? [],
      ai: r.ai ? { exploitClass: r.ai.exploitClass, veto: r.ai.veto, narrative: r.ai.narrative, lossBearer: r.ai.lossBearer, concerns: r.ai.concerns } : null,
    }))
  const file = path.join(dir, "summary.json")
  let prev = {}
  try { prev = JSON.parse(readFileSync(file, "utf8")) } catch { /* first run */ }
  writeFileSync(file, JSON.stringify({ ...prev, ...extra, updatedAt: new Date().toISOString(), incidents }, null, 2) + "\n")
  return incidents
}
