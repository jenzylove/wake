// Quantify a loss path from real chain state.
//
// The blind challenge showed WAKE can do this on a chain it controls. This is the same
// measurement against a public EVM chain: from one transaction receipt it reads the token flows,
// prices them, names the contract that lost the most, and then asks which other contracts hold
// that contract's own token and what their holding is worth before and after.
//
// Everything here is observed or fetched: receipt logs from an RPC, token metadata and holders
// from an explorer, prices from DefiLlama. Nothing is assumed about the protocol's ABI beyond
// the ERC20 calls every token answers, so a protocol WAKE has never seen still measures.

const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
const LLAMA_CHAIN = { "1": "ethereum", "10": "optimism", "56": "bsc", "137": "polygon", "8453": "base", "42161": "arbitrum", "43114": "avax" }
const PUBLIC_RPC = { "1": "https://ethereum.publicnode.com", "10": "https://mainnet.optimism.io", "56": "https://bsc.publicnode.com", "137": "https://polygon-rpc.com", "8453": "https://mainnet.base.org", "42161": "https://arb1.arbitrum.io/rpc" }
const ETHERSCAN = "https://api.etherscan.io/v2/api"

const hexToBig = (h) => BigInt(h === "0x" ? "0x0" : h)
const topicAddr = (t) => `0x${t.slice(26)}`.toLowerCase()
const scale = (v, decimals) => Number(v) / 10 ** decimals

async function rpc(url, method, params) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(30_000) })
  const body = await res.json()
  if (body.error) throw new Error(`${method}: ${body.error.message}`)
  return body.result
}

// One ERC20 view call, decoded as a single word.
async function call(url, to, selector, arg = "", blockTag = "latest") {
  const data = selector + (arg ? arg.replace(/^0x/, "").padStart(64, "0") : "")
  try { return await rpc(url, "eth_call", [{ to, data }, blockTag]) } catch { return null }
}
const SELECTOR = { totalSupply: "0x18160ddd", balanceOf: "0x70a08231", decimals: "0x313ce567", symbol: "0x95d89b41" }

async function tokenMeta(url, token) {
  const [dec, sup] = await Promise.all([call(url, token, SELECTOR.decimals), call(url, token, SELECTOR.totalSupply)])
  return { decimals: dec && dec !== "0x" ? Number(hexToBig(dec)) : 18, isToken: Boolean(sup && sup !== "0x") }
}

/** DefiLlama current prices for a set of token addresses on one chain. */
export async function priceTokens(chainId, tokens) {
  const chain = LLAMA_CHAIN[String(chainId)]
  if (!chain || tokens.length === 0) return {}
  const ids = tokens.map((t) => `${chain}:${t}`).join(",")
  const res = await fetch(`https://coins.llama.fi/prices/current/${ids}`, { signal: AbortSignal.timeout(20_000) })
  if (!res.ok) return {}
  const body = await res.json()
  return Object.fromEntries(Object.entries(body.coins ?? {}).map(([k, v]) => [k.split(":")[1].toLowerCase(), { priceUsd: v.price, symbol: v.symbol, decimals: v.decimals }]))
}

/** Addresses that recently moved a token, from the explorer. Used to find integrator contracts. */
async function recentCounterparties({ chainId, token, etherscanKey, pages = 1 }) {
  if (!etherscanKey) return []
  const out = new Set()
  for (let page = 1; page <= pages; page += 1) {
    const url = new URL(ETHERSCAN)
    url.search = new URLSearchParams({ chainid: String(chainId), module: "account", action: "tokentx", contractaddress: token, page: String(page), offset: "100", sort: "desc", apikey: etherscanKey }).toString()
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
    const body = await res.json()
    if (body.status !== "1" || !Array.isArray(body.result)) break
    for (const t of body.result) { out.add(t.from.toLowerCase()); out.add(t.to.toLowerCase()) }
  }
  return [...out]
}

// No explorer key: read the token's own recent Transfer logs straight from the node. Public RPCs
// cap the range, so this walks back in windows until it has enough addresses or hits the cap.
async function counterpartiesFromLogs({ url, token, toBlock, windows = 6, windowSize = 2_000n }) {
  const out = new Set()
  let end = toBlock
  for (let i = 0; i < windows && out.size < 200; i += 1) {
    const from = end - windowSize + 1n
    try {
      const logs = await rpc(url, "eth_getLogs", [{ address: token, topics: [TRANSFER], fromBlock: `0x${from.toString(16)}`, toBlock: `0x${end.toString(16)}` }])
      for (const l of logs) { if (l.topics.length === 3) { out.add(topicAddr(l.topics[1])); out.add(topicAddr(l.topics[2])) } }
    } catch { break }
    end = from - 1n
  }
  return [...out]
}

/** Transfer logs to a net position per address per token, valued where a price exists. */
export function computeNetFlows(transfers, prices = {}, metas = {}) {
  const net = new Map()
  for (const t of transfers) {
    const dec = prices[t.token]?.decimals ?? metas[t.token]?.decimals ?? 18
    const price = prices[t.token]?.priceUsd ?? null
    for (const [addr, sign] of [[t.from, -1], [t.to, 1]]) {
      if (addr === "0x0000000000000000000000000000000000000000") continue
      const key = `${addr}|${t.token}`
      const prev = net.get(key) ?? { address: addr, token: t.token, amount: 0, usd: price === null ? null : 0, symbol: prices[t.token]?.symbol ?? null }
      const amount = sign * scale(t.value, dec)
      net.set(key, { ...prev, amount: prev.amount + amount, usd: price === null ? null : (prev.usd ?? 0) + amount * price })
    }
  }
  return [...net.values()]
}

