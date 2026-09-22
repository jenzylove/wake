// Live drain detection on public chains.
//
// The blind challenge proved the detector works on a chain WAKE controls. This is the same
// signature applied to mainnet, in near real time: a single transaction that removes most of a
// contract's balance of a major asset. That is what a drain looks like from the outside, and it is
// cheap to test because it needs only Transfer logs and two balance reads.
//
// Scanning every token would be unaffordable on a public node, so the watcher listens to a short
// list of assets that carry real value, then verifies each candidate against contract state. A
// large transfer alone is not a signal: routers, bridges and treasuries move size all day. The
// signature is the sender keeping almost nothing afterwards.

const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"

// Assets worth watching, per chain. Stablecoins and wrapped majors are where drained value lands.
export const WATCHED = {
  "1": {
    name: "ethereum",
    rpc: "https://ethereum.publicnode.com",
    fallbacks: ["https://eth.drpc.org", "https://eth.llamarpc.com", "https://ethereum-rpc.publicnode.com", "https://1rpc.io/eth"],
    blockSeconds: 12,
    tokens: {
      "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": { symbol: "USDC", decimals: 6, usd: 1 },
      "0xdac17f958d2ee523a2206206994597c13d831ec7": { symbol: "USDT", decimals: 6, usd: 1 },
      "0x6b175474e89094c44da98b954eedeac495271d0f": { symbol: "DAI", decimals: 18, usd: 1 },
      "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": { symbol: "WETH", decimals: 18, usd: null },
    },
  },
  "8453": {
    name: "base",
    rpc: "https://base.publicnode.com",
    fallbacks: ["https://mainnet.base.org", "https://base.llamarpc.com", "https://1rpc.io/base"],
    blockSeconds: 2,
    tokens: {
      "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": { symbol: "USDC", decimals: 6, usd: 1 },
      "0x4200000000000000000000000000000000000006": { symbol: "WETH", decimals: 18, usd: null },
    },
  },
  "42161": {
    name: "arbitrum",
    rpc: "https://arb1.arbitrum.io/rpc",
    fallbacks: ["https://arbitrum.publicnode.com", "https://arbitrum.drpc.org", "https://arbitrum-one-rpc.publicnode.com"],
    blockSeconds: 0.25,
    tokens: {
      "0xaf88d065e77c8cc2239327c5edb3a432268e5831": { symbol: "USDC", decimals: 6, usd: 1 },
      "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9": { symbol: "USDT", decimals: 6, usd: 1 },
      "0x82af49447d8a07e3bd95bd0d56f35241523fbab1": { symbol: "WETH", decimals: 18, usd: null },
    },
  },
}

/**
 * Resolve a chain-specific provider without making a generic RPC secret serve the wrong chain.
 * CHAIN_RPC_URL is retained as the Ethereum-only compatibility variable; other chains should use
 * CHAIN_RPC_URL_<chainId> so an archive-capable provider can be supplied where historical state
 * reads are required.
 */
export function chainConfig(chainId) {
  const id = String(chainId)
  const base = WATCHED[id]
  if (!base) throw new Error(`unsupported watched chain: ${id}`)
  const override = process.env[`CHAIN_RPC_URL_${id}`] || (id === "1" ? process.env.CHAIN_RPC_URL : null)
  if (!override) return base
  return { ...base, rpc: override, fallbacks: [base.rpc, ...(base.fallbacks ?? [])].filter((x, i, a) => a.indexOf(x) === i) }
}

export const MIN_DRAIN_USD = Number(process.env.WAKE_LIVE_MIN_USD || 250_000)
export const DRAIN_SHARE = 0.6   // the sender keeps less than 40% of what it held
export const RESTING_SHARE = 0.5 // at least half of it must have been sitting there an hour earlier
export const RESTING_MINUTES = 60

/** Funds that arrived and left inside one pass are a flow, not a loss. */
export function recurringSenders(transfers, minCount = 2) {
  const count = new Map()
  const seenTx = new Set()
  for (const t of transfers) {
    const key = `${t.from}|${t.tx}`
    if (seenTx.has(key)) continue
    seenTx.add(key)
    count.set(t.from, (count.get(t.from) ?? 0) + 1)
  }
  return new Set([...count].filter(([, n]) => n >= minCount).map(([a]) => a))
}

const hexToBig = (h) => BigInt(h === "0x" || !h ? "0x0" : h)
const topicAddr = (t) => `0x${t.slice(26)}`.toLowerCase()
const ZERO = "0x0000000000000000000000000000000000000000"

