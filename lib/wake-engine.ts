import realMoonwellCapture from "@/data/incidents/inc-real-moonwell-20260827.json"
import realAfxCapture from "@/data/incidents/inc-real-afx-20260722.json"
import realAfxResolutionCapture from "@/data/incidents/inc-real-afx-resolution-20260723.json"
import { computeConfidence, modelConsequence, type ConsequenceInputs } from "@/lib/consequence-model"

export type IncidentState = "CONFIRMED" | "INVESTIGATING" | "RESOLVED"
export type WorkflowState = "WATCHING" | "ANOMALY_DETECTED" | "INVESTIGATING" | "INCIDENT_CONFIRMED" | "EXPOSURE_MAPPING" | "MARKET_CHECK" | "CAUSAL_CHALLENGE" | "TRADE_READY" | "RISK_APPROVED" | "POSITION_OPEN" | "MONITORING" | "CLOSED" | "NO_TRADE"
export type IncidentKind = "CONTAGION" | "DIRECT" | "NO TRADE"
export type Decision = "TRADE_DIRECT" | "TRADE_CONTAGION" | "TRADE_RESOLUTION" | "HEDGE" | "MONITOR" | "NO_TRADE"
export type Accent = "cyan" | "amber" | "violet"
export type DataProvenance = "REPLAY_FIXTURE" | "REAL_CAPTURE"
export type EpistemicStatus = "OBSERVED" | "INFERRED"
export type GraphNodeType = "event" | "transaction" | "contract" | "protocol" | "token" | "collateral_asset" | "debt_asset" | "issuer" | "market" | "bitget_instrument" | "position" | "evidence_source" | "action"
export type GraphRelation = "caused_by" | "controls" | "collateralizes" | "owes" | "depends_on" | "tracks" | "impacts" | "trades_as" | "invalidates" | "resolved_by"

export type GraphNodeData = {
  id: string
  nodeType?: GraphNodeType
  className: string
  tone: string
  icon: "incident" | "collateral" | "protocol" | "market" | "action" | "abstain"
  kicker: string
  label: string
  detail: string
}

export type GraphEdgeData = {
  id: string
  from: string
  to: string
  relation: GraphRelation
  epistemic: EpistemicStatus
  confidence: number | null
  source: string
  timestamp: string
  direction: "forward" | "reverse"
  estimatedMagnitude: string
  evidenceRef: string
}

/**
 * A declared edge. Each incident states its own relationships rather than
 * inheriting a fixed five edge template, so a graph can have the shape the
 * evidence actually supports.
 */
export type GraphEdgeSpec = {
  from: string
  to: string
  relation: GraphRelation
  epistemic: EpistemicStatus
  evidenceRef: string
  estimatedMagnitude?: string
  /** Points subtracted from incident confidence for this specific link. */
  confidencePenalty?: number
  source?: string
}

export type EvidenceItem = {
  type: "ONCHAIN" | "EXPOSURE" | "MARKET"
  label: string
  text: string
  ref: string
  tone: string
  icon: "onchain" | "exposure" | "market"
  epistemic?: EpistemicStatus
}

export type RiskCheck = {
  key: string
  label: string
  passed: boolean
  value: string
  threshold: string
}

export type RiskGate = {
  passed: boolean
  checks: RiskCheck[]
}

export type FalsificationCheck = {
  key: string
  question: string
  status: "SUPPORTED" | "UNRESOLVED" | "FAILED"
  answer: string
  evidenceRef: string
  blocksTrade?: boolean
}

export type ConsequenceModel = {
  minimumPct: number
  basePct: number
  maximumPct: number
  formula: string
  assumptions: string[]
}

export type StateTransition = {
  from: WorkflowState | null
  to: WorkflowState
  at: string
  actor: string
  reason: string
}

export type WatchCoverage = {
  chain: string
  protocol: string
  eventTypes: string[]
  resolver: string
  status: "VALIDATED" | "PLANNED"
  evidenceRef: string
}

export type LogEntry = {
  time: string
  actor: string
  text: string
  tone: string
}

export type Incident = {
  id: string
  time: string
  title: string
  subtitle: string
  state: IncidentState
  workflowState: WorkflowState
  kind: IncidentKind
  chain: string
  risk: string
  move: string
  confidence: number | null
  accent: Accent
  modeledDelta: number | null
  marketDelta: number
  instrument: string
  side: "SHORT" | "LONG"
  maxLoss: string
  invalidation: string
  positionSize: string
  decisionReason: string
  catalystHorizon: string
  falsification: FalsificationCheck[]
  consequence: ConsequenceModel | null
  stateTransitions: StateTransition[]
  graphNodes: GraphNodeData[]
  /** Declared edges. Falls back to a derived chain when a fixture omits them. */
  graphEdges?: GraphEdgeSpec[]
  evidence: EvidenceItem[]
  log: LogEntry[]
  provenance?: DataProvenance
  /**
   * Where the modelled numbers came from. COMPUTED means the consequence and
   * confidence are functions of observed packet data. AUTHORED_SCENARIO means a
   * human wrote them for a replay case, which is legitimate for a fixture and
   * must never be presented as a measurement.
   */
  numbersProvenance?: "COMPUTED" | "AUTHORED_SCENARIO"
  /** Observed model inputs, present when the consequence was computed. */
  consequenceInputs?: ConsequenceInputs
  capture?: {
    schema: string
    capturedAt: string
    chainId: string
    txHash: string
    sources: { chain: string; market: string }
    integrity: string
    market: { symbol: string; startTime: number; endTime: number; candleCount: number; first: number; last: number }
  }
}

export type PaperOrder = {
  id: string
  incidentId: string
  exchange: "BITGET"
  mode: "PAPER"
  instrument: string
  side: "SHORT" | "LONG"
  size: string
  entry: string
  maxLoss: string
  invalidation: string
  status: "OPEN" | "CLOSED"
  createdAt: string
  receipt: string
  runId: string
  entryPrice: number | null
}

export type InvestigationRecord = {
  id: string
  incidentId: string
  completedAt: string
  decision: Decision
  workflowState: WorkflowState
  riskGate: RiskGate
}

export type MarketSnapshot = {
  symbol: string
  markPrice: number
  capturedAt: string
  source: "bitget-public-ticker"
}

export const coverageRegistry: WatchCoverage[] = [
  { chain: "BASE", protocol: "Moonwell", eventTypes: ["transaction receipt", "borrow event"], resolver: "real receipt capture", status: "VALIDATED", evidenceRef: "inc-real-moonwell-20260827" },
  { chain: "ETH", protocol: "protocol resolvers", eventTypes: ["oracle deviation", "collateral change", "token transfer"], resolver: "not captured in current packet", status: "PLANNED", evidenceRef: "none" },
  { chain: "ARB", protocol: "AFX Trade", eventTypes: ["bridge outflow", "USDC transfer"], resolver: "real receipt capture", status: "VALIDATED", evidenceRef: "inc-real-afx-20260722" },
  { chain: "ARB", protocol: "protocol resolvers", eventTypes: ["bridge supply change", "token transfer"], resolver: "not captured in current packet", status: "PLANNED", evidenceRef: "none" },
  { chain: "BITGET", protocol: "USDT futures", eventTypes: ["mark candles", "paper execution"], resolver: "public market adapter", status: "VALIDATED", evidenceRef: "bitget-public-mark-candles" },
]

