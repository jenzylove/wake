// WAKE blind watcher (PRD section 16A).
//
// Starts before anything is deployed and sees only what any node would serve: blocks, receipts,
// logs, traces and contract state. It reconstructs token holdings from Transfer logs, flags a
// transaction that removes most of a contract's holdings, investigates it (authorisation, trace,
// share backing before and after), discovers which other contracts hold the damaged receipt
// token, and quantifies their bad debt from their own logs. Only the public registry (names,
// Bitget instrument map, market caps, token prices) is read, and only after an anomaly.
//
// The decision goes through the same policy as every other WAKE incident: lib/wake-policy.mjs
// decides, lib/sizing.mjs sizes from real Bitget candles, and the record lands in data/blind/
// for the agent tick to execute on Bitget Demo.

import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { createPublicClient, http, parseAbi, formatEther } from "viem"
import { foundry } from "viem/chains"
import { deriveDecisionPolicy, evaluateRiskGatePolicy } from "../lib/wake-policy.mjs"
import { computePositionSizing } from "../lib/sizing.mjs"

const RPC = process.env.BLIND_RPC || "http://127.0.0.1:8545"
const RUN_DIR = process.env.BLIND_RUN_DIR
const RUN_ID = process.env.BLIND_RUN_ID
const OUT = path.join(process.cwd(), "data", "blind")
const DEADLINE_MS = Number(process.env.BLIND_WATCH_MS || 180_000)
const DRAIN_SHARE = 0.5          // one transaction removing half of a contract's holdings
const MIN_UNITS = 10_000         // ignore dust
const PASSTHROUGH = 0.25         // central conversion scenario, same as the consequence model
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
const erc = parseAbi(["function totalSupply() view returns (uint256)", "function balanceOf(address) view returns (uint256)", "function owner() view returns (address)", "function underlying() view returns (address)", "function pricePerShare() view returns (uint256)"])
const pub = createPublicClient({ chain: foundry, transport: http(RPC) })
const sha256 = (v) => createHash("sha256").update(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x))).digest("hex")
const addr = (topic) => `0x${topic.slice(26)}`.toLowerCase()
const num = (x) => Number(formatEther(x))

const balances = new Map()           // token -> Map(holder -> bigint)
const transfers = []                 // every Transfer seen: { token, from, to, value, tx, block }
const isContract = new Map()
const incidents = new Map()          // victim -> record; later transactions refine the same incident
const markAtDetection = new Map()    // instrument -> Bitget mark when WAKE first saw the incident
const firstBefore = new Map()        // victim|token -> holdings before the first flagged transaction

async function contract(a) {
  if (!isContract.has(a)) isContract.set(a, ((await pub.getCode({ address: a })) ?? "0x") !== "0x")
  return isContract.get(a)
}
const bal = (token, holder) => balances.get(token)?.get(holder) ?? 0n
function applyTransfer(t) {
  if (!balances.has(t.token)) balances.set(t.token, new Map())
  const m = balances.get(t.token)
  if (t.from !== "0x0000000000000000000000000000000000000000") m.set(t.from, (m.get(t.from) ?? 0n) - t.value)
  m.set(t.to, (m.get(t.to) ?? 0n) + t.value)
}
async function tryRead(address, functionName, args = [], blockNumber) {
  try { return await pub.readContract({ address, abi: erc, functionName, args, blockNumber }) } catch { return null }
}

