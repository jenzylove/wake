// Claude decides the trade. Code decides whether the money may move.
//
// Given the measured evidence for an incident and the candidate trades code has already priced,
// Claude chooses: which action (a direct short, a contagion short, or no trade), on which of the
// measured candidates, with what conviction, and what would invalidate it. That is the trading
// decision, and it is the model's.
//
// Code then has exactly one power over that decision: it can refuse. It refuses when the chosen
// candidate is not one it measured, when the edge after costs is below the threshold, when the
// size cannot be computed, when the instrument is not tradeable on Bitget Demo, or when the stated
// conviction is below the bar. It can never originate a trade, change the model's choice to a
// different trade, or enlarge a position. No model, no trade: if the review fails, the incident
// holds.

import { POLICY_THRESHOLDS } from "./wake-policy.mjs"

const API = "https://api.anthropic.com/v1/messages"
export const ACTIONS = ["TRADE_DIRECT", "TRADE_CONTAGION", "NO_TRADE", "MONITOR"]

const SYSTEM = `You are the trading decision maker inside WAKE, an autonomous agent that trades the market consequences of on-chain security incidents on Bitget Demo.

You receive an incident's evidence and a list of candidate trades. Each candidate was measured by code: the loss it would absorb in USD, the move that loss implies (modeledDeltaPct), how much the market has already moved in that direction (marketDeltaPct), and whether a position can be sized. Decide what to do.

- TRADE_DIRECT: short the protocol that was drained.
- TRADE_CONTAGION: short a different protocol that holds the damaged asset and absorbs the loss.
- NO_TRADE: the move is already priced, the loss is immaterial, the causal path is not established, or the event looks like an authorised operation.
- MONITOR: something real may be happening but the evidence is not yet enough to act.

Some incidents are a different class, SUPPLY_TO_EXCHANGE: a holder moved a large block of a token onto an exchange. There TRADE_DIRECT means short that token. The candidate's modeledDeltaPct is the square root impact of selling the whole block into the token's real daily volume. Your job is to judge whether this is really supply that will be sold: team, treasury, unlock, fund or long held wallets moving to an exchange are; market makers, exchanges moving their own funds, custody, OTC settlement and wallets that deposit and withdraw all day are not. Use the depositor facts you are given (contract or wallet, transaction count, what share of its balance it sent, share of supply). When in doubt, do not trade.

Choose a candidate by its index when you trade. Never invent a candidate, a number or an instrument. Code will refuse a trade whose edge after costs is too small, so do not argue with the numbers; judge whether the loss path is real and whether the chosen market is the one that actually pays. Most incidents should not be traded.

Return JSON only:
{"action": one of ${JSON.stringify(ACTIONS)}, "candidate": integer index or null, "confidence": integer 0-100, "thesis": string (<=400 chars), "invalidation": string (<=240 chars), "rationale": string (<=500 chars)}`