/**
 * One JSON-RPC call, with the chain's spare endpoints tried in turn. Public nodes rate limit and
 * go down; a watcher that gives up on the first refusal simply stops watching.
 */
export async function rpc(url, method, params, attempts = 3, fallbacks = []) {
  const endpoints = [url, ...fallbacks]
  let last
  for (let i = 0; i < attempts * endpoints.length; i += 1) {
    const endpoint = endpoints[i % endpoints.length]
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(45_000),
      })
      const body = await res.json()
      if (body.error) throw new Error(body.error.message)
      return body.result
    } catch (error) {
      last = error
      // A size or range refusal is the caller's problem to solve, not something to retry.
      if (/too large|exceeds limit|range/i.test(String(error.message ?? error))) throw error
      await new Promise((r) => setTimeout(r, 500 * (Math.floor(i / endpoints.length) + 1)))
    }
  }
  throw new Error(`${method}: ${last?.message ?? last}`)
}

/** Transfers of the watched assets in a block range, already sized in USD where a price is known. */
export async function watchedTransfers({ url, tokens, fromBlock, toBlock, ethUsd, fallbacks = [] }) {
  const logs = await rpc(url, "eth_getLogs", [{
    address: Object.keys(tokens),
    topics: [TRANSFER],
    fromBlock: `0x${fromBlock.toString(16)}`,
    toBlock: `0x${toBlock.toString(16)}`,
  }], 2, fallbacks)
  return logs
    .filter((l) => l.topics.length === 3)
    .map((l) => {
      const token = l.address.toLowerCase()
      const meta = tokens[token]
      const amount = Number(hexToBig(l.data)) / 10 ** meta.decimals
      const usd = meta.usd === null ? amount * (ethUsd ?? 0) : amount * meta.usd
      return {
        token, symbol: meta.symbol, amount, usd,
        from: topicAddr(l.topics[1]), to: topicAddr(l.topics[2]),
        tx: l.transactionHash, block: Number(l.blockNumber),
      }
    })
    .filter((t) => t.from !== ZERO && t.usd >= MIN_DRAIN_USD)
}

/**
 * A large transfer is only a candidate when the sender is a contract that kept almost nothing.
 * Both balances are read at specific blocks, so this is state, not inference.
 */
export async function confirmDrain({ url, transfer, fallbacks = [], restingBlocks = 0 }) {
  const code = await rpc(url, "eth_getCode", [transfer.from, "latest"], 3, fallbacks)
  if (!code || code === "0x") return { candidate: false, reason: "sender is not a contract" }
  const balanceOf = async (block) => {
    const data = `0x70a08231${transfer.from.slice(2).padStart(64, "0")}`
    const raw = await rpc(url, "eth_call", [{ to: transfer.token, data }, block], 3, fallbacks)
    if (typeof raw !== "string") throw new Error("node returned no balance for that block")
    return Number(hexToBig(raw))
  }
  const before = await balanceOf(`0x${(transfer.block - 1).toString(16)}`)
  const after = await balanceOf(`0x${transfer.block.toString(16)}`)
  if (!(before > 0)) return { candidate: false, reason: "sender held none of the asset beforehand" }
  const removed = (before - after) / before
  if (removed < DRAIN_SHARE) {
    return { candidate: false, reason: `sender kept ${Math.round((1 - removed) * 100)}% of its balance`, removedShare: removed }
  }
  // An exploit takes value that was resting in a contract. A forwarder, router or settlement
  // contract receives funds and sends them straight on, so its balance an hour earlier was empty.
  if (restingBlocks > 0) {
    const earlier = await balanceOf(`0x${Math.max(0, transfer.block - restingBlocks).toString(16)}`)
    if (earlier < before * RESTING_SHARE) {
      return { candidate: false, reason: "pass-through: the funds arrived within the hour and left again", removedShare: removed }
    }
  }
  return { candidate: true, removedShare: removed, balanceBefore: before, balanceAfter: after }
}

/** Blocks to scan for one pass, bounded so a public node is never asked for too much at once. */
// A late scheduled run catches up on up to three hours of blocks rather than skipping them; a
// first pass still looks back only a short way.
export function scanWindow({ head, lastScanned, blockSeconds, maxMinutes = 180, firstMinutes = 25 }) {
  const maxBlocks = Math.ceil((maxMinutes * 60) / blockSeconds)
  const from = lastScanned ? Math.max(lastScanned + 1, head - maxBlocks) : head - Math.ceil((firstMinutes * 60) / blockSeconds)
  return { from: Math.max(0, from), to: head, skipped: lastScanned ? Math.max(0, head - maxBlocks - lastScanned) : 0 }
}