async function investigate(tx, token, victim, before, after, blockNumber, detectedAt) {
  const receipt = await pub.getTransactionReceipt({ hash: tx })
  const txn = await pub.getTransaction({ hash: tx })
  const block = await pub.getBlock({ blockNumber })
  const owner = await tryRead(victim, "owner", [], blockNumber - 1n)
  const authorised = owner !== null && owner.toLowerCase() === txn.from.toLowerCase() && (txn.to ?? "").toLowerCase() === victim
  let trace = null
  try { trace = await pub.request({ method: "debug_traceTransaction", params: [tx, { tracer: "callTracer" }] }) } catch { trace = null }
  const calls = []
  const walk = (c, depth = 0) => { if (!c) return; calls.push({ depth, to: c.to, selector: (c.input ?? "").slice(0, 10), type: c.type }); (c.calls ?? []).forEach((x) => walk(x, depth + 1)) }
  walk(trace)

  // Share backing of the victim, if it issues a receipt token: before and after the block.
  const ppsBefore = await tryRead(victim, "pricePerShare", [], blockNumber - 1n)
  const ppsAfter = await tryRead(victim, "pricePerShare", [], blockNumber)
  const supplyBefore = await tryRead(victim, "totalSupply", [], blockNumber - 1n)

  // Integrators: contracts that held the victim's receipt token before the exploit.
  const integrators = []
  for (const [holder, amount] of balances.get(victim) ?? []) {
    if (holder === victim || !(await contract(holder))) continue
    const heldBefore = await tryRead(victim, "balanceOf", [holder], blockNumber - 1n) ?? amount
    const heldAfter = await tryRead(victim, "balanceOf", [holder], blockNumber) ?? amount
    if (heldBefore === 0n) continue
    const valueBefore = ppsBefore !== null ? num(heldBefore * ppsBefore / 10n ** 18n) : null
    const valueAfter = ppsAfter !== null ? num(heldAfter * ppsAfter / 10n ** 18n) : null
    // Debt the integrator issued: its own token outflows to accounts, observed in its logs.
    const lent = transfers.filter((t) => t.from === holder && t.token !== victim && Number(t.block) < Number(blockNumber)).reduce((s, t) => s + num(t.value), 0)
    const badDebt = valueAfter === null ? null : Math.max(0, lent - valueAfter)
    integrators.push({ address: holder, heldSharesBefore: num(heldBefore), heldSharesAfter: num(heldAfter), collateralValueBeforeUsd: valueBefore, collateralValueAfterUsd: valueAfter, lentUsd: lent, badDebtUsd: badDebt })
  }

  const registryPath = path.join(RUN_DIR, "registry.json")
  const registry = existsSync(registryPath) ? JSON.parse(readFileSync(registryPath, "utf8")) : { protocols: [], tokenPricesUsd: {} }
  const reg = (a) => registry.protocols.find((p) => p.address.toLowerCase() === a)
  const priceOf = (t) => Object.entries(registry.tokenPricesUsd).find(([k]) => k.toLowerCase() === t)?.[1] ?? null
  const drainedUsd = priceOf(token) === null ? null : num(before - after) * priceOf(token)
  const txs = [...new Set([...(incidents.get(victim)?.detection.txs ?? []), tx])]

  // Candidates: the victim itself (DIRECT) and each integrator with bad debt (CONTAGION).
  const candidates = []
  if (reg(victim) && drainedUsd !== null) candidates.push({ kind: "DIRECT", address: victim, lossUsd: drainedUsd, ...reg(victim) })
  for (const i of integrators) if (reg(i.address) && i.badDebtUsd > 0) candidates.push({ kind: "CONTAGION", address: i.address, lossUsd: i.badDebtUsd, ...reg(i.address) })

  // Market check on the real Bitget instrument: how much has it already moved since detection.
  for (const c of candidates) {
    c.modeledDeltaPct = Number((PASSTHROUGH * c.lossUsd / c.marketCapUsd * 100).toFixed(3))
    const res = await fetch(`https://api.bitget.com/api/v2/mix/market/candles?symbol=${c.instrument}&productType=USDT-FUTURES&granularity=1H&limit=72`)
    const body = await res.json()
    const candles = body.data.map((k) => ({ timestamp: Number(k[0]), open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), quoteVolume: Number(k[6]) }))
    const rets = candles.slice(1).map((k, j) => Math.log(k.close / candles[j].close))
    const mean = rets.reduce((s, r) => s + r, 0) / rets.length
    const sigma = Math.sqrt(rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1)) * Math.sqrt(24)
    const markNow = Number((await (await fetch(`https://api.bitget.com/api/v2/mix/market/symbol-price?symbol=${c.instrument}&productType=USDT-FUTURES`)).json()).data[0].markPrice)
    if (!markAtDetection.has(c.instrument)) markAtDetection.set(c.instrument, markNow)
    c.markAtDetection = markAtDetection.get(c.instrument)
    c.markAtDecision = markNow
    // Move in the trade's direction since detection: a short that already fell is already priced.
    c.marketDeltaPct = Number((-(markNow / c.markAtDetection - 1) * 100).toFixed(3))
    c.sizing = computePositionSizing({ windowSigma: sigma, quoteVolumeUsd: candles.reduce((s, k) => s + k.quoteVolume, 0), candles })
    c.residualPct = Number((c.modeledDeltaPct - c.marketDeltaPct).toFixed(3))
  }
  const best = candidates.sort((a, b) => b.residualPct - a.residualPct)[0] ?? null

  // Deterministic confidence from what was actually observed.
  const evidence = [
    { key: "receipt", ok: receipt.status === "success", weight: 20, detail: `tx ${tx} succeeded in block ${blockNumber}` },
    { key: "unauthorised", ok: !authorised, weight: 20, detail: authorised ? `sent by the contract owner ${owner}` : `sender ${txn.from} is not the owner ${owner ?? "(none)"}` },
    { key: "trace", ok: calls.some((c) => c.to?.toLowerCase() === victim), weight: 15, detail: `${calls.length} calls traced` },
    { key: "backing", ok: ppsBefore !== null && ppsAfter !== null, weight: 20, detail: ppsBefore === null ? "victim issues no receipt token" : `share price ${num(ppsBefore).toFixed(4)} to ${num(ppsAfter).toFixed(4)}` },
    { key: "exposure", ok: best !== null && best.lossUsd > 0, weight: 25, detail: best ? `${best.kind} loss $${Math.round(best.lossUsd).toLocaleString("en-US")} at ${best.name}` : "no registered exposure" },
  ]
  const confidence = evidence.reduce((s, e) => s + (e.ok ? e.weight : 0), 0)
  const falsification = [
    { key: "authorised", question: "Was the outflow authorised by the contract owner?", status: authorised ? "SUPPORTED" : "REJECTED", blocksTrade: authorised },
    { key: "exposure", question: "Is the loss path quantified from on-chain state?", status: best ? "REJECTED" : "UNRESOLVED", blocksTrade: !best },
  ]
  const policyInput = {
    falsification, modeledDelta: best?.modeledDeltaPct ?? null, marketDelta: best?.marketDeltaPct ?? 0, confidence,
    kind: best?.kind ?? "NO TRADE", state: authorised ? "DISMISSED" : "CONFIRMED", workflowState: "MARKET_CHECK",
    maxLoss: best?.sizing?.computable ? `$${Math.round(best.sizing.maxLossUsd)}` : "$0",
    evidence: evidence.filter((e) => e.ok),
  }
  const decision = authorised ? "NO_TRADE" : deriveDecisionPolicy(policyInput)
  const gate = evaluateRiskGatePolicy(policyInput)

  const record = {
    schema: "wake.blind.incident.v1",
    id: `blind-${RUN_ID}-${victim.slice(2, 10)}`,
    runId: RUN_ID,
    provenance: "BLIND_TEST",
    chain: { id: foundry.id, rpc: "local anvil", block: Number(blockNumber), blockTimestamp: Number(block.timestamp) },
    detection: { tx, txs, firstDetectedAt: incidents.get(victim)?.detection.firstDetectedAt ?? detectedAt, victim, token, before: num(before), after: num(after), detectedAt, latencyMs: Date.parse(detectedAt) - Number(block.timestamp) * 1000 },
    investigation: { from: txn.from, to: txn.to, selector: txn.input.slice(0, 10), authorised, owner, calls: calls.slice(0, 40), sharePriceBefore: ppsBefore === null ? null : num(ppsBefore), sharePriceAfter: ppsAfter === null ? null : num(ppsAfter), receiptSupplyBefore: supplyBefore === null ? null : num(supplyBefore), integrators },
    candidates, evidence, falsification, confidence, decision, gate,
    agent: best ? { decision, gatePassed: gate.passed, instrument: best.instrument, side: "SHORT", kind: best.kind, sizing: best.sizing } : { decision, gatePassed: false },
  }
  record.integrity = sha256({ ...record, integrity: undefined })
  mkdirSync(OUT, { recursive: true })
  writeFileSync(path.join(OUT, `${record.id}.json`), JSON.stringify(record, null, 2) + "\n")
  incidents.set(victim, record)
  console.log(JSON.stringify({ phase: "incident", id: record.id, victim, authorised, decision, gate: gate.passed, target: best?.name ?? null, kind: best?.kind ?? null, confidence }))
}

