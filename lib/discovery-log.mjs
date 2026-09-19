import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"

const sha256 = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex")

/** Replays the append only discovery log and checks every link of the hash chain. */
export function verifyDiscoveryLog(file) {
  if (!existsSync(file)) return { ok: true, entries: 0 }
  const lines = readFileSync(file, "utf8").split(String.fromCharCode(10)).filter(Boolean)
  let prev = "0".repeat(64)
  for (const [i, line] of lines.entries()) {
    const { hash, ...body } = JSON.parse(line)
    if (body.prevHash !== prev) return { ok: false, entries: lines.length, brokenAt: i, reason: "prevHash does not match the previous entry" }
    if (sha256(body) !== hash) return { ok: false, entries: lines.length, brokenAt: i, reason: "entry hash does not match its contents" }
    prev = hash
  }
  return { ok: true, entries: lines.length, head: prev }
}
