// Escalate a discovered incident with its exploit transaction receipt.
//
// The exploit feed does not publish transaction hashes, so this is the one step that takes an
// input: the hash. Everything else is fetched: the receipt comes from the chain, and it is only
// attached if the transaction exists and succeeded. The decision is then recomputed by the
// discovery run; the receipt resolves one blocker, the unquantified exposure still holds it.
//
// Run:  node scripts/attach-receipt.mjs <discovered-id> <chainId> <txHash>

import { createHash } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const PUBLIC_RPC = { "1": "https://ethereum.publicnode.com", "56": "https://bsc.publicnode.com", "8453": "https://mainnet.base.org", "42161": "https://arb1.arbitrum.io/rpc" }
const [id, chainId, txHash] = process.argv.slice(2)
if (!id || !chainId || !/^0x[0-9a-fA-F]{64}$/.test(txHash ?? "")) {
  console.error("usage: node scripts/attach-receipt.mjs <discovered-id> <chainId> <txHash>")
  process.exit(2)
}
const dir = path.join(process.cwd(), "data", "discovered")
const file = path.join(dir, `${id}.json`)
if (!existsSync(file)) throw new Error(`unknown discovered incident ${id}`)
const rpc = process.env[`CHAIN_RPC_URL_${chainId}`] || PUBLIC_RPC[chainId]
if (!rpc) throw new Error(`no RPC for chain ${chainId}; set CHAIN_RPC_URL_${chainId}`)

const res = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [txHash] }) })
const { result } = await res.json()
if (!result) throw new Error("receipt not found on chain")
if (result.status !== "0x1") throw new Error("transaction reverted; not evidence of a loss")

const sha256 = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex")
const record = JSON.parse(readFileSync(file, "utf8"))
record.receipt = { chainId, txHash, blockNumber: result.blockNumber, from: result.from, to: result.to, logCount: result.logs.length, fetchedAt: new Date().toISOString(), rpcHost: new URL(rpc).host, sha256: sha256(result) }
record.nextStep = "Quantify the downstream exposure from protocol state to clear the last blocker."
record.integrity = sha256({ ...record, integrity: undefined })
writeFileSync(file, JSON.stringify(record, null, 2) + "\n")
console.log(JSON.stringify(record.receipt, null, 2))
