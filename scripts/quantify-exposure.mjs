// Measure a real incident's loss path from chain state, and attach it to the incident.
//
// This is the step that lets a discovered incident leave MONITOR. Discovery opens an
// investigation from a feed entry; `attach-receipt` proves the transaction happened; this reads
// what the transaction actually did: which contract lost value, how much in dollars, and which
// other contracts hold that contract's token and how much that holding is worth. With both
// blockers cleared the policy can reach a trade decision on its own.
//
// Run:  node scripts/quantify-exposure.mjs <chainId> <txHash> [discovered-id]

import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { quantifyExposure } from "../lib/onchain-exposure.mjs"

const [chainId, txHash, discoveredId] = process.argv.slice(2)
if (!chainId || !/^0x[0-9a-fA-F]{64}$/.test(txHash ?? "")) {
  console.error("usage: node scripts/quantify-exposure.mjs <chainId> <txHash> [discovered-id]")
  process.exit(2)
}

const sha256 = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex")
const result = await quantifyExposure({ chainId, txHash, etherscanKey: process.env.ETHERSCAN_API_KEY })
result.measuredAt = new Date().toISOString()

const dir = path.join(process.cwd(), "data", "exposure")
mkdirSync(dir, { recursive: true })
const file = path.join(dir, `${chainId}-${txHash.slice(2, 14)}.json`)
writeFileSync(file, JSON.stringify(result, null, 2) + "\n")

if (discoveredId) {
  const target = path.join(process.cwd(), "data", "discovered", `${discoveredId}.json`)
  if (!existsSync(target)) throw new Error(`unknown discovered incident ${discoveredId}`)
  const record = JSON.parse(readFileSync(target, "utf8"))
  if (!record.receipt || record.receipt.txHash.toLowerCase() !== txHash.toLowerCase()) {
    throw new Error("attach the matching receipt first: node scripts/attach-receipt.mjs")
  }
  record.exposure = result
  record.nextStep = result.quantified
    ? "Both blockers are cleared. The next discovery run recomputes the decision from the measured loss path."
    : `Exposure could not be measured: ${result.reason}. The incident stays at MONITOR.`
  record.integrity = sha256({ ...record, integrity: undefined })
  writeFileSync(target, JSON.stringify(record, null, 2) + "\n")
}

console.log(JSON.stringify({ file, quantified: result.quantified, victim: result.victim, drainedUsd: result.drainedUsd, integrators: result.integrators?.length ?? 0, attachedTo: discoveredId ?? null }, null, 2))