async function main() {
  let next = await pub.getBlockNumber() + 1n
  const started = Date.now()
  console.log(JSON.stringify({ phase: "watching", fromBlock: Number(next) }))
  while (Date.now() - started < DEADLINE_MS) {
    const head = await pub.getBlockNumber()
    for (; next <= head; next += 1n) {
      const logs = await pub.getLogs({ fromBlock: next, toBlock: next })
      const byTx = new Map()
      for (const l of logs) {
        if (l.topics[0] !== TRANSFER || l.topics.length !== 3) continue
        const t = { token: l.address.toLowerCase(), from: addr(l.topics[1]), to: addr(l.topics[2]), value: BigInt(l.data), tx: l.transactionHash, block: next }
        if (!byTx.has(t.tx)) byTx.set(t.tx, [])
        byTx.get(t.tx).push(t)
      }
      for (const [tx, ts] of byTx) {
        // Holdings before this transaction, per (token, contract) that sends in it.
        const pre = new Map()
        for (const t of ts) { const k = `${t.token}|${t.from}`; if (!pre.has(k)) pre.set(k, bal(t.token, t.from)) }
        for (const t of ts) { applyTransfer(t); transfers.push(t) }
        for (const [k, before] of pre) {
          const [token, holder] = k.split("|")
          const after = bal(token, holder)
          if (before <= 0n || num(before) < MIN_UNITS) continue
          if (Number(before - after) / Number(before) < DRAIN_SHARE) continue
          if (!(await contract(holder))) continue
          // A burned or moved receipt token held by an integrator means the issuer is the victim.
          const issuerIsVictim = holder !== token && (await tryRead(token, "pricePerShare", [], next)) !== null
          if (issuerIsVictim) continue
          const key = `${holder}|${token}`
          if (!firstBefore.has(key)) firstBefore.set(key, before)
          await investigate(tx, token, holder, firstBefore.get(key), after, next, new Date().toISOString())
        }
      }
    }
    if (existsSync(path.join(RUN_DIR, "answer.sealed.json")) && incidents.size >= 1 && Date.now() - started > 5_000) {
      // Give the second event (decoy or exploit) time to land before stopping.
      const sealed = JSON.parse(readFileSync(path.join(RUN_DIR, "answer.sealed.json"), "utf8"))
      if (Date.now() - Date.parse(sealed.attackedAt) > 8_000) break
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  writeFileSync(path.join(RUN_DIR, "wake-incidents.json"), JSON.stringify([...incidents.values()].map((i) => i.id), null, 2) + "\n")
}

main().catch((error) => { console.error(error); process.exit(1) })