/** Total USD lost per address, negative flows only. */
export function lossesByAddress(flows) {
  const losses = new Map()
  for (const f of flows) if ((f.usd ?? 0) < 0) losses.set(f.address, (losses.get(f.address) ?? 0) + f.usd)
  return losses
}

/** Transfer logs of a receipt, decoded. */
export function decodeTransfers(logs = []) {
  return logs
    .filter((l) => l.topics?.[0] === TRANSFER && l.topics.length === 3)
    .map((l) => ({ token: l.address.toLowerCase(), from: topicAddr(l.topics[1]), to: topicAddr(l.topics[2]), value: hexToBig(l.data) }))
}

/**
 * @param {{ chainId: string|number, txHash: string, rpcUrl?: string, etherscanKey?: string, maxHolders?: number }} input
 */
export async function quantifyExposure({ chainId, txHash, rpcUrl, etherscanKey, maxHolders = 25 }) {
  const url = rpcUrl || process.env[`CHAIN_RPC_URL_${chainId}`] || PUBLIC_RPC[String(chainId)]
  if (!url) throw new Error(`no RPC for chain ${chainId}`)
  const receipt = await rpc(url, "eth_getTransactionReceipt", [txHash])
  if (!receipt) throw new Error("receipt not found")
  if (receipt.status !== "0x1") throw new Error("transaction reverted")
  const block = BigInt(receipt.blockNumber)
  const pre = `0x${(block - 1n).toString(16)}`
  const at = `0x${block.toString(16)}`

  // Token flows in this transaction.
  const transfers = decodeTransfers(receipt.logs)
  if (transfers.length === 0) return { quantified: false, reason: "no token transfers in this transaction", chainId: String(chainId), txHash }

  const tokens = [...new Set(transfers.map((t) => t.token))]
  const [prices, metas] = await Promise.all([
    priceTokens(chainId, tokens),
    Promise.all(tokens.map(async (t) => [t, await tokenMeta(url, t)])).then(Object.fromEntries),
  ])

  const flows = computeNetFlows(transfers, prices, metas)

  // The victim is the contract that lost the most value in this transaction.
  const losses = lossesByAddress(flows)
  const ranked = [...losses.entries()].sort((a, b) => a[1] - b[1])
  let victim = null
  for (const [address] of ranked) {
    const code = await rpc(url, "eth_getCode", [address, "latest"])
    if (code && code !== "0x") { victim = address; break }
  }
  if (!victim) return { quantified: false, reason: "no contract lost value in this transaction", chainId: String(chainId), txHash, flows }
  const drainedUsd = Math.abs(losses.get(victim))

  // Is the victim itself a token other protocols can hold? If so, who holds it, and what is that
  // holding worth before and after? That is the downstream exposure, measured, not assumed.
  const victimMeta = await tokenMeta(url, victim)
  const integrators = []
  let holderScan = "skipped: victim does not issue a token"
  if (victimMeta.isToken) {
    let candidates = await recentCounterparties({ chainId, token: victim, etherscanKey })
    let source = "explorer token transfers"
    if (candidates.length === 0) {
      candidates = await counterpartiesFromLogs({ url, token: victim, toBlock: block })
      source = "node Transfer logs"
    }
    holderScan = `${candidates.length} recent counterparties from ${source}`
    const victimPrice = (await priceTokens(chainId, [victim]))[victim]?.priceUsd ?? null
    let checked = 0
    for (const address of candidates) {
      if (checked >= maxHolders) break
      if (address === victim || address === "0x0000000000000000000000000000000000000000") continue
      const code = await rpc(url, "eth_getCode", [address, "latest"])
      if (!code || code === "0x") continue
      checked += 1
      const [before, after] = await Promise.all([call(url, victim, SELECTOR.balanceOf, address, pre), call(url, victim, SELECTOR.balanceOf, address, at)])
      if (!before || before === "0x") continue
      const heldBefore = scale(hexToBig(before), victimMeta.decimals)
      const heldAfter = after && after !== "0x" ? scale(hexToBig(after), victimMeta.decimals) : null
      if (heldBefore <= 0) continue
      integrators.push({ address, heldBefore, heldAfter, holdingValueUsdBefore: victimPrice === null ? null : heldBefore * victimPrice, pricedWith: victimPrice === null ? null : "defillama-current" })
    }
    integrators.sort((a, b) => (b.holdingValueUsdBefore ?? 0) - (a.holdingValueUsdBefore ?? 0))
  }

  return {
    quantified: true,
    chainId: String(chainId),
    txHash,
    block: Number(block),
    victim,
    drainedUsd,
    drainedTokens: flows.filter((f) => f.address === victim && f.amount < 0).map((f) => ({ token: f.token, symbol: f.symbol, amount: f.amount, usd: f.usd })),
    victimIssuesToken: victimMeta.isToken,
    holderScan,
    integrators,
    method: "receipt Transfer logs, ERC20 state at the block before and the block of the exploit, DefiLlama current prices",
  }
}