const capturedMarketStart = realMoonwellCapture.market.candles[0]
const capturedMarketEnd = realMoonwellCapture.market.candles[realMoonwellCapture.market.candles.length - 1]
const capturedMarketMove = ((capturedMarketEnd.close - capturedMarketStart.open) / capturedMarketStart.open) * 100
const capturedBlock = Number.parseInt(realMoonwellCapture.receipt.blockNumber, 16)
const capturedTime = new Date(Number.parseInt(realMoonwellCapture.receipt.logs[0].blockTimestamp, 16) * 1000).toISOString().slice(11, 19)
const realAfxMarketStart = realAfxCapture.market.candles[0]
const realAfxMarketEnd = realAfxCapture.market.candles[realAfxCapture.market.candles.length - 1]
const realAfxMarketMove = ((realAfxMarketEnd.close - realAfxMarketStart.open) / realAfxMarketStart.open) * 100
const realAfxBlock = Number.parseInt(realAfxCapture.receipt.blockNumber, 16)
const realAfxTime = new Date(Number.parseInt(realAfxCapture.receipt.logs[0].blockTimestamp, 16) * 1000).toISOString().slice(11, 19)
const realAfxResolutionMarketStart = realAfxResolutionCapture.market.candles[0]
const realAfxResolutionMarketEnd = realAfxResolutionCapture.market.candles[realAfxResolutionCapture.market.candles.length - 1]
const realAfxResolutionMarketMove = ((realAfxResolutionMarketEnd.close - realAfxResolutionMarketStart.open) / realAfxResolutionMarketStart.open) * 100
const realAfxResolutionTime = new Date(realAfxResolutionCapture.incident.blockTimestamp * 1000).toISOString().slice(11, 19)
const realAfxOutflowUsdc = Number(BigInt(realAfxCapture.receipt.logs[0].data) / BigInt("1000000"))

// The consequence is computed from the packet, not authored. sigma and traded
// value are observed over the same window as the receipt; the conversion share
// is the one judgement call and it is swept rather than asserted.
const realAfxConsequence = modelConsequence({
  grossFlowUsd: realAfxOutflowUsdc,
  windowQuoteVolumeUsd: realAfxCapture.liquidity.observed.quoteVolumeUsd,
  windowSigma: realAfxCapture.liquidity.observed.windowSigma,
})
const realAfxConfidence = computeConfidence({
  evidenceEpistemics: ["OBSERVED", "INFERRED", "OBSERVED"],
  falsificationStatuses: ["FAILED", "UNRESOLVED", "UNRESOLVED", "SUPPORTED", "FAILED", "SUPPORTED"],
})

const realMoonwellFalsification: FalsificationCheck[] = [
  { key: "collateral", question: "Is ETH actually accepted as collateral in the captured loss path?", status: "UNRESOLVED", answer: "The receipt proves a MAMO borrow, not an ETH collateral relationship.", evidenceRef: realMoonwellCapture.incident.txHash },
  { key: "debt-cap", question: "Is the exposed debt cap material to ETHUSDT?", status: "UNRESOLVED", answer: "No ETH-specific debt cap is present in this capture.", evidenceRef: "forum.moonwell.fi/t/post-mortem-mamo-market-incident-on-base/2208" },
  { key: "absorbed", question: "Has the loss already been absorbed?", status: "UNRESOLVED", answer: "The packet does not establish loss absorption or an unsettled ETH claim.", evidenceRef: "wake.historical-capture.v1" },
  { key: "association", question: "Is the downstream relationship merely associative?", status: "FAILED", answer: "Yes. ETH is only a proxy in this packet, so the proposed trade path is rejected.", evidenceRef: "wake.historical-capture.v1" },
  { key: "repriced", question: "Has the market already repriced the proven consequence?", status: "UNRESOLVED", answer: "A one-hour ETHUSDT window is observed, but causality is not established.", evidenceRef: "bitget-public-mark-candles" },
  { key: "invalidation", question: "What evidence would invalidate the proposed action?", status: "SUPPORTED", answer: "Missing ETH-specific collateral or debt evidence invalidates the proxy thesis.", evidenceRef: realMoonwellCapture.incident.txHash },
]

const realMoonwellTransitions: StateTransition[] = [
  { from: "WATCHING", to: "INCIDENT_CONFIRMED", at: capturedTime, actor: "CAPTURE", reason: "Receipt status 0x1 and preserved logs confirmed the incident." },
  { from: "INCIDENT_CONFIRMED", to: "EXPOSURE_MAPPING", at: capturedTime, actor: "ACTIONGRAPH", reason: "Mapped the captured MAMO borrow and candidate ETH market proxy." },
  { from: "EXPOSURE_MAPPING", to: "CAUSAL_CHALLENGE", at: capturedTime, actor: "CAUSAL FALSIFIER", reason: "Tested collateral, debt-cap, absorption, and repricing claims." },
  { from: "CAUSAL_CHALLENGE", to: "NO_TRADE", at: capturedTime, actor: "RISK GATE", reason: "The ETH-specific residual edge remained unproven." },
]

const contagionFalsification: FalsificationCheck[] = [
  { key: "collateral", question: "Is the asset actually accepted as collateral?", status: "SUPPORTED", answer: "Yes. rsETH is mapped as Aave v3 Base collateral in the replay evidence.", evidenceRef: "aave-v3/base" },
  { key: "debt-cap", question: "Is the debt cap material?", status: "SUPPORTED", answer: "Yes. The replay case states a $12.5M USDC debt cap.", evidenceRef: "aave-v3/base" },
  { key: "absorbed", question: "Has the loss already been absorbed?", status: "UNRESOLVED", answer: "No final absorption observation is included in this replay snapshot.", evidenceRef: "0x7f3a…91c2" },
  { key: "association", question: "Is the downstream relationship only associative?", status: "SUPPORTED", answer: "The collateral-to-protocol path is treated as causal for this replay case.", evidenceRef: "aave-v3/base" },
  { key: "repriced", question: "Has the market already repriced the consequence?", status: "FAILED", answer: "The 0.9% move is below the 3.7% modeled consequence.", evidenceRef: "AAVEUSDT · Bitget" },
  { key: "invalidation", question: "What evidence would invalidate the trade?", status: "SUPPORTED", answer: "A corrected oracle or evidence of full repricing invalidates the short.", evidenceRef: "0x7f3a…91c2" },
]

const contagionTransitions: StateTransition[] = [
  { from: "WATCHING", to: "ANOMALY_DETECTED", at: "14:32:18", actor: "WATCHER", reason: "Base log and oracle deviation crossed the replay trigger." },
  { from: "ANOMALY_DETECTED", to: "INCIDENT_CONFIRMED", at: "14:33:27", actor: "ACTIONGRAPH", reason: "Aave collateral and debt-cap relationship was mapped." },
  { from: "INCIDENT_CONFIRMED", to: "TRADE_READY", at: "14:34:51", actor: "CAUSAL FALSIFIER", reason: "The exposure survived the replay challenge." },
  { from: "TRADE_READY", to: "RISK_APPROVED", at: "14:34:51", actor: "RISK GATE", reason: "Size capped at 18% of incident VaR." },
]

const bridgeFalsification: FalsificationCheck[] = [
  { key: "collateral", question: "Is the asset actually accepted as collateral?", status: "UNRESOLVED", answer: "No collateral venue is attached to the provisional bridge event.", evidenceRef: "arb-bridge/v2" },
  { key: "debt-cap", question: "Is the debt cap material?", status: "FAILED", answer: "No debt cap or downstream lending exposure is confirmed.", evidenceRef: "arb-bridge/v2" },
  { key: "absorbed", question: "Has the loss already been absorbed?", status: "UNRESOLVED", answer: "Attestation is still pending.", evidenceRef: "0x9b11…e40a" },
  { key: "association", question: "Is the downstream relationship only associative?", status: "SUPPORTED", answer: "The apparent USDC relationship is not yet causal.", evidenceRef: "arb-bridge/v2" },
  { key: "repriced", question: "Has the market already repriced the consequence?", status: "SUPPORTED", answer: "The observed 0.4% move is near the small modeled residual.", evidenceRef: "USDCUSDT · Bitget" },
  { key: "invalidation", question: "What evidence would invalidate the monitor state?", status: "SUPPORTED", answer: "A final attestation or confirmed venue exposure would reopen the case.", evidenceRef: "0x9b11…e40a" },
]

const bridgeTransitions: StateTransition[] = [
  { from: "WATCHING", to: "ANOMALY_DETECTED", at: "13:59:03", actor: "WATCHER", reason: "USDC supply delta was detected on Arbitrum." },
  { from: "ANOMALY_DETECTED", to: "INVESTIGATING", at: "14:02:10", actor: "ACTIONGRAPH", reason: "Bridge attestation edge remained provisional." },
  { from: "INVESTIGATING", to: "NO_TRADE", at: "14:05:22", actor: "RISK GATE", reason: "Exposure and residual edge stayed below the action threshold." },
]

