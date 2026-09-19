// WAKE agent loop policy: which incidents may open a Demo position, and when an open position
// must close. Pure functions over a normalized incident, so the scheduled agent, the API and the
// tests all apply the same rules.

export const AGENT_LIMITS = Object.freeze({
  maxOpenPositions: 3,
  maxHoldHours: 72,          // an incident edge that has not paid in three days is gone
  demoNotionalCapUsd: 100,   // hard cap per Demo position, whatever the sizer says
})

const TRADE = new Set(["TRADE_DIRECT", "TRADE_CONTAGION", "TRADE_RESOLUTION", "HEDGE"])
// Real captures trade on Demo. Blind test incidents also trade on Demo: that is the PRD's proof
// that the agent acts on an exploit it cannot have memorised. Replay fixtures never trade.
const EXECUTABLE_PROVENANCE = new Set(["REAL_CAPTURE", "BLIND_TEST"])

/** @param {{ provenance?: string, numbersProvenance?: string, decision: string, gatePassed: boolean, sizing?: { computable?: boolean, notionalUsd?: number } | null, instrument?: string | null, side?: string }} r */
export function agentEligibility(r) {
  const reasons = []
  if (!EXECUTABLE_PROVENANCE.has(r.provenance ?? "")) reasons.push(`provenance ${r.provenance ?? "unknown"} is not executable`)
  if (r.numbersProvenance !== "COMPUTED") reasons.push("numbers are not computed from the capture")
  if (!TRADE.has(r.decision)) reasons.push(`decision is ${r.decision}`)
  if (!r.gatePassed) reasons.push("risk gate held")
  if (!r.sizing?.computable) reasons.push("no computed position size")
  if (!r.instrument) reasons.push("no Bitget instrument")
  if (r.side !== "LONG" && r.side !== "SHORT") reasons.push("no side")
  return { eligible: reasons.length === 0, reasons }
}

/**
 * Why an open position must close now, or null to hold.
 * @param {{ side: "LONG" | "SHORT", entryPrice: number, stopPct: number, openedAt: string }} p
 * @param {number} mark
 * @param {{ decision: string } | null} current  the incident as re-evaluated this tick
 */
export function exitReason(p, mark, current, now = Date.now()) {
  const move = (mark / p.entryPrice - 1) * (p.side === "LONG" ? 1 : -1)
  if (move <= -p.stopPct) return `stop: ${(move * 100).toFixed(2)}% against, stop was ${(p.stopPct * 100).toFixed(2)}%`
  if (!current) return "thesis gone: the incident is no longer tracked"
  if (!TRADE.has(current.decision)) return `thesis invalidated: decision is now ${current.decision}`
  if ((now - Date.parse(p.openedAt)) / 3_600_000 >= AGENT_LIMITS.maxHoldHours) return `time stop: held ${AGENT_LIMITS.maxHoldHours}h`
  return null
}
