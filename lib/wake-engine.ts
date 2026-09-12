export type IncidentState = "CONFIRMED" | "INVESTIGATING" | "RESOLVED"
export type IncidentKind = "CONTAGION" | "DIRECT" | "NO TRADE"
export type Decision = "TRADE" | "NO TRADE"
export type Accent = "cyan" | "amber" | "violet"

export type GraphNodeData = {
  id: string
  className: string
  tone: string
  icon: "incident" | "collateral" | "protocol" | "market" | "action" | "abstain"
  kicker: string
  label: string
  detail: string
}

export type EvidenceItem = {
  type: "ONCHAIN" | "EXPOSURE" | "MARKET"
  label: string
  text: string
  ref: string
  tone: string
  icon: "onchain" | "exposure" | "market"
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
  kind: IncidentKind
  chain: string
  risk: string
  move: string
  confidence: number
  accent: Accent
  modeledDelta: number
  marketDelta: number
  instrument: string
  side: "SHORT" | "LONG"
  maxLoss: string
  invalidation: string
  positionSize: string
  decisionReason: string
  graphNodes: GraphNodeData[]
  evidence: EvidenceItem[]
  log: LogEntry[]
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
}

export const incidents: Incident[] = [
  {
    id: "INC-0921",
    time: "14:32:18",
    title: "Oracle deviation",
    subtitle: "rsETH collateral on Aave v3",
    state: "CONFIRMED",
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
    time: "13:58:44",
    title: "Bridge mint anomaly",
    subtitle: "USDC supply delta on Arbitrum",
    state: "INVESTIGATING",
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
    time: "11:16:05",
    title: "Treasury transfer",
    subtitle: "Dormant multisig → exchange",
    state: "RESOLVED",
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

export function deriveDecision(incident: Incident): Decision {
  const residual = incident.modeledDelta - incident.marketDelta
  return residual >= 1.2 && incident.confidence >= 75 ? "TRADE" : "NO TRADE"
}

export function createPaperOrder(incident: Incident): PaperOrder | null {
  if (deriveDecision(incident) !== "TRADE") return null
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
    entry: "market snapshot",
    maxLoss: incident.maxLoss,
    invalidation: incident.invalidation,
    status: "OPEN",
    createdAt: timestamp,
    receipt: `paper://bitget/${incident.id.toLowerCase()}/${compactTime}`,
  }
}

export function exportEvidencePacket(incident: Incident, decision: Decision, paperOrders: PaperOrder[]) {
  return {
    schema: "wake.evidence.v0.3",
    generatedAt: new Date().toISOString(),
    incident: {
      id: incident.id,
      observedAt: `${incident.time} UTC`,
      title: incident.title,
      chain: incident.chain,
      state: incident.state,
      kind: incident.kind,
      modeledRisk: incident.risk,
      modeledDelta: `${incident.modeledDelta}%`,
      marketDelta: `${incident.marketDelta}%`,
    },
    graph: incident.graphNodes.map(({ id, label, detail, kicker }) => ({ id, label, detail, kicker })),
    evidence: incident.evidence,
    decision: {
      recommendation: decision,
      confidence: incident.confidence,
      reason: incident.decisionReason,
      residualGap: `${(incident.modeledDelta - incident.marketDelta).toFixed(1)}%`,
    },
    paperOrders: paperOrders.filter((order) => order.incidentId === incident.id),
  }
}