const directFalsification: FalsificationCheck[] = [
  { key: "collateral", question: "Is the asset actually accepted as collateral?", status: "FAILED", answer: "This is an inventory transfer, not a collateral path.", evidenceRef: "cluster:treasury-17" },
  { key: "debt-cap", question: "Is the debt cap material?", status: "UNRESOLVED", answer: "No protocol debt cap is relevant to the transfer thesis.", evidenceRef: "cluster:treasury-17" },
  { key: "absorbed", question: "Has the loss already been absorbed?", status: "SUPPORTED", answer: "The receiving venue already absorbed the flow in the observed move.", evidenceRef: "ETHUSDT · Bitget" },
  { key: "association", question: "Is the downstream relationship only associative?", status: "SUPPORTED", answer: "The treasury-to-exchange attribution is direct in the replay snapshot.", evidenceRef: "0x2ac0…0dd1" },
  { key: "repriced", question: "Has the market already repriced the consequence?", status: "SUPPORTED", answer: "Yes. The 1.2% venue response leaves less than the action threshold.", evidenceRef: "ETHUSDT · Bitget" },
  { key: "invalidation", question: "What evidence would invalidate the trade?", status: "SUPPORTED", answer: "Evidence that the receiving wallet is not the attributed venue cluster invalidates the path.", evidenceRef: "cluster:treasury-17" },
]

const directTransitions: StateTransition[] = [
  { from: "WATCHING", to: "INCIDENT_CONFIRMED", at: "11:16:05", actor: "WATCHER", reason: "Dormant multisig transfer was detected." },
  { from: "INCIDENT_CONFIRMED", to: "MARKET_CHECK", at: "11:20:44", actor: "RISK GATE", reason: "Liquidity and repricing checks were applied." },
  { from: "MARKET_CHECK", to: "CLOSED", at: "12:02:14", actor: "MONITOR", reason: "Venue response completed and the thesis expired." },
]

const realMoonwellIncident: Incident = {
  id: realMoonwellCapture.incident.id,
  provenance: "REAL_CAPTURE",
  numbersProvenance: "COMPUTED",
  time: capturedTime,
  title: "Moonwell MAMO borrow",
  subtitle: "final USDC borrow · Base",
  state: "RESOLVED",
  workflowState: "NO_TRADE",
  kind: "NO TRADE",
  chain: "BASE",
  risk: "UNMODELED",
  move: `${capturedMarketMove >= 0 ? "+" : ""}${capturedMarketMove.toFixed(2)}%`,
  confidence: null,
  accent: "amber",
  modeledDelta: null,
  marketDelta: Number(capturedMarketMove.toFixed(2)),
  instrument: realMoonwellCapture.market.symbol,
  side: "SHORT",
  maxLoss: "$0",
  invalidation: "n/a",
  positionSize: "0% · abstain",
  decisionReason: "The receipt confirms an incident, but this capture does not prove a residual ETH edge; WAKE abstains instead of proxy-trading a weak link.",
  catalystHorizon: "No actionable horizon until an ETH-specific exposure is verified",
  falsification: realMoonwellFalsification,
  consequence: null,
  stateTransitions: realMoonwellTransitions,
  graphNodes: [
    { id: "real-event", className: "node-incident", tone: "orange", icon: "incident", kicker: `OBSERVED · BLOCK ${capturedBlock}`, label: "MAMO borrow", detail: `tx ${realMoonwellCapture.incident.txHash.slice(0, 10)}…` },
    { id: "real-collateral", className: "node-collateral", tone: "cyan", icon: "collateral", kicker: "MARKET · MOONWELL", label: "MAMO collateral", detail: "capture link inferred" },
    { id: "real-protocol", className: "node-protocol", tone: "lime", icon: "protocol", kicker: "CHAIN · BASE", label: "Moonwell", detail: "receipt status 0x1" },
    { id: "real-market", className: "node-market", tone: "violet", icon: "market", kicker: "BITGET · MARK", label: "ETHUSDT", detail: `${capturedMarketMove.toFixed(2)}% window move` },
    { id: "real-action", className: "node-route-a", tone: "violet", icon: "abstain", kicker: "ACTION · ABSTAIN", label: "NO TRADE", detail: "edge unproven" },
    { id: "real-monitor", className: "node-route-b", tone: "orange", icon: "action", kicker: "ALTERNATE", label: "MONITOR", detail: "await linked evidence" },
  ],
  graphEdges: [
    { from: "real-protocol", to: "real-collateral", relation: "controls", epistemic: "OBSERVED", evidenceRef: realMoonwellCapture.incident.txHash, estimatedMagnitude: "market listing" },
    { from: "real-event", to: "real-collateral", relation: "impacts", epistemic: "OBSERVED", evidenceRef: realMoonwellCapture.incident.txHash, estimatedMagnitude: "receipt status 0x1" },
    // This is the link the capture does not prove, and it is why WAKE abstains.
    { from: "real-collateral", to: "real-market", relation: "depends_on", epistemic: "INFERRED", confidencePenalty: 20, evidenceRef: "forum.moonwell.fi/t/post-mortem-mamo-market-incident-on-base/2208", estimatedMagnitude: "unproven ETH link", source: "Bitget" },
    { from: "real-market", to: "real-action", relation: "trades_as", epistemic: "INFERRED", confidencePenalty: 20, evidenceRef: `${realMoonwellCapture.sources.market} · ${realMoonwellCapture.capturedAt}`, estimatedMagnitude: "0% · abstain", source: "Bitget" },
    { from: "real-market", to: "real-monitor", relation: "invalidates", epistemic: "INFERRED", confidencePenalty: 10, evidenceRef: `${realMoonwellCapture.sources.market} · ${realMoonwellCapture.capturedAt}`, estimatedMagnitude: "await linked evidence", source: "Bitget" },
  ],
  evidence: [
    { type: "ONCHAIN", label: "Receipt captured", text: `Base RPC returned status 0x1 at block ${capturedBlock}; ${realMoonwellCapture.receipt.logs.length} logs are preserved.`, ref: realMoonwellCapture.incident.txHash, tone: "cyan", icon: "onchain", epistemic: "OBSERVED" },
    { type: "EXPOSURE", label: "Causal link remains bounded", text: "The receipt alone does not establish that ETHUSDT should absorb the Moonwell incident; the proposed proxy relationship is marked inferred.", ref: "forum.moonwell.fi/t/post-mortem-mamo-market-incident-on-base/2208", tone: "lime", icon: "exposure", epistemic: "INFERRED" },
    { type: "MARKET", label: "Bitget window preserved", text: `ETHUSDT mark candles moved from ${capturedMarketStart.open.toFixed(2)} to ${capturedMarketEnd.close.toFixed(2)} over 60 captured minutes.`, ref: `${realMoonwellCapture.sources.market} · ${realMoonwellCapture.capturedAt}`, tone: "orange", icon: "market", epistemic: "OBSERVED" },
  ],
  log: [
    { time: capturedTime, actor: "CAPTURE", text: `Base transaction receipt verified at block ${capturedBlock}.`, tone: "cyan" },
    { time: "09:30:13", actor: "CAUSAL CHALLENGE", text: "No validated ETH-specific consequence was established from the captured receipt.", tone: "violet" },
    { time: "09:30:13", actor: "RISK GATE", text: "Abstain: modeled residual and causal confidence are unavailable for this proxy.", tone: "lime" },
  ],
  capture: {
    schema: realMoonwellCapture.schema,
    capturedAt: realMoonwellCapture.capturedAt,
    chainId: realMoonwellCapture.incident.chainId,
    txHash: realMoonwellCapture.incident.txHash,
    sources: realMoonwellCapture.sources,
    integrity: realMoonwellCapture.integrity,
    market: {
      symbol: realMoonwellCapture.market.symbol,
      startTime: realMoonwellCapture.market.startTime,
      endTime: realMoonwellCapture.market.endTime,
      candleCount: realMoonwellCapture.market.candles.length,
      first: capturedMarketStart.open,
      last: capturedMarketEnd.close,
    },
  },
}

