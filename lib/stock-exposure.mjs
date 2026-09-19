// Stock spillover rules, PRD section 5.
//
// A listed company is exposed only when the incident hits that company's own economics: Circle
// through USDC itself (issuance, reserves, minting, redemption), Coinbase through its custody or
// Base core infrastructure. A protocol that merely holds USDC, or a dApp that happens to run on
// Base, gives no path to either stock, and nothing ever maps a DeFi exploit to MSTR or HOOD.
// Every match is recorded as INFERRED and still has to pass the same gate as any other trade.

const text = (hack) => [hack.name, hack.technique, hack.classification, hack.targetType].filter(Boolean).join(" ").toLowerCase()

export const STOCK_RULES = Object.freeze([
  {
    symbol: "CRCLUSDT",
    company: "Circle",
    test: (hack) => {
      const t = text(hack)
      const hitsUsdc = /\b(usdc|circle)\b/.test(t)
      const coreMechanism = /(mint|reserve|issu|redemption|redeem|cctp|depeg|blacklist)/.test(t)
      return hitsUsdc && coreMechanism
    },
    path: "incident impairs USDC issuance, reserves or redemption, which is Circle's revenue base",
  },
  {
    symbol: "COINUSDT",
    company: "Coinbase",
    test: (hack) => {
      const t = text(hack)
      if (/\bcoinbase\b/.test(t)) return true
      const onBase = (hack.chain ?? []).includes("Base")
      const baseCore = /\bbase\b/.test(String(hack.name).toLowerCase()) && /(sequencer|bridge|infrastructure|chain|l2)/.test(t)
      return onBase && baseCore
    },
    path: "incident hits Coinbase custody or Base core infrastructure, which Coinbase operates",
  },
])

/** Deterministic stock exposures for an exploit record. Empty is the normal answer. */
export function stockExposures(hack, listed = null) {
  return STOCK_RULES
    .filter((rule) => rule.test(hack) && (!listed || listed.has(rule.symbol)))
    .map((rule) => ({ symbol: rule.symbol, kind: "DIRECT", relation: `${rule.company}: ${rule.path}`, epistemic: "INFERRED", assetClass: "US_STOCK_PERP" }))
}
