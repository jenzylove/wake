// Re-check recorded live incidents against the current detection rules.
//
// When a detection rule tightens, incidents opened under the old rule must be re-examined rather
// than left standing. Anything that no longer qualifies is retracted: its record is removed from
// the queue and a RETRACTED entry, with the reason, is appended to the hash chained log. The log is
// never rewritten, so the original detection and the retraction both stay on the record.

import { existsSync, readdirSync, readFileSync, unlinkSync } from "node:fs"
import path from "node:path"
import { RESTING_MINUTES, WATCHED, confirmDrain } from "../lib/chain-watch.mjs"
import { appendHashLog } from "../lib/hash-log.mjs"

const OUT = path.join(process.cwd(), "data", "live")
const LOG = path.join(OUT, "log.jsonl")
if (!existsSync(OUT)) process.exit(0)

const records = readdirSync(OUT)
  .filter((f) => f.startsWith("live-") && f.endsWith(".json"))
  .map((f) => ({ file: path.join(OUT, f), r: JSON.parse(readFileSync(path.join(OUT, f), "utf8")) }))

// A contract recorded as drained more than once is being refilled: a forwarder, not a victim.
const perContract = new Map()
for (const { r } of records) perContract.set(r.detection.contract, (perContract.get(r.detection.contract) ?? 0) + 1)

const retracted = []
for (const { file, r } of records) {
  let reason = null
  if (perContract.get(r.detection.contract) > 1) {
    reason = `recurring outflow: the same contract emptied itself ${perContract.get(r.detection.contract)} times`
  } else {
    const chain = WATCHED[r.chain.id]
    const token = Object.entries(chain.tokens).find(([, m]) => m.symbol === r.detection.asset)?.[0]
    try {
      const check = await confirmDrain({
        url: chain.rpc, fallbacks: chain.fallbacks ?? [],
        restingBlocks: Math.ceil((RESTING_MINUTES * 60) / chain.blockSeconds),
        transfer: { from: r.detection.contract, token, block: r.detection.block, tx: r.detection.tx },
      })
      if (!check.candidate) reason = check.reason
    } catch (error) {
      console.log(`could not re-check ${r.id}: ${String(error.message ?? error).slice(0, 90)}`)
    }
  }
  if (!reason) continue
  unlinkSync(file)
  appendHashLog(LOG, { event: "RETRACTED", id: r.id, tx: r.detection.tx, contract: r.detection.contract, reason, originalIntegrity: r.integrity })
  retracted.push({ id: r.id, reason })
}

console.log(JSON.stringify({ checked: records.length, retracted: retracted.length, kept: records.length - retracted.length, retracted_detail: retracted }, null, 2))