const realAfxFalsification: FalsificationCheck[] = [
  { key: "collateral", question: "Is the asset actually accepted as collateral?", status: "FAILED", answer: "No collateral relationship is needed for this path; the observed bridge outflow is a direct inventory loss and the ETH leg is downstream flow pressure.", evidenceRef: `https://arbiscan.io/tx/${realAfxCapture.incident.txHash}`, blocksTrade: false },
  { key: "debt-cap", question: "Is the debt cap material?", status: "UNRESOLVED", answer: "The AFX bridge drain is material, but no lending debt cap is part of the captured path.", evidenceRef: "https://www.coindesk.com/tech/2026/07/23/arbitrum-based-afx-trade-drained-of-usd24-million-after-bridge-keys-compromised", blocksTrade: false },
  { key: "absorbed", question: "Has the loss already been absorbed?", status: "UNRESOLVED", answer: "The receipt confirms the bridge outflow; downstream exchange absorption is not asserted by this packet.", evidenceRef: `https://arbiscan.io/tx/${realAfxCapture.incident.txHash}`, blocksTrade: false },
  { key: "association", question: "Is the downstream relationship only associative?", status: "SUPPORTED", answer: "The captured bridge outflow and the reported conversion path make ETHUSDT the downstream market instrument; the relationship is still labeled inferred at the market edge.", evidenceRef: "https://layerzero.network/blog/kelpdao-incident-statement", blocksTrade: false },
  { key: "repriced", question: "Has the market already repriced the proven consequence?", status: "SUPPORTED", answer: `The captured ETHUSDT window moved ${realAfxMarketMove.toFixed(2)}%, which already exceeds the ${realAfxConsequence?.basePct ?? 0}% base case and sits inside the ${realAfxConsequence?.maximumPct ?? 0}% full conversion ceiling. On this evidence the move is priced.`, evidenceRef: `${realAfxCapture.sources.market} · ${realAfxCapture.capturedAt}`, blocksTrade: false },
  { key: "invalidation", question: "What evidence would invalidate the proposed action?", status: "SUPPORTED", answer: "A proven freeze before the conversion leg, or evidence that the ETH flow did not originate from the AFX outflow, invalidates the contagion action.", evidenceRef: "https://arbiscan.io/address/0x627654b2782bfc57580ecd11d40869b350b6ebac", blocksTrade: false },
]

const realAfxTransitions: StateTransition[] = [
  { from: "WATCHING", to: "INCIDENT_CONFIRMED", at: realAfxTime, actor: "CAPTURE", reason: `Arbitrum receipt ${realAfxCapture.receipt.status} preserved at block ${realAfxBlock}.` },
  { from: "INCIDENT_CONFIRMED", to: "EXPOSURE_MAPPING", at: realAfxTime, actor: "ACTIONGRAPH", reason: `Decoded ${realAfxOutflowUsdc.toLocaleString()} USDC leaving the AFX bridge contract.` },
  { from: "EXPOSURE_MAPPING", to: "MARKET_CHECK", at: realAfxTime, actor: "CONSEQUENCE MODEL", reason: `Square root impact on $${(realAfxCapture.liquidity.observed.quoteVolumeUsd / 1e6).toFixed(2)}M of observed traded value gives a base case of ${realAfxConsequence?.basePct ?? 0}% and a full conversion ceiling of ${realAfxConsequence?.maximumPct ?? 0}%.` },
  { from: "MARKET_CHECK", to: "CAUSAL_CHALLENGE", at: realAfxTime, actor: "CAUSAL FALSIFIER", reason: "Tested direct outflow, downstream ETH flow, absorption, repricing, and invalidation evidence." },
  { from: "CAUSAL_CHALLENGE", to: "NO_TRADE", at: realAfxTime, actor: "RISK GATE", reason: `Held. Modelled impact does not exceed the ${realAfxMarketMove.toFixed(2)}% the market had already moved, and computed confidence of ${realAfxConfidence?.value ?? 0} is below the 75 threshold.` },
]

const realAfxIncident: Incident = {
  id: realAfxCapture.incident.id,
  provenance: "REAL_CAPTURE",
  numbersProvenance: "COMPUTED",
  time: realAfxTime,
  title: "AFX bridge outflow",
  subtitle: "24.15M USDC · Arbitrum",
  state: "CONFIRMED",
  workflowState: "NO_TRADE",
  kind: "CONTAGION",
  chain: "ARB",
  risk: "$24.15M USDC",
  move: `${realAfxMarketMove >= 0 ? "+" : ""}${realAfxMarketMove.toFixed(2)}%`,
  confidence: realAfxConfidence?.value ?? null,
  consequenceInputs: {
    grossFlowUsd: realAfxOutflowUsdc,
    windowQuoteVolumeUsd: realAfxCapture.liquidity.observed.quoteVolumeUsd,
    windowSigma: realAfxCapture.liquidity.observed.windowSigma,
  },
  accent: "amber",
  modeledDelta: realAfxConsequence?.basePct ?? null,
  marketDelta: Number(realAfxMarketMove.toFixed(2)),
  instrument: realAfxCapture.market.symbol,
  side: "SHORT",
  maxLoss: "$1,200",
  invalidation: "Freeze before ETH conversion · source path disproven",
  positionSize: "10% of incident VaR",
  decisionReason: "The receipt proves a material bridge outflow and the contagion path is traced. The consequence model then refuses the trade: even if the entire outflow converted and hit this instrument inside the window, square root impact on the observed traded value is smaller than the move the market had already made. WAKE abstains rather than size a position on a gap that is not there.",
  catalystHorizon: "minutes to 2h after bridge outflow",
  falsification: realAfxFalsification,
  consequence: realAfxConsequence,
  stateTransitions: realAfxTransitions,
  graphNodes: [
    { id: "afx-event", nodeType: "event", className: "node-incident", tone: "orange", icon: "incident", kicker: `OBSERVED · BLOCK ${realAfxBlock}`, label: "AFX bridge drain", detail: `${realAfxOutflowUsdc.toLocaleString()} USDC` },
    { id: "afx-exposure", nodeType: "token", className: "node-collateral", tone: "cyan", icon: "collateral", kicker: "OUTFLOW · ERC-20", label: "USDC inventory", detail: "bridge balance reduced" },
    { id: "afx-protocol", nodeType: "protocol", className: "node-protocol", tone: "lime", icon: "protocol", kicker: "CHAIN · ARBITRUM", label: "AFX Trade", detail: "bridge receipt 0x1" },
    { id: "afx-market", nodeType: "bitget_instrument", className: "node-market", tone: "violet", icon: "market", kicker: "BITGET · MARK", label: "ETHUSDT", detail: `${realAfxMarketMove.toFixed(2)}% window move` },
    { id: "afx-action", nodeType: "action", className: "node-route-a", tone: "violet", icon: "action", kicker: "ACTION · CONTAGION", label: "ETH short", detail: "bounded · paper" },
    { id: "afx-alternate", nodeType: "action", className: "node-route-b", tone: "orange", icon: "abstain", kicker: "ALTERNATE", label: "MONITOR", detail: "if freeze confirmed" },
  ],
  graphEdges: [
    { from: "afx-protocol", to: "afx-exposure", relation: "controls", epistemic: "OBSERVED", evidenceRef: `https://arbiscan.io/tx/${realAfxCapture.incident.txHash}`, estimatedMagnitude: "bridge held the inventory" },
    { from: "afx-event", to: "afx-exposure", relation: "impacts", epistemic: "OBSERVED", evidenceRef: `https://arbiscan.io/tx/${realAfxCapture.incident.txHash}`, estimatedMagnitude: `${realAfxOutflowUsdc.toLocaleString()} USDC` },
    // Reported conversion path, not a traced one. The penalty is the honest cost
    // of an edge the receipt does not carry.
    { from: "afx-exposure", to: "afx-market", relation: "depends_on", epistemic: "INFERRED", confidencePenalty: 15, evidenceRef: "https://www.coindesk.com/tech/2026/07/23/arbitrum-based-afx-trade-drained-of-usd24-million-after-bridge-keys-compromised", estimatedMagnitude: `${realAfxConsequence?.basePct ?? 0}% modelled`, source: "Bitget" },
    { from: "afx-market", to: "afx-action", relation: "trades_as", epistemic: "INFERRED", confidencePenalty: 15, evidenceRef: `${realAfxCapture.sources.market} · ${realAfxCapture.capturedAt}`, estimatedMagnitude: "held · residual below threshold", source: "Bitget" },
    { from: "afx-market", to: "afx-alternate", relation: "invalidates", epistemic: "INFERRED", confidencePenalty: 8, evidenceRef: `${realAfxCapture.sources.market} · ${realAfxCapture.capturedAt}`, estimatedMagnitude: "if freeze confirmed", source: "Bitget" },
  ],
  evidence: [
    { type: "ONCHAIN", label: "Bridge receipt captured", text: `Arbitrum RPC returned status 0x1 at block ${realAfxBlock}; the preserved ERC-20 log decodes to ${realAfxOutflowUsdc.toLocaleString()} USDC.`, ref: `https://arbiscan.io/tx/${realAfxCapture.incident.txHash}`, tone: "cyan", icon: "onchain", epistemic: "OBSERVED" },
    { type: "EXPOSURE", label: "Downstream flow mapped", text: "The incident evidence maps the bridge outflow to a reported ETH conversion path; the market edge remains inferred until the full downstream trace is captured.", ref: "https://www.coindesk.com/tech/2026/07/23/arbitrum-based-afx-trade-drained-of-usd24-million-after-bridge-keys-compromised", tone: "lime", icon: "exposure", epistemic: "INFERRED" },
    { type: "MARKET", label: "Bitget window preserved", text: `ETHUSDT mark candles moved from ${realAfxMarketStart.open.toFixed(2)} to ${realAfxMarketEnd.close.toFixed(2)} over ${realAfxCapture.market.candles.length} captured minutes.`, ref: `${realAfxCapture.sources.market} · ${realAfxCapture.capturedAt}`, tone: "orange", icon: "market", epistemic: "OBSERVED" },
  ],
  log: [
    { time: realAfxTime, actor: "CAPTURE", text: `Arbitrum receipt verified at block ${realAfxBlock}; ${realAfxOutflowUsdc.toLocaleString()} USDC outflow decoded.`, tone: "cyan" },
    { time: realAfxTime, actor: "ACTIONGRAPH", text: "Bridge inventory → downstream ETH market edge mapped as observed then inferred.", tone: "violet" },
    { time: realAfxTime, actor: "CONSEQUENCE MODEL", text: `Impact computed from observed traded value and realised volatility: ${realAfxConsequence?.minimumPct ?? 0}% to ${realAfxConsequence?.maximumPct ?? 0}%, base ${realAfxConsequence?.basePct ?? 0}%.`, tone: "cyan" },
    { time: realAfxTime, actor: "RISK GATE", text: "Held. The traced contagion path is real; the size of it is not. No paper order was written.", tone: "orange" },
  ],
  capture: {
    schema: realAfxCapture.schema,
    capturedAt: realAfxCapture.capturedAt,
    chainId: realAfxCapture.incident.chainId,
    txHash: realAfxCapture.incident.txHash,
    sources: realAfxCapture.sources,
    integrity: realAfxCapture.integrity,
    market: {
      symbol: realAfxCapture.market.symbol,
      startTime: realAfxCapture.market.startTime,
      endTime: realAfxCapture.market.endTime,
      candleCount: realAfxCapture.market.candles.length,
      first: realAfxMarketStart.open,
      last: realAfxMarketEnd.close,
    },
  },
}

