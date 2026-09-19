// Claude's role in WAKE: meaning, never money.
//
// Given the evidence packet deterministic code built (trace, authorisation, backing, integrators,
// candidates, numbers), Claude names the exploit mechanism, says who bears the loss, and writes
// the explanation a trader reads. It may VETO: if the evidence does not support the loss path,
// its veto becomes a blocking falsifier and the policy holds. It can never create a trade,
// change a number, pick an instrument or size a position. A missing or failed review changes
// nothing: the deterministic decision stands and the record says the review did not run.

const API = "https://api.anthropic.com/v1/messages"
const CLASSES = ["access-control", "reinitialisation", "unauthorised-redemption", "oracle-manipulation", "reentrancy", "key-compromise", "authorised-operation", "bridge", "other", "unknown"]

const SYSTEM = `You are the incident investigator inside WAKE, an autonomous trading agent. You receive an evidence packet built by deterministic code from raw chain data. Your job is meaning: name the exploit mechanism, say which entity actually bears the loss, and explain it in plain language for a trader. Use only the supplied evidence. Never invent facts, prices, amounts, counterparties or sources. Numbers are owned by code: repeat them only as given.
You may veto a trade when the evidence does not support the proposed loss path (for example the outflow looks authorised, the integrator exposure is not shown, or the mechanism is ambiguous). Veto only for a reason grounded in the packet. You cannot propose trades, instruments or sizes.
Return JSON only:
{"exploitClass": one of ${JSON.stringify(CLASSES)}, "mechanism": string (<=400 chars), "lossBearer": string (<=200 chars), "narrative": string (<=700 chars), "veto": boolean, "vetoReason": string or null, "concerns": string[] (<=4 items, each <=200 chars)}`

/** @param {unknown} packet @param {{ apiKey: string, model?: string }} opts */
export async function interpretIncident(packet, opts) {
  try { return await interpretOnce(packet, opts) } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    return interpretOnce(packet, opts)
  }
}

async function interpretOnce(packet, { apiKey, model = "claude-opus-5" }) {
  const res = await fetch(API, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: 3000, system: SYSTEM, messages: [{ role: "user", content: JSON.stringify(packet) }] }),
    signal: AbortSignal.timeout(90_000),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${body.error?.message ?? "request failed"}`)
  const text = body.content?.filter((c) => c.type === "text").map((c) => c.text).join("\n") ?? ""
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)
  return validateInterpretation(JSON.parse(json), model)
}

/** @param {any} r @param {string | null} [model] */
export function validateInterpretation(r, model = null) {
  const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : "")
  if (typeof r !== "object" || r === null) throw new Error("interpretation is not an object")
  return {
    model,
    exploitClass: CLASSES.includes(r.exploitClass) ? r.exploitClass : "unknown",
    mechanism: str(r.mechanism, 400),
    lossBearer: str(r.lossBearer, 200),
    narrative: str(r.narrative, 700),
    veto: r.veto === true,
    vetoReason: r.veto === true ? str(r.vetoReason, 300) || "no reason given" : null,
    concerns: Array.isArray(r.concerns) ? r.concerns.slice(0, 4).map((c) => str(c, 200)) : [],
  }
}

/** The only way Claude's review reaches the decision: a veto becomes a blocking falsifier. */
export function aiFalsifier(ai) {
  const question = "Does the investigator's review support the loss path?"
  if (!ai) return { key: "ai-review", question, status: "NOT_RUN", blocksTrade: false }
  return { key: "ai-review", question, status: ai.veto ? "SUPPORTED" : "REJECTED", blocksTrade: ai.veto, answer: ai.veto ? ai.vetoReason : ai.mechanism }
}

/** Local key if present, else the deployed route with the scheduler token, else no review. */
export async function interpretAnywhere(packet) {
  if (process.env.ANTHROPIC_API_KEY) return interpretIncident(packet, { apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.ANTHROPIC_MODEL || "claude-opus-5" })
  const endpoint = process.env.WAKE_AGENT_INTERPRET
  if (endpoint && process.env.WAKE_SCHEDULER_SECRET) {
    const res = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", "x-wake-scheduler-secret": process.env.WAKE_SCHEDULER_SECRET }, body: JSON.stringify({ packet }), signal: AbortSignal.timeout(100_000) })
    const body = await res.json()
    if (!res.ok) throw new Error(`interpret route ${res.status}: ${body.error}`)
    return body.interpretation
  }
  return null
}
