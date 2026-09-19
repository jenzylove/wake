import { createHash } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"

const NL = String.fromCharCode(10)
export const sha256 = (v) => createHash("sha256").update(typeof v === "string" ? v : JSON.stringify(v)).digest("hex")

/** Append one entry to a hash chained JSONL log. Each entry commits to the one before it. */
export function appendHashLog(file, entry, at = new Date().toISOString()) {
  const lines = existsSync(file) ? readFileSync(file, "utf8").split(NL).filter(Boolean) : []
  const prevHash = lines.length ? JSON.parse(lines[lines.length - 1]).hash : "0".repeat(64)
  const body = { ...entry, at, prevHash }
  const line = { ...body, hash: sha256(body) }
  writeFileSync(file, lines.concat(JSON.stringify(line)).join(NL) + NL)
  return line
}

/** Replays a hash chained log and checks every link. */
export function verifyHashLog(file) {
  if (!existsSync(file)) return { ok: true, entries: 0 }
  const lines = readFileSync(file, "utf8").split(NL).filter(Boolean)
  let prev = "0".repeat(64)
  for (const [i, line] of lines.entries()) {
    const { hash, ...body } = JSON.parse(line)
    if (body.prevHash !== prev) return { ok: false, entries: lines.length, brokenAt: i, reason: "prevHash does not match the previous entry" }
    if (sha256(body) !== hash) return { ok: false, entries: lines.length, brokenAt: i, reason: "entry hash does not match its contents" }
    prev = hash
  }
  return { ok: true, entries: lines.length, head: prev }
}