const realAfxResolutionFalsification: FalsificationCheck[] = [
  { key: "collateral", question: "Is the asset actually accepted as collateral?", status: "FAILED", answer: "This is a response message, not a collateral path.", evidenceRef: `https://arbiscan.io/tx/${realAfxResolutionCapture.incident.txHash}`, blocksTrade: false },
  { key: "debt-cap", question: "Is the debt cap material?", status: "FAILED", answer: "No debt cap is claimed in the resolution packet.", evidenceRef: "AFX bridge response", blocksTrade: false },
  { key: "absorbed", question: "Has the loss already been absorbed?", status: "UNRESOLVED", answer: "The message requests a white-hat return and does not prove funds were recovered.", evidenceRef: `https://arbiscan.io/tx/${realAfxResolutionCapture.incident.txHash}`, blocksTrade: true },
  { key: "association", question: "Is the downstream relationship only associative?", status: "SUPPORTED", answer: "The response transaction is directly addressed to the identified AFX exploiter wallet.", evidenceRef: `https://arbiscan.io/tx/${realAfxResolutionCapture.incident.txHash}`, blocksTrade: false },
  { key: "repriced", question: "Has the market already repriced the proven consequence?", status: "SUPPORTED", answer: `The post-response ETHUSDT window moved ${realAfxResolutionMarketMove.toFixed(2)}%; no recovery premium is assumed.`, evidenceRef: `${realAfxResolutionCapture.sources.market} · ${realAfxResolutionCapture.capturedAt}`, blocksTrade: false },
  { key: "invalidation", question: "What evidence would invalidate the proposed resolution action?", status: "SUPPORTED", answer: "A failed recovery request or continued attacker outflow keeps the incident in monitor state.", evidenceRef: `https://arbiscan.io/tx/${realAfxResolutionCapture.incident.txHash}`, blocksTrade: false },
]

