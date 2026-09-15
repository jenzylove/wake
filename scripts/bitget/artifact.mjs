// Redacted evidence writer for Bitget Demo interactions.
//
// The project previously asserted in prose that a Demo smoke test had passed,
// with nothing in the repository to show for it. An unevidenced claim about the
// only real exchange interaction in the build is worse than no claim, so every
// authenticated Demo call now writes an artifact.
//
// Credentials must never reach these files. The allow list below is explicit:
// anything not named is dropped rather than filtered, so a new response field
// cannot leak by default.

import { createHash } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"

const ARTIFACT_DIR = process.env.WAKE_BITGET_ARTIFACT_DIR || path.join(process.cwd(), "data", "bitget-demo")

const SECRET_HEADERS = new Set([
  "access-key",
  "access-sign",
  "access-passphrase",
])

/** Headers minus anything that authenticates. Values of secrets are never kept. */
export function redactHeaders(headers = {}) {
  const out = {}
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase()
    if (lower === "host" || lower === "content-type" || lower === "locale" || lower === "paptrading") {
      out[key] = value
    } else if (SECRET_HEADERS.has(lower)) {
      out[key] = "[redacted]"
    }
  }
  return out
}

/**
 * Order parameters are not secret and are the substance of the evidence, so
 * they are kept. Anything unexpected is dropped.
 */
const RESPONSE_FIELDS = ["code", "msg", "requestTime", "data"]

export function redactResponse(payload) {
  if (!payload || typeof payload !== "object") return null
  const out = {}
  for (const field of RESPONSE_FIELDS) {
    if (field in payload) out[field] = payload[field]
  }
  return out
}

/**
 * Writes one interaction to data/bitget-demo/ and returns the path.
 * `label` becomes part of the filename, so keep it short and kebab cased.
 */
export function writeBitgetArtifact({ label, interactions, summary }) {
  mkdirSync(ARTIFACT_DIR, { recursive: true })
  const capturedAt = new Date().toISOString()

  const packet = {
    schema: "wake.bitget-demo.v1",
    capturedAt,
    environment: "bitget-demo-trading",
    paptrading: "1",
    liveTrading: false,
    note: "Bitget Demo Trading only. Credentials and request signatures are redacted; order parameters and exchange responses are preserved verbatim.",
    summary,
    interactions: interactions.map((entry) => ({
      step: entry.step,
      method: entry.method,
      path: entry.path,
      requestBody: entry.requestBody ?? null,
      requestHeaders: redactHeaders(entry.requestHeaders),
      httpStatus: entry.httpStatus ?? null,
      response: redactResponse(entry.response),
      error: entry.error ?? null,
    })),
  }

  const canonical = JSON.stringify(packet)
  const integrity = createHash("sha256").update(canonical).digest("hex")
  const fileName = `${label}-${capturedAt.replace(/[-:TZ.]/g, "").slice(0, 14)}.json`
  const filePath = path.join(ARTIFACT_DIR, fileName)
  writeFileSync(filePath, `${JSON.stringify({ ...packet, integrity }, null, 2)}\n`, "utf8")
  return { filePath, integrity }
}

/**
 * Guard against a credential ever reaching disk. Call before writing if a
 * script assembles its own packet.
 */
export function assertNoSecrets(serialised) {
  const secrets = [process.env.BITGET_API_KEY, process.env.BITGET_SECRET_KEY, process.env.BITGET_PASSPHRASE]
    .filter((value) => typeof value === "string" && value.length >= 8)
  for (const secret of secrets) {
    if (serialised.includes(secret)) throw new Error("Refusing to write artifact: a credential appears in the payload")
  }
}
