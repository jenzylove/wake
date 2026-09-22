// Supply to exchange: a holder moving a large block of a token onto an exchange, where it can be sold.
//
// Exploits are rare. Supply shocks are not: every day, team, treasury, unlock and long held
// wallets send tokens to exchanges, and some of those blocks are large against what the market
// trades. WAKE watches the four Ethereum tokens that have a perpetual on Bitget Demo, finds the
// deposits, and measures each one against the token's real daily volume before anyone decides.
//
// Exchanges rarely receive a deposit straight into a hot wallet. A user sends to a deposit address
// the exchange created for them, and the exchange later sweeps that address into a hot wallet. So a
// deposit is found from the sweep: a transfer into an exchange hub, traced one hop back to the
// wallet that funded the deposit address.
//
// Hubs come from two places, and each record says which. A short list of hot wallets whose labels
// are widely published, and hubs inferred from the chain itself: a plain wallet (not a contract,
// which rules out pools and routers) that receives the watched tokens from many distinct senders in
// one pass. Nothing here trusts a feed.

export const SUPPLY_TOKENS = {
  "0x514910771af9ca656af840dff83e8264ecf986ca": { symbol: "LINK", instrument: "LINKUSDT", coingecko: "chainlink", decimals: 18 },
  "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984": { symbol: "UNI", instrument: "UNIUSDT", coingecko: "uniswap", decimals: 18 },
  "0x6982508145454ce325ddbe47a25d4ec3d2311933": { symbol: "PEPE", instrument: "PEPEUSDT", coingecko: "pepe", decimals: 18 },
  "0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce": { symbol: "SHIB", instrument: "SHIBUSDT", coingecko: "shiba-inu", decimals: 18 },
}

// Publicly labelled exchange hot wallets. Labels are third party; WAKE records them as such.
export const LABELLED_HUBS = {
  "0x28c6c06298d514db089934071355e5743bf21d60": "Binance",
  "0x21a31ee1afc51d94c2efccaa2092ad1028285549": "Binance",
  "0xdfd5293d8e347dfe59e90efd55b2956a1343963d": "Binance",
  "0x71660c4005ba85c37ccec55d0c4493e66fe775d3": "Coinbase",
  "0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43": "Coinbase",
  "0x6cc5f688a315f3dc28a7781717a9a798a59fda7b": "OKX",
  "0xf89d7b9c864f589bbf53a82105107622b35eaa40": "Bybit",
  "0x2910543af39aba0cd09dbb2d50200b3e800a63d2": "Kraken",
}

export const MIN_DEPOSIT_USD = Number(process.env.WAKE_SUPPLY_MIN_USD || 500_000)
export const HUB_MIN_SENDERS = 8          // distinct senders into one wallet in a pass
export const FUNDING_MATCH = 0.9          // the funding hop carried at least 90% of the sweep
export const SUPPLY_EDGE_COST_MULTIPLE = 3 // modeled move must beat three times the round trip cost

/** Wallets that received the watched tokens from many distinct senders in this pass. */
export function hubCandidates(transfers, minSenders = HUB_MIN_SENDERS) {
  const senders = new Map()
  for (const t of transfers) {
    if (!senders.has(t.to)) senders.set(t.to, new Set())
    senders.get(t.to).add(t.from)
  }
  return [...senders].filter(([, s]) => s.size >= minSenders).map(([a]) => a)
}

/**
 * Deposits into exchange hubs, traced one hop back. `hubs` maps address to { exchange, source }.
 * Hub to hub movement is an exchange rebalancing itself and is ignored.
 * @param {Array<{ token: string, symbol: string, amount: number, usd: number, from: string, to: string, tx: string, block: number, logIndex?: number }>} transfers
 * @param {Record<string, { exchange: string, source: string }>} hubs
 */
export function findDeposits(transfers, hubs, minUsd = MIN_DEPOSIT_USD) {
  const byDest = new Map()
  for (const t of transfers) {
    const k = `${t.token}|${t.to}`
    if (!byDest.has(k)) byDest.set(k, [])
    byDest.get(k).push(t)
  }
  const deposits = new Map()
  for (const t of transfers) {
    const hub = hubs[t.to]
    if (!hub || hubs[t.from] || t.usd < minUsd) continue
    // Who funded the address that swept into the hub?
    const funding = (byDest.get(`${t.token}|${t.from}`) ?? [])
      .filter((f) => f.block <= t.block && f.amount >= FUNDING_MATCH * t.amount && !hubs[f.from])
      .sort((a, b) => b.amount - a.amount)[0]
    const depositor = funding ? funding.from : t.from
    const key = `${t.token}|${depositor}`
    const prev = deposits.get(key)
    const rec = prev ?? {
      token: t.token, symbol: t.symbol, depositor, depositAddress: funding ? t.from : null,
      exchange: hub.exchange, hubSource: hub.source, hub: t.to,
      amount: 0, usd: 0, txs: [], block: t.block, fundingTx: funding?.tx ?? null, fundingBlock: funding?.block ?? null,
    }
    rec.amount += t.amount
    rec.usd += t.usd
    rec.txs.push(t.tx)
    rec.block = Math.max(rec.block, t.block)
    deposits.set(key, rec)
  }
  return [...deposits.values()].sort((a, b) => b.usd - a.usd)
}

/**
 * Square root impact: the move a block of this size implies if it is sold into the market, as a
 * percentage. Standard market microstructure (the square root law), with a coefficient of one.
 * The daily volume is the token's traded value across all venues, not Bitget's alone, so the
 * modeled move is not inflated by a thin single venue.
 */
export function supplyImpactPct({ usd, dailyVolumeUsd, dailySigma, coefficient = 1 }) {
  if (!(usd > 0) || !(dailyVolumeUsd > 0) || !(dailySigma > 0)) return null
  return Number((coefficient * dailySigma * Math.sqrt(usd / dailyVolumeUsd) * 100).toFixed(3))
}

export const TAKER_FEE = 0.0006

/** Round trip cost from the live order book: two taker fees plus the quoted spread. */
export function roundTripCost({ bid, ask }) {
  if (!(bid > 0) || !(ask > bid)) return null
  return 2 * TAKER_FEE + (ask - bid) / ((ask + bid) / 2)
}

/** The edge a supply trade has to clear, fixed before seeing data: a multiple of its own cost. */
export function supplyMinEdgePct(costPct) {
  return Number((SUPPLY_EDGE_COST_MULTIPLE * costPct * 100).toFixed(3))
}