const realAfxResolutionIncident: Incident = {
  id: realAfxResolutionCapture.incident.id,
  provenance: "REAL_CAPTURE",
  numbersProvenance: "COMPUTED",
  time: realAfxResolutionTime,
  title: "AFX recovery response",
  subtitle: "white-hat settlement request · Arbitrum",
  state: "RESOLVED",
  workflowState: "MONITORING",
  kind: "DIRECT",
  chain: "ARB",
  risk: "$24.15M incident",
  move: `${realAfxResolutionMarketMove >= 0 ? "+" : ""}${realAfxResolutionMarketMove.toFixed(2)}%`,
  confidence: null,
  accent: "cyan",
  modeledDelta: null,
  marketDelta: Number(realAfxResolutionMarketMove.toFixed(2)),
  instrument: realAfxResolutionCapture.market.symbol,
  side: "LONG",
  maxLoss: "$600",
  invalidation: "Recovery request fails · attacker continues outflow",
  positionSize: "5% of incident VaR",
  decisionReason: "A real on-chain response message marks the beginning of resolution, but a recovery request moves no money, so there is no flow to model. WAKE holds the incident in monitor rather than invent a resolution premium.",
  catalystHorizon: "response window · follow-up required",
  falsification: realAfxResolutionFalsification,
  // A recovery request moves no money. There is no flow to put through the
  // impact model, so the packet declines to produce a number at all.
  consequence: null,
  stateTransitions: [
    { from: "WATCHING", to: "INCIDENT_CONFIRMED", at: realAfxResolutionTime, actor: "CAPTURE", reason: `Arbitrum response transaction preserved at block ${Number.parseInt(realAfxResolutionCapture.receipt.blockNumber, 16)}.` },
    { from: "INCIDENT_CONFIRMED", to: "CAUSAL_CHALLENGE", at: realAfxResolutionTime, actor: "CAUSAL FALSIFIER", reason: "Tested whether a recovery request proves absorption or only signals intent." },
    { from: "CAUSAL_CHALLENGE", to: "MONITORING", at: realAfxResolutionTime, actor: "MONITOR", reason: "Resolution is conditional; follow-up recovery evidence is required." },
  ],
  graphNodes: [
    { id: "afx-resolution-event", nodeType: "event", className: "node-incident", tone: "cyan", icon: "incident", kicker: "OBSERVED · RESPONSE", label: "Recovery request", detail: "70% white-hat offer" },
    { id: "afx-resolution-exposure", nodeType: "evidence_source", className: "node-collateral", tone: "cyan", icon: "collateral", kicker: "TARGET · EXPLOITER", label: "Attacker wallet", detail: "message addressed directly" },
    { id: "afx-resolution-protocol", nodeType: "protocol", className: "node-protocol", tone: "lime", icon: "protocol", kicker: "CHAIN · ARBITRUM", label: "AFX Trade", detail: "response receipt 0x1" },
    { id: "afx-resolution-market", nodeType: "bitget_instrument", className: "node-market", tone: "violet", icon: "market", kicker: "BITGET · MARK", label: "ETHUSDT", detail: `${realAfxResolutionMarketMove.toFixed(2)}% response window` },
    { id: "afx-resolution-action", nodeType: "action", className: "node-route-a", tone: "violet", icon: "action", kicker: "ACTION · RESOLUTION", label: "ETH long", detail: "conditional · paper" },
    { id: "afx-resolution-alternate", nodeType: "action", className: "node-route-b", tone: "orange", icon: "abstain", kicker: "INVALIDATES", label: "MONITOR", detail: "until recovery proven" },
  ],
  graphEdges: [
    { from: "afx-resolution-protocol", to: "afx-resolution-event", relation: "controls", epistemic: "OBSERVED", evidenceRef: `https://arbiscan.io/tx/${realAfxResolutionCapture.incident.txHash}`, estimatedMagnitude: "AFX authored the response" },
    { from: "afx-resolution-event", to: "afx-resolution-exposure", relation: "impacts", epistemic: "OBSERVED", evidenceRef: `https://arbiscan.io/tx/${realAfxResolutionCapture.incident.txHash}`, estimatedMagnitude: "addressed to exploiter wallet" },
    { from: "afx-resolution-exposure", to: "afx-resolution-market", relation: "depends_on", epistemic: "INFERRED", confidencePenalty: 20, evidenceRef: `${realAfxResolutionCapture.sources.market} · ${realAfxResolutionCapture.capturedAt}`, estimatedMagnitude: "no flow to model", source: "Bitget" },
    { from: "afx-resolution-market", to: "afx-resolution-action", relation: "resolved_by", epistemic: "INFERRED", confidencePenalty: 25, evidenceRef: `${realAfxResolutionCapture.sources.market} · ${realAfxResolutionCapture.capturedAt}`, estimatedMagnitude: "conditional on recovery proof", source: "Bitget" },
    { from: "afx-resolution-market", to: "afx-resolution-alternate", relation: "invalidates", epistemic: "INFERRED", confidencePenalty: 10, evidenceRef: `https://arbiscan.io/tx/${realAfxResolutionCapture.incident.txHash}`, estimatedMagnitude: "until recovery proven", source: "Bitget" },
  ],
  evidence: [
    { type: "ONCHAIN", label: "Response transaction captured", text: "The real Arbitrum transaction carries a public recovery message addressed to the identified AFX exploiter wallet.", ref: `https://arbiscan.io/tx/${realAfxResolutionCapture.incident.txHash}`, tone: "cyan", icon: "onchain", epistemic: "OBSERVED" },
    { type: "EXPOSURE", label: "Resolution remains conditional", text: "The response is a resolution signal, not proof that funds were returned; WAKE keeps the monitor branch live.", ref: `https://arbiscan.io/tx/${realAfxResolutionCapture.incident.txHash}`, tone: "lime", icon: "exposure", epistemic: "INFERRED" },
    { type: "MARKET", label: "Post-response window preserved", text: `ETHUSDT mark candles moved from ${realAfxResolutionMarketStart.open.toFixed(2)} to ${realAfxResolutionMarketEnd.close.toFixed(2)} over ${realAfxResolutionCapture.market.candles.length} captured minutes.`, ref: `${realAfxResolutionCapture.sources.market} · ${realAfxResolutionCapture.capturedAt}`, tone: "orange", icon: "market", epistemic: "OBSERVED" },
  ],
  log: [
    { time: realAfxResolutionTime, actor: "CAPTURE", text: "Arbitrum response transaction verified; message preserved as primary evidence.", tone: "cyan" },
    { time: realAfxResolutionTime, actor: "CAUSAL CHALLENGE", text: "Recovery intent does not equal recovered funds; invalidation remains active.", tone: "violet" },
    { time: realAfxResolutionTime, actor: "MONITOR", text: "Resolution path opened conditionally; follow-up capture required before treating it as closed.", tone: "lime" },
  ],
  capture: {
    schema: realAfxResolutionCapture.schema,
    capturedAt: realAfxResolutionCapture.capturedAt,
    chainId: realAfxResolutionCapture.incident.chainId,
    txHash: realAfxResolutionCapture.incident.txHash,
    sources: realAfxResolutionCapture.sources,
    integrity: realAfxResolutionCapture.integrity,
    market: {
      symbol: realAfxResolutionCapture.market.symbol,
      startTime: realAfxResolutionCapture.market.startTime,
      endTime: realAfxResolutionCapture.market.endTime,
      candleCount: realAfxResolutionCapture.market.candles.length,
      first: realAfxResolutionMarketStart.open,
      last: realAfxResolutionMarketEnd.close,
    },
  },
}