/** @param {unknown} packet @param {{ apiKey: string, model?: string }} opts */
export async function decideWithClaude(packet, { apiKey, model = "claude-opus-5" }) {
  const once = async () => {
    const res = await fetch(API, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: 2000, system: SYSTEM, messages: [{ role: "user", content: JSON.stringify(packet) }] }),
      signal: AbortSignal.timeout(90_000),
    })
    const body = await res.json()
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${body.error?.message ?? "request failed"}`)
    const text = body.content?.filter((c) => c.type === "text").map((c) => c.text).join("\n") ?? ""
    return validateDecision(JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)), model)
  }
  try { return await once() } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    return once()
  }
}

/** @param {any} r @param {string | null} [model] */
export function validateDecision(r, model = null) {
  if (typeof r !== "object" || r === null) throw new Error("decision is not an object")
  const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : "")
  const action = ACTIONS.includes(r.action) ? r.action : "MONITOR"
  const candidate = Number.isInteger(r.candidate) ? r.candidate : null
  const confidence = Number.isFinite(r.confidence) ? Math.max(0, Math.min(100, Math.round(r.confidence))) : 0
  return {
    model, action, candidate, confidence,
    thesis: str(r.thesis, 400), invalidation: str(r.invalidation, 240), rationale: str(r.rationale, 500),
  }
}

/**
 * The only thing code may do to Claude's decision: refuse it. Returns the final decision and, when
 * refused, every reason. A refusal always lands on NO_TRADE or MONITOR, never on another trade.
 * @param {ReturnType<typeof validateDecision> | null} ai
 * @param {Array<{ kind: string, instrument?: string | null, modeledDeltaPct?: number | null, marketDeltaPct?: number | null, sizing?: { computable?: boolean } | null, demoListed?: boolean }>} candidates
 */
export function enforce(ai, candidates, { authorised = false } = {}) {
  if (!ai) return { decision: "MONITOR", chosen: null, refusals: ["no model decision was available, so nothing trades"], proposed: null }
  const proposed = ai.action
  if (!proposed.startsWith("TRADE")) return { decision: proposed, chosen: null, refusals: [], proposed }

  const refusals = []
  const c = ai.candidate === null ? undefined : candidates[ai.candidate]
  if (!c) refusals.push(`candidate ${ai.candidate} is not one code measured`)
  else {
    const expectedKind = proposed === "TRADE_CONTAGION" ? "CONTAGION" : "DIRECT"
    if (c.kind !== expectedKind) refusals.push(`${proposed} was chosen on a ${c.kind} candidate`)
    if (!c.instrument) refusals.push("the candidate has no instrument")
    if (c.demoListed === false) refusals.push(`${c.instrument} is not listed on Bitget Demo`)
    // A move already made in the trade's direction is priced and comes off the edge; a move the
    // other way is not evidence of more to come, so it never adds to it.
    const residual = c.modeledDeltaPct == null ? null : c.modeledDeltaPct - Math.max(0, c.marketDeltaPct ?? 0)
    // An incident class may carry its own bar, fixed in code before any data is seen; exploits use the policy default.
    const minEdge = Number.isFinite(c.minEdgePct) ? c.minEdgePct : POLICY_THRESHOLDS.minResidualPct
    if (residual === null || residual < minEdge) {
      refusals.push(`edge after what the market already did is ${residual === null ? "unknown" : `${residual.toFixed(2)}%`}, below ${minEdge}%`)
    }
    if (c.sameSenderOpen) refusals.push("this depositor already has an open position")
    if (!c.sizing?.computable) refusals.push("no position size can be computed")
  }
  if (ai.confidence < POLICY_THRESHOLDS.minConfidence) refusals.push(`conviction ${ai.confidence} is below ${POLICY_THRESHOLDS.minConfidence}`)
  if (authorised) refusals.push("the outflow was signed by the contract owner")

  if (refusals.length) return { decision: "NO_TRADE", chosen: null, refusals, proposed }
  return { decision: proposed, chosen: c, refusals: [], proposed }
}

/** Local key if present, else the deployed route with the scheduler token, else no decision. */
export async function decideAnywhere(packet) {
  if (process.env.ANTHROPIC_API_KEY) return decideWithClaude(packet, { apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.ANTHROPIC_MODEL || "claude-opus-5" })
  const base = process.env.WAKE_AGENT_INTERPRET
  if (base && process.env.WAKE_SCHEDULER_SECRET) {
    const res = await fetch(base.replace("/interpret", "/decide"), {
      method: "POST",
      headers: { "content-type": "application/json", "x-wake-scheduler-secret": process.env.WAKE_SCHEDULER_SECRET },
      body: JSON.stringify({ packet }), signal: AbortSignal.timeout(100_000),
    })
    const body = await res.json()
    if (!res.ok) throw new Error(`decide route ${res.status}: ${body.error}`)
    return body.decision
  }
  return null
}