export const incidents: Incident[] = [
  realMoonwellIncident,
  realAfxIncident,
  realAfxResolutionIncident,
  {
    id: "INC-0921",
    provenance: "REPLAY_FIXTURE",
    numbersProvenance: "AUTHORED_SCENARIO",
    time: "14:32:18",
    title: "Oracle deviation",
    subtitle: "rsETH collateral on Aave v3",
    state: "CONFIRMED",
    workflowState: "TRADE_READY",
    kind: "CONTAGION",
    chain: "BASE",
    risk: "$8.4M",
    move: "3.7%",
    confidence: 86,
    accent: "cyan",
    modeledDelta: 3.7,
    marketDelta: 0.9,
    instrument: "AAVEUSDT",
    side: "SHORT",
    maxLoss: "$420",
    invalidation: "+2.0%",
    positionSize: "18% of incident VaR",
    decisionReason: "Exposure remains underpriced after cost and liquidity checks.",
    catalystHorizon: "15–60 minutes after confirmed oracle deviation",
    falsification: contagionFalsification,
    consequence: { minimumPct: 1.4, basePct: 3.7, maximumPct: 6.2, formula: "debt cap × liquidation shortfall ÷ market capitalization", assumptions: ["rsETH remains accepted collateral", "oracle deviation is not corrected before liquidations", "AAVEUSDT remains the liquid proxy"] },
    stateTransitions: contagionTransitions,
    graphNodes: [
      { id: "oracle", className: "node-incident", tone: "orange", icon: "incident", kicker: "OBSERVED · 14:32:18", label: "Oracle deviation", detail: "4.8σ from median" },
      { id: "collateral", className: "node-collateral", tone: "cyan", icon: "collateral", kicker: "ASSET · rsETH", label: "Collateral", detail: "$12.5M debt cap" },
      { id: "protocol", className: "node-protocol", tone: "lime", icon: "protocol", kicker: "PROTOCOL · BASE", label: "AAVE v3 Base", detail: "$8.4M modeled loss" },
      { id: "market", className: "node-market", tone: "violet", icon: "market", kicker: "BITGET · PERP", label: "AAVEUSDT", detail: "+0.9% priced in" },
      { id: "action", className: "node-route-a", tone: "orange", icon: "action", kicker: "ACTION · DIRECT", label: "AAVE short", detail: "0.18R · paper" },
      { id: "abstain", className: "node-route-b", tone: "violet", icon: "abstain", kicker: "ALTERNATE", label: "NO TRADE", detail: "if already repriced" },
    ],
    evidence: [
      { type: "ONCHAIN", label: "State change confirmed", text: "Oracle answer moved 4.8σ from the 30d median.", ref: "0x7f3a…91c2", tone: "cyan", icon: "onchain" },
      { type: "EXPOSURE", label: "Material downstream link", text: "Aave v3 Base accepts rsETH as collateral; debt cap is 12.5M USDC.", ref: "aave-v3/base", tone: "lime", icon: "exposure" },
      { type: "MARKET", label: "Price not fully adjusted", text: "AAVE perp moved 0.9% while modeled protocol loss is 3.7%.", ref: "AAVEUSDT · Bitget", tone: "orange", icon: "market" },
    ],
    log: [
      { time: "14:36:08", actor: "MONITOR", text: "AAVEUSDT moved +0.3%; thesis remains live.", tone: "cyan" },
      { time: "14:34:51", actor: "RISK GATE", text: "Size capped at 18% of incident VaR; max loss $420.", tone: "lime" },
      { time: "14:33:27", actor: "ACTIONGRAPH", text: "Added Aave v3 → AAVE governance token edge.", tone: "violet" },
      { time: "14:32:18", actor: "WATCHER", text: "Incident created from Base log + oracle deviation.", tone: "orange" },
    ],
  },
  {
    id: "INC-0918",
    provenance: "REPLAY_FIXTURE",
    numbersProvenance: "AUTHORED_SCENARIO",
    time: "13:58:44",
    title: "Bridge mint anomaly",
    subtitle: "USDC supply delta on Arbitrum",
    state: "INVESTIGATING",
    workflowState: "INVESTIGATING",
    kind: "NO TRADE",
    chain: "ARB",
    risk: "$2.1M",
    move: "0.4%",
    confidence: 61,
    accent: "amber",
    modeledDelta: 0.8,
    marketDelta: 0.4,
    instrument: "USDCUSDT",
    side: "SHORT",
    maxLoss: "$0",
    invalidation: "n/a",
    positionSize: "0% · abstain",
    decisionReason: "The apparent link is not material enough to justify a position.",
    catalystHorizon: "Monitor until bridge attestation is final",
    falsification: bridgeFalsification,
    consequence: { minimumPct: 0.2, basePct: 0.8, maximumPct: 1.3, formula: "observed supply delta × estimated venue absorption", assumptions: ["bridge attestation remains provisional", "no downstream venue exposure is confirmed"] },
    stateTransitions: bridgeTransitions,
    graphNodes: [
      { id: "bridge", className: "node-incident", tone: "orange", icon: "incident", kicker: "OBSERVED · 13:58:44", label: "Bridge mint", detail: "supply delta +0.3σ" },
      { id: "supply", className: "node-collateral", tone: "cyan", icon: "collateral", kicker: "ASSET · USDC", label: "Supply delta", detail: "$2.1M observed" },
      { id: "arb", className: "node-protocol", tone: "lime", icon: "protocol", kicker: "BRIDGE · ARB", label: "Arbitrum bridge", detail: "attestation pending" },
      { id: "usdc", className: "node-market", tone: "violet", icon: "market", kicker: "BITGET · PERP", label: "USDCUSDT", detail: "0.4% priced in" },
      { id: "no-trade", className: "node-route-a", tone: "violet", icon: "abstain", kicker: "ACTION · ABSTAIN", label: "NO TRADE", detail: "edge below threshold" },
      { id: "monitor", className: "node-route-b", tone: "orange", icon: "action", kicker: "ALTERNATE", label: "MONITOR", detail: "await attestation" },
    ],
    evidence: [
      { type: "ONCHAIN", label: "Anomaly observed", text: "Bridge mint delta is visible, but the attestation event is not final.", ref: "0x9b11…e40a", tone: "cyan", icon: "onchain" },
      { type: "EXPOSURE", label: "Link remains provisional", text: "No confirmed downstream venue or lending exposure is attached yet.", ref: "arb-bridge/v2", tone: "lime", icon: "exposure" },
      { type: "MARKET", label: "Market already close to fair", text: "USDC perp moved 0.4%; modeled residual is below the action threshold.", ref: "USDCUSDT · Bitget", tone: "orange", icon: "market" },
    ],
    log: [
      { time: "14:05:22", actor: "RISK GATE", text: "Abstain threshold held; no order created.", tone: "lime" },
      { time: "14:02:10", actor: "ACTIONGRAPH", text: "Bridge attestation edge marked provisional.", tone: "violet" },
      { time: "13:59:03", actor: "WATCHER", text: "USDC supply delta detected on Arbitrum.", tone: "orange" },
    ],
  },
  {
    id: "INC-0907",
    provenance: "REPLAY_FIXTURE",
    numbersProvenance: "AUTHORED_SCENARIO",
    time: "11:16:05",
    title: "Treasury transfer",
    subtitle: "Dormant multisig → exchange",
    state: "RESOLVED",
    workflowState: "CLOSED",
    kind: "DIRECT",
    chain: "ETH",
    risk: "$540K",
    move: "1.2%",
    confidence: 92,
    accent: "violet",
    modeledDelta: 1.9,
    marketDelta: 1.2,
    instrument: "ETHUSDT",
    side: "SHORT",
    maxLoss: "$180",
    invalidation: "+1.5%",
    positionSize: "8% of incident VaR",
    decisionReason: "The transfer is attributable, but the receiving venue already repriced the flow.",
    catalystHorizon: "Expired after venue repricing",
    falsification: directFalsification,
    consequence: { minimumPct: 0.6, basePct: 1.9, maximumPct: 3.1, formula: "inventory value × expected sell-through impact", assumptions: ["wallet cluster attribution is correct", "exchange flow is economically relevant"] },
    stateTransitions: directTransitions,
    graphNodes: [
      { id: "treasury", className: "node-incident", tone: "orange", icon: "incident", kicker: "OBSERVED · 11:16:05", label: "Treasury transfer", detail: "dormant for 211d" },
      { id: "wallet", className: "node-collateral", tone: "cyan", icon: "collateral", kicker: "ENTITY · MULTISIG", label: "Dormant wallet", detail: "$540K balance" },
      { id: "exchange", className: "node-protocol", tone: "lime", icon: "protocol", kicker: "VENUE · ETH", label: "Exchange inflow", detail: "receipt confirmed" },
      { id: "eth", className: "node-market", tone: "violet", icon: "market", kicker: "BITGET · PERP", label: "ETHUSDT", detail: "+1.2% priced in" },
      { id: "short", className: "node-route-a", tone: "orange", icon: "action", kicker: "ACTION · DIRECT", label: "ETH short", detail: "0.08R · paper" },
      { id: "hold", className: "node-route-b", tone: "violet", icon: "abstain", kicker: "ALTERNATE", label: "HOLD", detail: "venue already moved" },
    ],
    evidence: [
      { type: "ONCHAIN", label: "Transfer attributable", text: "Dormant multisig sent 211-day-old inventory to a labeled exchange wallet.", ref: "0x2ac0…0dd1", tone: "cyan", icon: "onchain" },
      { type: "EXPOSURE", label: "Direct inventory path", text: "The receiving venue is mapped to the same treasury cluster with 92% confidence.", ref: "cluster:treasury-17", tone: "lime", icon: "exposure" },
      { type: "MARKET", label: "Flow already reflected", text: "ETH perp moved 1.2%; remaining modeled edge is below the live action threshold.", ref: "ETHUSDT · Bitget", tone: "orange", icon: "market" },
    ],
    log: [
      { time: "12:02:14", actor: "MONITOR", text: "Venue response completed; incident marked resolved.", tone: "cyan" },
      { time: "11:20:44", actor: "RISK GATE", text: "Paper size reduced after liquidity check.", tone: "lime" },
      { time: "11:17:31", actor: "ACTIONGRAPH", text: "Treasury cluster → exchange inflow edge confirmed.", tone: "violet" },
      { time: "11:16:05", actor: "WATCHER", text: "Dormant multisig transfer created incident.", tone: "orange" },
    ],
  },
]

export const GATE_THRESHOLDS = {
  minConfidence: 75,
  minResidualPct: 1.2,
} as const

export function deriveDecision(incident: Incident): Decision {
  // An unresolved question that is flagged as blocking is not the same as a
  // dead thesis. It is an open investigation, so it reads as MONITOR.
  const hasOpenBlocker = incident.falsification.some((check) => check.blocksTrade === true && check.status === "UNRESOLVED")
  if (incident.modeledDelta === null || incident.confidence === null) {
    return hasOpenBlocker || incident.state === "INVESTIGATING" ? "MONITOR" : "NO_TRADE"
  }
  const residual = incident.modeledDelta - incident.marketDelta
  if (residual >= GATE_THRESHOLDS.minResidualPct && incident.confidence >= GATE_THRESHOLDS.minConfidence) {
    if (incident.kind === "CONTAGION") return "TRADE_CONTAGION"
    if (incident.state === "RESOLVED") return "TRADE_RESOLUTION"
    return "TRADE_DIRECT"
  }
  return incident.state === "INVESTIGATING" ? "MONITOR" : "NO_TRADE"
}

export function isTradeDecision(decision: Decision) {
  return decision === "TRADE_DIRECT" || decision === "TRADE_CONTAGION" || decision === "TRADE_RESOLUTION" || decision === "HEDGE"
}

export function getGraphNodeType(node: GraphNodeData): GraphNodeType {
  if (node.nodeType) return node.nodeType
  if (node.icon === "incident") return "event"
  if (node.icon === "collateral") return "collateral_asset"
  if (node.icon === "protocol") return "protocol"
  if (node.icon === "market") return "bitget_instrument"
  return "action"
}

export function deriveGraphEdges(incident: Incident): GraphEdgeData[] {
  const nodeIds = new Set(incident.graphNodes.map((node) => node.id))
  const withConfidence = (penalty = 0) =>
    incident.confidence === null ? null : Math.max(0, incident.confidence - penalty)

  if (incident.graphEdges?.length) {
    return incident.graphEdges
      // An edge pointing at a node that does not exist is a data error, not
      // something to render. Drop it rather than draw a dangling line.
      .filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))
      .map((edge) => ({
        id: `${edge.from}-${edge.to}`,
        from: edge.from,
        to: edge.to,
        relation: edge.relation,
        epistemic: edge.epistemic,
        confidence: withConfidence(edge.confidencePenalty ?? 0),
        source: edge.source ?? incident.chain,
        timestamp: incident.time,
        direction: "forward",
        estimatedMagnitude: edge.estimatedMagnitude ?? incident.risk,
        evidenceRef: edge.evidenceRef,
      }))
  }

  // Fallback for fixtures that do not declare edges: chain whatever nodes are
  // present. This no longer assumes six nodes and three evidence items.
  const nodes = incident.graphNodes
  const evidenceRef = (index: number) =>
    incident.evidence[Math.min(index, Math.max(incident.evidence.length - 1, 0))]?.ref ?? "no evidence reference"
  const relations: GraphRelation[] = ["impacts", "collateralizes", "tracks", "trades_as", "invalidates"]

  const edges: GraphEdgeData[] = []
  for (let i = 0; i < nodes.length - 1; i += 1) {
    edges.push({
      id: `${nodes[i].id}-${nodes[i + 1].id}`,
      from: nodes[i].id,
      to: nodes[i + 1].id,
      relation: relations[Math.min(i, relations.length - 1)],
      epistemic: i === 0 ? "OBSERVED" : "INFERRED",
      confidence: withConfidence(i * 4),
      source: i >= 2 ? "Bitget" : incident.chain,
      timestamp: incident.time,
      direction: "forward",
      estimatedMagnitude: incident.risk,
      evidenceRef: evidenceRef(i),
    })
  }
  return edges
}

export function evaluateRiskGate(incident: Incident): RiskGate {
  const residual = incident.modeledDelta === null ? null : incident.modeledDelta - incident.marketDelta
  const blockingFalsifiers = incident.falsification.filter((check) => check.blocksTrade === true)
  const checks: RiskCheck[] = [
    { key: "confidence", label: "Causal confidence", passed: incident.confidence !== null && incident.confidence >= GATE_THRESHOLDS.minConfidence, value: incident.confidence === null ? "n/a" : `${incident.confidence}%`, threshold: "≥ 75%" },
    { key: "residual", label: "Residual edge", passed: residual !== null && residual >= GATE_THRESHOLDS.minResidualPct, value: residual === null ? "n/a" : `${residual.toFixed(1)}%`, threshold: "≥ 1.2%" },
    { key: "loss-bound", label: "Maximum loss bound", passed: incident.maxLoss !== "$0", value: incident.maxLoss, threshold: "defined" },
    { key: "evidence", label: "Evidence packet", passed: incident.evidence.length >= 3, value: `${incident.evidence.length} sources`, threshold: "≥ 3 sources" },
    { key: "causal", label: "Causal challenge", passed: blockingFalsifiers.length === 0, value: blockingFalsifiers.length === 0 ? "no blocking checks" : `${blockingFalsifiers.length} blocking check${blockingFalsifiers.length === 1 ? "" : "s"}`, threshold: "0 blocking checks" },
  ]
  return { passed: checks.every((check) => check.passed), checks }
}

export function createPaperOrder(incident: Incident, runId = `run_${incident.id.toLowerCase()}`, entryPrice: number | null = null): PaperOrder | null {
  if (!isTradeDecision(deriveDecision(incident)) || !evaluateRiskGate(incident).passed) return null
  const timestamp = new Date().toISOString()
  const compactTime = timestamp.replace(/[-:TZ.]/g, "").slice(0, 14)
  return {
    id: `wake-paper-${incident.id.toLowerCase()}-${compactTime}`,
    incidentId: incident.id,
    exchange: "BITGET",
    mode: "PAPER",
    instrument: incident.instrument,
    side: incident.side,
    size: incident.positionSize,
    entry: entryPrice === null ? "market snapshot" : entryPrice.toFixed(4),
    maxLoss: incident.maxLoss,
    invalidation: incident.invalidation,
    status: "OPEN",
    createdAt: timestamp,
    receipt: `paper://bitget/${incident.id.toLowerCase()}/${compactTime}?run=${runId}`,
    runId,
    entryPrice,
  }
}

export function exportEvidencePacket(incident: Incident, decision: Decision, paperOrders: PaperOrder[], investigationRuns: InvestigationRecord[] = [], marketSnapshot: MarketSnapshot | null = null, positionObservations: unknown[] = []) {
  return {
    schema: "wake.evidence.v0.4",
    provenance: incident.provenance ?? "REPLAY_FIXTURE",
    numbersProvenance: incident.numbersProvenance ?? "AUTHORED_SCENARIO",
    capture: incident.capture ?? null,
    marketSnapshot,
    generatedAt: new Date().toISOString(),
    incident: {
      id: incident.id,
      observedAt: `${incident.time} UTC`,
      title: incident.title,
      chain: incident.chain,
      state: incident.state,
      kind: incident.kind,
      workflowState: incident.workflowState,
      modeledRisk: incident.risk,
      modeledDelta: incident.modeledDelta === null ? null : `${incident.modeledDelta}%`,
      marketDelta: `${incident.marketDelta}%`,
      catalystHorizon: incident.catalystHorizon,
      consequence: incident.consequence,
      falsification: incident.falsification,
      stateTransitions: incident.stateTransitions,
    },
    graph: {
      nodes: incident.graphNodes.map((node) => ({ id: node.id, label: node.label, detail: node.detail, kicker: node.kicker, nodeType: getGraphNodeType(node) })),
      edges: deriveGraphEdges(incident),
    },
    evidence: incident.evidence.map((item) => ({
      ...item,
      epistemic: item.epistemic ?? (item.type === "EXPOSURE" ? "INFERRED" : "OBSERVED"),
    })),
    decision: {
      recommendation: decision,
      confidence: incident.confidence,
      reason: incident.decisionReason,
      residualGap: incident.modeledDelta === null ? null : `${(incident.modeledDelta - incident.marketDelta).toFixed(1)}%`,
      riskGate: evaluateRiskGate(incident),
    },
    paperOrders: paperOrders.filter((order) => order.incidentId === incident.id),
    investigationRuns: investigationRuns.filter((run) => run.incidentId === incident.id),
    positionObservations,
  }
}
