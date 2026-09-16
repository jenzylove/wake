"use client"
/* eslint-disable @next/next/no-img-element -- the hero uses a responsive art-directed asset rather than a content image */

import * as React from "react"
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  Ban,
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  Code2,
  Crosshair,
  Database,
  Download,
  ExternalLink,
  FileCheck2,
  GitBranch,
  Globe2,
  History,
  Layers3,
  LineChart,
  LockKeyhole,
  Menu,
  Network,
  Pause,
  Play,
  RefreshCw,
  ScanSearch,
  ShieldCheck,
  Siren,
  SlidersHorizontal,
  Sparkles,
  TerminalSquare,
  TimerReset,
  TrendingDown,
  X,
  Zap,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  createPaperOrder,
  deriveGraphEdges,
  deriveDecision,
  evaluateRiskGate,
  exportEvidencePacket,
  getGraphNodeType,
  isTradeDecision,
  coverageRegistry,
  incidents,
  type Decision,
  type EvidenceItem,
  type GraphNodeData,
  type PaperOrder,
  type InvestigationRecord,
} from "@/lib/wake-engine"

type InvestigationRun = InvestigationRecord
type MarketSnapshot = { symbol: string; markPrice: number; capturedAt: string; source: "bitget-public-ticker" }
type PositionObservation = { observationId: string; positionId: string; incidentId: string; symbol: string; side: "LONG" | "SHORT"; entryPrice: number | null; markPrice: number; capturedAt: string; source: "bitget-public-ticker" }
type PositionObservationReceipt = { observation: PositionObservation; persisted: boolean; storage?: { mode?: string } }
type InvestigatorReview = {
  source: string
  model: string
  generatedAt: string
  result: {
    interpretation: string
    causalHypothesis: string
    actionBias: Decision
    confidence: number
    falsification: Array<{ key: string; verdict: "SUPPORTS" | "WEAKENS" | "UNKNOWN"; explanation: string; evidenceRefs: string[] }>
    evidenceToSeek: string[]
    limitations: string[]
  }
}

function StatusDot({ tone = "cyan" }: { tone?: string }) {
  return <span className={`status-dot status-${tone}`} aria-hidden="true" />
}

function ToneIcon({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`icon-tile icon-${tone}`}>{children}</span>
}

function Metric({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: string }) {
  return (
    <div className="metric-cell">
      <div className="metric-label">{label}</div>
      <div className={`metric-value value-${tone}`}>{value}</div>
      <div className="metric-sub">{sub}</div>
    </div>
  )
}

export default function Home() {
  const [selectedId, setSelectedId] = React.useState(incidents[0].id)
  const [isRunning, setIsRunning] = React.useState(false)
  const [isOpen, setIsOpen] = React.useState(false)
  const [decision, setDecision] = React.useState<Decision>(deriveDecision(incidents[0]))
  const [selectedNode, setSelectedNode] = React.useState(incidents[0].graphNodes[2].id)
  const [paperOrders, setPaperOrders] = React.useState<PaperOrder[]>(() => {
    if (typeof window === "undefined") return []
    const saved = window.localStorage.getItem("wake.paper-orders")
    if (!saved) return []
    try {
      const parsed = JSON.parse(saved) as Array<Partial<PaperOrder>>
      if (!Array.isArray(parsed)) return []
      return parsed
        .filter((item) => item && typeof item.id === "string" && typeof item.incidentId === "string")
        .map((item) => ({ ...item, runId: item.runId ?? "legacy-paper-run" })) as PaperOrder[]
    } catch {
      window.localStorage.removeItem("wake.paper-orders")
      return []
    }
  })
  const [copiedReceipt, setCopiedReceipt] = React.useState(false)
  const [mobileNav, setMobileNav] = React.useState(false)
  const [lastRun, setLastRun] = React.useState<InvestigationRun | null>(null)
  const [runHistory, setRunHistory] = React.useState<InvestigationRun[]>(() => {
    if (typeof window === "undefined") return []
    const saved = window.localStorage.getItem("wake.investigation-runs")
    if (!saved) return []
    try {
      const parsed = JSON.parse(saved) as InvestigationRun[]
      return Array.isArray(parsed) ? parsed.filter((run) => run && typeof run.id === "string" && typeof run.incidentId === "string") : []
    } catch {
      window.localStorage.removeItem("wake.investigation-runs")
      return []
    }
  })
  const [marketSnapshot, setMarketSnapshot] = React.useState<MarketSnapshot | null>(null)
  const [actionNotice, setActionNotice] = React.useState<string | null>(null)
  const [aiReview, setAiReview] = React.useState<InvestigatorReview | null>(null)
  const [aiBusy, setAiBusy] = React.useState(false)
  const [observationReceipt, setObservationReceipt] = React.useState<PositionObservationReceipt | null>(null)
  const [observationHistory, setObservationHistory] = React.useState<PositionObservation[]>([])

  const incident = incidents.find((item) => item.id === selectedId) ?? incidents[0]
  const riskGate = evaluateRiskGate(incident)
  const graphEdges = deriveGraphEdges(incident)
  const activeOrder = paperOrders.find((order) => order.incidentId === incident.id && order.status === "OPEN")
  const isTrade = isTradeDecision(decision)
  const unrealizedPnl = activeOrder?.entryPrice && marketSnapshot && activeOrder.entryPrice > 0
    ? `${(((marketSnapshot.markPrice - activeOrder.entryPrice) / activeOrder.entryPrice) * (activeOrder.side === "SHORT" ? -100 : 100)).toFixed(2)}%`
    : "n/a · entry mark unavailable"
  const selectedGraphNode = incident.graphNodes.find((node) => node.id === selectedNode) ?? incident.graphNodes[2]
  const selectedEdge = graphEdges.find((edge) => edge.from === selectedGraphNode.id || edge.to === selectedGraphNode.id)
  const isRealCapture = incident.provenance === "REAL_CAPTURE"
  const provenanceLabel = isRealCapture ? "REAL CAPTURE" : "REPLAY FIXTURE · NOT LIVE"
  const mispricing = incident.modeledDelta === null ? "n/a" : `${(incident.modeledDelta - incident.marketDelta).toFixed(1)}%`
  const marketSummary = incident.modeledDelta === null ? `market ${incident.marketDelta.toFixed(2)}% · model not estimated` : `model ${incident.modeledDelta.toFixed(1)}% · market ${incident.marketDelta.toFixed(1)}%`
  const activePositionCount = paperOrders.filter((order) => order.status === "OPEN").length

  React.useEffect(() => {
    window.localStorage.setItem("wake.paper-orders", JSON.stringify(paperOrders))
  }, [paperOrders])

  React.useEffect(() => {
    window.localStorage.setItem("wake.investigation-runs", JSON.stringify(runHistory))
  }, [runHistory])

  React.useEffect(() => {
    let mounted = true
    const loadObservations = async () => {
      try {
        const response = await fetch(`/api/position/observations?incidentId=${encodeURIComponent(incident.id)}`)
        if (!response.ok) return
        const payload = await response.json() as { observations?: PositionObservation[] }
        if (!mounted) return
        const observations = Array.isArray(payload.observations) ? payload.observations : []
        setObservationHistory(observations)
        const latest = observations.at(-1)
        setObservationReceipt(latest ? { observation: latest, persisted: true } : null)
      } catch {
        if (mounted) setObservationHistory([])
      }
    }
    void loadObservations()
    return () => { mounted = false }
  }, [incident.id])

  React.useEffect(() => {
    let mounted = true
    const readSnapshot = async () => {
      try {
        const response = await fetch(`/api/market/ticker?symbol=${encodeURIComponent(incident.instrument)}`)
        if (!response.ok) return
        const snapshot = await response.json() as MarketSnapshot
        if (mounted && snapshot.symbol && Number.isFinite(snapshot.markPrice)) {
          setMarketSnapshot(snapshot)
          if (activeOrder) {
            const observation: PositionObservation = {
              observationId: `obs_${Date.now()}`,
              positionId: activeOrder.id,
              incidentId: incident.id,
              symbol: activeOrder.instrument,
              side: activeOrder.side,
              entryPrice: activeOrder.entryPrice,
              markPrice: snapshot.markPrice,
              capturedAt: snapshot.capturedAt,
              source: snapshot.source,
            }
            const receipt = { observation, persisted: false }
            setObservationReceipt(receipt)
            setObservationHistory((current) => [...current.filter((item) => item.observationId !== observation.observationId), observation].slice(-250))
          }
        }
      } catch {
        if (mounted) setMarketSnapshot(null)
      }
    }
    void readSnapshot()
    const interval = window.setInterval(readSnapshot, 15000)
    return () => {
      mounted = false
      window.clearInterval(interval)
    }
  }, [activeOrder, incident.id, incident.instrument])

  function runInvestigation() {
    const runIncident = incident
    setIsRunning(true)
    setActionNotice("Replaying the evidence snapshot and rerunning the risk gate…")
    window.setTimeout(() => {
      const completedAt = new Date().toISOString()
      const runId = `run_${runIncident.id.slice(4).toLowerCase()}_${completedAt.replace(/[-:TZ.]/g, "").slice(0, 14)}`
      const nextRiskGate = evaluateRiskGate(runIncident)
      const nextDecision = deriveDecision(runIncident)
      const nextRun: InvestigationRun = { id: runId, incidentId: runIncident.id, completedAt, decision: nextDecision, workflowState: runIncident.workflowState, riskGate: nextRiskGate }
      setLastRun(nextRun)
      setRunHistory((current) => [nextRun, ...current.filter((run) => run.id !== runId)].slice(0, 20))
      setDecision(nextDecision)
      setIsRunning(false)
      setActionNotice(`${runId} recorded · ${nextRiskGate.passed ? "risk gate passed" : "NO TRADE gate held"}`)
    }, 1600)
  }

  function enterWorkspace() {
    document.getElementById("wake-workspace")?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  function selectIncident(id: string) {
    const nextIncident = incidents.find((item) => item.id === id) ?? incidents[0]
    const nextOrder = paperOrders.find((order) => order.incidentId === id && order.status === "OPEN")
    setSelectedId(id)
    setDecision(deriveDecision(nextIncident))
    setIsOpen(Boolean(nextOrder))
    setSelectedNode(nextIncident.graphNodes[2].id)
    setCopiedReceipt(false)
    setMarketSnapshot(null)
    setLastRun(runHistory.find((run) => run.incidentId === id) ?? null)
    setActionNotice(null)
    setAiReview(null)
    setObservationReceipt(null)
  }

  function openPaperPosition() {
    if (!lastRun || lastRun.incidentId !== incident.id) {
      setActionNotice("Run the investigation first. No paper order was created.")
      return
    }
    if (!lastRun.riskGate.passed) {
      setActionNotice("Risk gate held. WAKE recorded NO TRADE; no paper order was created.")
      setDecision(deriveDecision(incident))
      return
    }
    const existing = paperOrders.find((order) => order.incidentId === incident.id && order.status === "OPEN")
    if (existing) {
      setIsOpen(true)
      setDecision(deriveDecision(incident))
      return
    }

    const runOrder = createPaperOrder(incident, lastRun.id, marketSnapshot?.markPrice ?? null)
    if (!runOrder) {
      setDecision(deriveDecision(incident))
      setIsOpen(false)
      setActionNotice("NO TRADE recorded; the deterministic gate did not approve execution.")
      return
    }
    setPaperOrders((current) => [...current.filter((item) => item.incidentId !== incident.id), runOrder])
    setDecision(deriveDecision(incident))
    setIsOpen(true)
    setActionNotice(`${runOrder.id} created in local paper mode · no Bitget request sent`)
  }

  function closePaperPosition() {
    setPaperOrders((current) => current.map((order) => (
      order.incidentId === incident.id && order.status === "OPEN"
        ? { ...order, status: "CLOSED" }
        : order
    )))
    setIsOpen(false)
    setActionNotice("Position closed in the local paper ledger.")
  }

  async function runAiReview() {
    setAiBusy(true)
    setActionNotice("Sending the evidence packet to the server-side investigator…")
    try {
      const response = await fetch("/api/investigator", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ incidentId: incident.id }) })
      const payload = await response.json() as InvestigatorReview | { error?: string }
      if (!response.ok || !("result" in payload)) throw new Error("error" in payload ? payload.error || "Investigator unavailable" : "Investigator unavailable")
      setAiReview(payload)
      setActionNotice(`${payload.model} review recorded · deterministic risk gate remains authoritative`)
    } catch (error) {
      setActionNotice(error instanceof Error ? error.message : "Investigator unavailable")
    } finally {
      setAiBusy(false)
    }
  }

  function rejectThesis() {
    closePaperPosition()
    setDecision("NO_TRADE")
    setActionNotice("Thesis rejected; no external order was sent.")
  }

  function exportPacket() {
    const packet = exportEvidencePacket(incident, decision, paperOrders, runHistory, marketSnapshot, observationHistory.filter((item) => item.incidentId === incident.id))
    const blob = new Blob([JSON.stringify(packet, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `${incident.id.toLowerCase()}-wake-evidence.json`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  async function copyOrderReceipt(order: PaperOrder) {
    await navigator.clipboard?.writeText(order.receipt)
    setCopiedReceipt(true)
    window.setTimeout(() => setCopiedReceipt(false), 1600)
  }

  return (
    <main className="app-shell">
      <header className="topbar hero-topbar">
        <div className="topbar-left">
          <button className="mobile-menu" onClick={() => setMobileNav((value) => !value)} aria-label="Toggle navigation">
            <Menu size={18} />
          </button>
          <div className="brand-mark"><span>↯</span></div>
          <div>
            <div className="brand-name">WAKE</div>
            <div className="brand-kicker">EVIDENCE BEFORE EXECUTION</div>
          </div>
        </div>
        <nav className="hero-nav" aria-label="Landing page navigation">
          <button type="button" onClick={enterWorkspace}>WHY WAKE</button>
          <button type="button" onClick={enterWorkspace}>EVIDENCE</button>
          <button type="button" onClick={enterWorkspace}>WORKSPACE</button>
        </nav>
        <div className="topbar-right">
          <button type="button" className="hero-nav-cta" onClick={enterWorkspace}>OPEN CONSOLE <ArrowRight size={13} /></button>
        </div>
      </header>

      <section className="wake-hero" aria-labelledby="wake-hero-title">
        <div className="hero-scene" aria-hidden="true">
          <img className="hero-scene-image" src="/wake-hero.png" alt="" />
          <div className="hero-scene-vignette" />
          <div className="hero-scene-glow" />
        </div>
        <div className="hero-copy">
          <div className="hero-eyebrow"><span className="eyebrow-line" /> WAKE IS A MISSION</div>
          <h1 id="wake-hero-title">When the chain moves,<br /><em>find what the market missed.</em></h1>
          <p className="hero-description">On-chain incident response for market action you can explain, bound, and verify.</p>
          <div className="hero-actions">
            <Button size="sm" className="accent-button hero-primary" onClick={enterWorkspace}><ScanSearch size={14} /> ENTER RESPONSE ROOM <ArrowRight size={14} /></Button>
            <button type="button" className="hero-secondary" onClick={enterWorkspace}>Explore WAKE <ArrowRight size={14} /></button>
          </div>
        </div>
        <div className="hero-index" aria-hidden="true"><strong>01</strong><span>/ 04</span></div>
        <div className="hero-side-note"><span>WAKE / 01</span><p>On-chain state <i>→</i> causal exposure <i>→</i> bounded action</p></div>
        <div className="hero-scroll-cue" aria-hidden="true"><span>SCROLL TO INVESTIGATE</span><ChevronDown size={14} /></div>
      </section>

      <div className="app-body" id="wake-workspace">
        <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
          <div className="sidebar-nav">
            <div className="nav-label">WORKSPACE</div>
            <button className="nav-item active"><ScanSearch size={15} /> Incident queue <span className="nav-count">{String(incidents.length).padStart(2, "0")}</span></button>
            <button className="nav-item"><Network size={15} /> ActionGraph <span className="nav-count muted">GRAPH</span></button>
            <button className="nav-item"><Crosshair size={15} /> Positions <span className="nav-count muted">{String(activePositionCount).padStart(2, "0")}</span></button>
            <button className="nav-item"><History size={15} /> Decision log</button>
            <div className="nav-label nav-label-spaced">EVIDENCE</div>
            <button className="nav-item"><FileCheck2 size={15} /> Evidence packets</button>
            <button className="nav-item"><TimerReset size={15} /> Replay lab</button>
            <button className="nav-item"><SlidersHorizontal size={15} /> Risk policy</button>
          </div>
          <div className="sidebar-footer">
            <div className="coverage-card">
              <div className="coverage-head"><span>VALIDATED COVERAGE</span><span className="coverage-percent">{coverageRegistry.filter((item) => item.status === "VALIDATED").length}/{coverageRegistry.length}</span></div>
              <div className="coverage-track"><span style={{ width: `${(coverageRegistry.filter((item) => item.status === "VALIDATED").length / coverageRegistry.length) * 100}%` }} /></div>
              <div className="coverage-copy">Base / Moonwell receipt · Bitget marks<br />Ethereum + Arbitrum resolvers planned</div>
            </div>
            <div className="agent-id">
              <div className="agent-avatar"><BrainCircuit size={15} /></div>
              <div><div className="agent-name">agent.wake</div><div className="agent-sub">deterministic policy · paper default</div></div>
              <LockKeyhole size={14} className="verified-icon" />
            </div>
          </div>
        </aside>

        <section className="main-canvas">
          <div className="page-heading">
            <div>
              <div className="eyebrow"><span className="eyebrow-line" /> INCIDENT QUEUE · EVIDENCE REGISTRY</div>
              <h1>Find the consequence,<br /><em>not just the headline.</em></h1>
            </div>
            <div className="heading-actions">
              <Button variant="outline" size="sm" className="quiet-button" onClick={runInvestigation}>
                <RefreshCw size={14} className={isRunning ? "spin" : ""} /> {isRunning ? "RE-ANALYZING" : "REFRESH GRAPH"}
              </Button>
              <Button size="sm" className="accent-button" onClick={isOpen ? closePaperPosition : openPaperPosition}>
                {isOpen ? <X size={14} /> : <Play size={14} />} {isOpen ? "CLOSE POSITION" : "RUN PAPER ACTION"}
              </Button>
            </div>
          </div>

          <div className="workspace-disclosure" role="status">
            <span><StatusDot tone={isRealCapture ? "cyan" : "amber"} /> {provenanceLabel}</span>
            <span>{actionNotice ?? (lastRun?.incidentId === incident.id ? `Last run ${lastRun.id} · ${lastRun.riskGate.passed ? "risk gate passed" : "risk gate held"}` : "Refresh graph to create a timestamped investigation run")}</span>
          </div>

          <div className="workspace-grid">
            <Card className="incident-queue card-dark">
              <CardHeader className="card-head compact-head">
                <div><CardTitle className="card-title">Event queue</CardTitle><div className="card-subtitle">CAPTURED + REPLAYABLE INCIDENTS</div></div>
                <Badge variant="outline" className="queue-badge"><StatusDot tone="cyan" /> {incidents.filter((item) => item.provenance === "REAL_CAPTURE").length} REAL · {incidents.filter((item) => item.provenance !== "REAL_CAPTURE").length} REPLAY</Badge>
              </CardHeader>
              <CardContent className="queue-content">
                {incidents.map((item) => (
                  <button key={item.id} className={`incident-row ${item.id === selectedId ? "selected" : ""}`} onClick={() => selectIncident(item.id)}>
                    <div className="incident-row-top"><span className="incident-time">{item.time} UTC</span><span className={`state-label state-${item.state.toLowerCase()}`}>{item.state}</span></div>
                    <div className="incident-title">{item.title}</div>
                    <div className="incident-subtitle">{item.subtitle}</div>
                    <div className="incident-row-bottom"><span className={`chain-pill chain-${item.accent}`}>{item.chain}</span><span>{item.kind}</span><span>{paperOrders.some((order) => order.incidentId === item.id && order.status === "OPEN") ? "POSITION OPEN" : "NO POSITION"}</span><span className="row-risk">{item.risk}</span></div>
                  </button>
                ))}
                <button className="load-more"><Activity size={13} /> View all observations <ArrowRight size={13} /></button>
              </CardContent>
            </Card>

            <div className="content-stack">
              <Card className="hero-card card-dark">
                <CardHeader className="hero-card-head">
                  <div>
                    <div className="incident-code"><StatusDot tone="orange" /> {incident.id} <span>·</span> {incident.time} UTC <span>·</span> {incident.chain}</div>
                    <CardTitle className="hero-title">{incident.title} <span className="hero-arrow">→</span> downstream exposure</CardTitle>
                  </div>
                  <div className="hero-tags">
                    <Badge className="badge-confirmed"><CheckCircle2 size={12} /> {incident.state}</Badge>
                    <Badge className="badge-contagion"><GitBranch size={12} /> {incident.kind}</Badge>
                    <Badge variant="outline" className={isRealCapture ? "capture-badge" : "fixture-badge"}>{provenanceLabel}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="hero-card-content">
                  <div className="metric-strip">
                    <Metric label="INCIDENT EXPOSURE" value={incident.risk} sub={incident.modeledDelta === null ? "not estimated from capture" : incident.consequence?.basis === "SCENARIO_ASSUMPTION" ? "scenario input · not VaR" : "modeled downstream loss"} tone="orange" />
                    <Metric label="MISPRICING" value={mispricing} sub={marketSummary} tone="cyan" />
                    <Metric label="CONFIDENCE" value={incident.confidence === null ? "n/a" : `${incident.confidence}%`} sub="causal graph confidence" tone="lime" />
                    <Metric label="DECISION" value={decision} sub={isOpen ? "paper position open" : "awaiting action"} tone={isTrade ? "violet" : "muted"} />
                  </div>
                </CardContent>
              </Card>

              <Card className="graph-card card-dark">
                <CardHeader className="card-head graph-head">
                  <div><CardTitle className="card-title"><Network size={16} className="title-icon" /> ActionGraph</CardTitle><div className="card-subtitle">CAUSAL EXPOSURE MAP · {incident.id}</div></div>
                  <div className="graph-actions"><span className="graph-key"><span className="legend-dot solid" /> observed</span><span className="graph-key"><span className="legend-dot ring" /> inferred</span><Button variant="ghost" size="icon-xs" className="top-icon" aria-label="Open graph"><ExternalLink size={14} /></Button></div>
                </CardHeader>
                <CardContent className="graph-content">
                  <div className="graph-stage">
                    <svg className="graph-lines" viewBox="0 0 900 310" preserveAspectRatio="none" aria-hidden="true">
                      <defs>
                        <linearGradient id="line-cyan" x1="0" x2="1"><stop offset="0" stopColor="#3ee7e1" stopOpacity=".25" /><stop offset="1" stopColor="#3ee7e1" /></linearGradient>
                        <linearGradient id="line-orange" x1="0" x2="1"><stop offset="0" stopColor="#3ee7e1" /><stop offset="1" stopColor="#f7a76a" /></linearGradient>
                      </defs>
                      <path d="M 163 156 C 230 156, 240 86, 304 86" stroke="url(#line-cyan)" strokeWidth="2" fill="none" />
                      <path d="M 163 156 C 232 156, 236 232, 304 232" stroke="url(#line-cyan)" strokeWidth="2" fill="none" />
                      <path d="M 440 86 C 506 86, 520 156, 572 156" stroke="url(#line-orange)" strokeWidth="2.5" fill="none" />
                      <path d="M 440 232 C 500 232, 520 156, 572 156" stroke="#9b7cf8" strokeWidth="1.5" strokeDasharray="5 5" fill="none" opacity=".75" />
                      <path d="M 710 156 C 760 156, 764 84, 806 84" stroke="#f7a76a" strokeWidth="2" fill="none" />
                      <path d="M 710 156 C 760 156, 764 232, 806 232" stroke="#f7a76a" strokeWidth="2" fill="none" opacity=".5" />
                      <circle cx="233" cy="123" r="3" fill="#3ee7e1" /><circle cx="233" cy="190" r="3" fill="#3ee7e1" /><circle cx="505" cy="121" r="3" fill="#f7a76a" /><circle cx="759" cy="122" r="3" fill="#f7a76a" />
                    </svg>
                    {incident.graphNodes.map((node) => (
                      <GraphNode key={node.id} {...node} selected={selectedNode === node.id} onClick={() => setSelectedNode(node.id)} />
                    ))}
                    <div className="graph-side-note">
                      <div className="side-note-label">SELECTED NODE</div>
                      <div className="side-note-value">{selectedGraphNode.label}</div>
                      <div className="side-note-copy">{getGraphNodeType(selectedGraphNode)} · {selectedEdge?.relation ?? "node"} · {selectedEdge?.epistemic.toLowerCase() ?? "evidence linked"} · {selectedEdge?.estimatedMagnitude ?? "n/a"}</div>
                      <div className="side-note-ref">{selectedEdge?.evidenceRef ?? "packet"}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="lower-grid">
                <Card className="evidence-card card-dark">
                  <CardHeader className="card-head">
                    <div><CardTitle className="card-title"><FileCheck2 size={16} className="title-icon" /> Evidence packet</CardTitle><div className="card-subtitle">WHY THE GRAPH IS ALLOWED TO EXIST</div></div>
                    <div className="evidence-head-actions"><Badge variant="outline" className="outline-badge">{incident.evidence.length} SOURCES</Badge><Button variant="ghost" size="icon-xs" className="top-icon" onClick={runAiReview} disabled={aiBusy} aria-label="Run server-side investigator review"><Sparkles size={14} /></Button><Button variant="ghost" size="icon-xs" className="top-icon" onClick={exportPacket} aria-label="Export evidence packet"><Download size={14} /></Button></div>
                  </CardHeader>
                  <CardContent className="evidence-content">
                    {incident.evidence.map((item) => (
                      <div className="evidence-row" key={item.type}>
                        <ToneIcon tone={item.tone}><EvidenceGlyph icon={item.icon} /></ToneIcon>
                        <div className="evidence-copy"><div className="evidence-label">{item.label} <span className="evidence-epistemic">{item.epistemic ?? (item.type === "EXPOSURE" ? "INFERRED" : "OBSERVED")}</span></div><div className="evidence-text">{item.text}</div><div className="evidence-ref"><Code2 size={11} /> {item.ref} · {isRealCapture ? "captured" : "replay fixture"}</div></div>
                        <Check size={14} className="evidence-check" />
                      </div>
                    ))}
                    {aiReview && (
                      <div className="ai-review">
                        <div className="ai-review-head"><span><Sparkles size={12} /> SERVER-SIDE INVESTIGATOR</span><strong>{aiReview.model} · {aiReview.result.confidence}/100</strong></div>
                        <p>{aiReview.result.interpretation}</p>
                        <div className="ai-review-hypothesis"><span>CAUSAL READING</span><strong>{aiReview.result.causalHypothesis}</strong></div>
                        <div className="ai-review-grid">{aiReview.result.falsification.map((check) => <div key={check.key}><span className={`ai-verdict ai-${check.verdict.toLowerCase()}`}>{check.verdict}</span><strong>{check.key}</strong><small>{check.explanation}</small></div>)}</div>
                        {aiReview.result.evidenceToSeek.length > 0 && <div className="ai-review-next"><span>WHAT WOULD CHANGE THE READ</span><small>{aiReview.result.evidenceToSeek.join(" · ")}</small></div>}
                        <div className="ai-review-foot">AI interprets the supplied packet only. Numbers, risk, and execution remain deterministic.</div>
                      </div>
                    )}
                    <Button variant="ghost" size="sm" className="evidence-link" onClick={exportPacket}><Download size={13} /> Export verifiable JSON packet <ArrowRight size={13} /></Button>
                  </CardContent>
                </Card>

              <Card className={`decision-card card-dark ${decision === "NO_TRADE" || decision === "MONITOR" ? "decision-no-trade" : ""}`}>
                  <CardHeader className="card-head">
                    <div><CardTitle className="card-title"><Sparkles size={16} className="title-icon" /> Agent decision</CardTitle><div className="card-subtitle">{lastRun?.incidentId === incident.id ? (lastRun.riskGate.passed ? "RISK GATE PASSED · RUN RECORDED" : "RISK GATE HELD · NO TRADE") : "RUN INVESTIGATION BEFORE ACTION"}</div></div>
                    <div className="decision-confidence"><span>{incident.confidence === null ? "—" : incident.confidence}</span><small>{incident.confidence === null ? "" : "/100"}</small></div>
                  </CardHeader>
                  <CardContent className="decision-content">
                    <div className="decision-verdict">
                      <div className="verdict-kicker">RECOMMENDATION</div>
                      <div className={`verdict-value ${isTrade ? "trade" : "no-trade"}`}>{decision}</div>
                      <div className="verdict-reason">{incident.decisionReason}</div>
                    </div>
                    <div className="decision-detail-grid">
                      <div><span>Instrument</span><strong>{isTrade ? incident.instrument : "—"}</strong></div>
                      <div><span>Side</span><strong>{isTrade ? incident.side : "—"}</strong></div>
                      <div><span>Max loss</span><strong>{isTrade ? incident.maxLoss : "$0"}</strong></div>
                      <div><span>Invalidation</span><strong>{isTrade ? incident.invalidation : "n/a"}</strong></div>
                      <div><span>Catalyst horizon</span><strong>{incident.catalystHorizon}</strong></div>
                      <div><span>Consequence range</span><strong>{incident.consequence ? `${incident.consequence.minimumPct.toFixed(1)} / ${incident.consequence.basePct.toFixed(1)} / ${incident.consequence.maximumPct.toFixed(1)}%` : "n/a"}</strong></div>
                    </div>
                    <div className="model-note"><span>{incident.consequence?.basis === "SCENARIO_ASSUMPTION" ? "DETERMINISTIC SCENARIO · NOT CALIBRATED" : "DETERMINISTIC MODEL"}</span><strong>{incident.consequence?.formula ?? "No consequence estimate: proxy edge is unproven"}</strong><small>{incident.consequence?.assumptions.join(" · ") ?? "The missing relationship is preserved as uncertainty, not filled with a proxy."}</small></div>
                    <div className="risk-checks">
                      {(lastRun?.incidentId === incident.id ? lastRun.riskGate : riskGate).checks.map((check) => <div className="risk-check" key={check.key}><span className={check.passed ? "risk-pass" : "risk-hold"}>{check.passed ? "PASS" : "HOLD"}</span><span>{check.label}</span><strong>{check.value}</strong><small>{check.threshold}</small></div>)}
                    </div>
                    <div className="falsification-block">
                      <div className="falsification-head"><span>CAUSAL FALSIFIER</span><span>{incident.falsification.filter((check) => check.status === "SUPPORTED").length}/{incident.falsification.length} supported</span></div>
                      {incident.falsification.map((check) => <div className="falsification-row" key={check.key}><span className={`falsification-status falsification-${check.status.toLowerCase()}`}>{check.status}</span><div><strong>{check.question}</strong><small>{check.answer} · {check.evidenceRef}</small></div></div>)}
                    </div>
                    <div className="decision-actions">
                      <Button size="sm" className="accent-button full-action" onClick={openPaperPosition}><Zap size={14} /> {activeOrder ? "POSITION OPEN" : "OPEN PAPER POSITION"}</Button>
                      <Button variant="outline" size="sm" className="quiet-button" onClick={rejectThesis}><Ban size={14} /> Reject thesis</Button>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Tabs defaultValue="activity" className="detail-tabs">
                <div className="tabs-header"><TabsList variant="line" className="tabs-list"><TabsTrigger value="activity">Decision log</TabsTrigger><TabsTrigger value="position">Position</TabsTrigger><TabsTrigger value="replay">Replay lab</TabsTrigger></TabsList><div className="tabs-live"><StatusDot tone="amber" /> local evidence ledger</div></div>
                <TabsContent value="activity" className="tab-panel">
                  <div className="timeline">
                    {incident.log.map((entry) => <div className="timeline-row" key={`${entry.time}-${entry.actor}`}><div className="timeline-time">{entry.time}</div><div className={`timeline-marker marker-${entry.tone}`} /><div className="timeline-body"><div className="timeline-actor">{entry.actor}</div><div className="timeline-text">{entry.text}</div></div></div>)}
                    {incident.stateTransitions.map((transition) => <div className="timeline-row" key={`${transition.at}-${transition.to}`}><div className="timeline-time">{transition.at}</div><div className="timeline-marker marker-violet" /><div className="timeline-body"><div className="timeline-actor">STATE · {transition.actor}</div><div className="timeline-text">{transition.from ?? "START"} → {transition.to} · {transition.reason}</div></div></div>)}
                  </div>
                  <div className="log-footer"><TerminalSquare size={13} /> Latest immutable run id <span>{lastRun?.incidentId === incident.id ? lastRun.id : "not run"}</span><ExternalLink size={12} /></div>
                </TabsContent>
                <TabsContent value="position" className="tab-panel">
                  <div className="empty-tab">
                    <Crosshair size={18} />
                    <div><strong>{activeOrder ? `${activeOrder.instrument} ${activeOrder.side.toLowerCase()} is open in paper mode` : "No active paper position"}</strong><span>{activeOrder ? `Receipt ${activeOrder.id} · max loss ${activeOrder.maxLoss} · local monitoring only` : "The agent will only write after the causal graph and risk gate pass."}</span></div>
                    {activeOrder && <Button variant="outline" size="sm" className="quiet-button" onClick={closePaperPosition}><X size={13} /> Close</Button>}
                  </div>
                  <div className="position-monitor">
                    <div><span>Entry</span><strong>{activeOrder?.entry ?? "—"}</strong></div>
                    <div><span>Current price</span><strong>{marketSnapshot ? `${marketSnapshot.markPrice.toFixed(4)} · observed` : "n/a · watcher unavailable"}</strong></div>
                    <div><span>Unrealized P&amp;L</span><strong>{unrealizedPnl}</strong></div>
                    <div><span>Thesis status</span><strong>{activeOrder ? "MONITORING" : "NO POSITION"}</strong></div>
                    <div><span>Updated exposure</span><strong>{activeOrder ? incident.risk : "—"}</strong></div>
                    <div><span>Exit condition</span><strong>{activeOrder ? activeOrder.invalidation : "—"}</strong></div>
                    <div className="position-monitor-wide"><span>Latest market observation</span><strong>{observationReceipt ? `${observationReceipt.observation.markPrice.toFixed(4)} · ${new Date(observationReceipt.observation.capturedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · ${observationReceipt.persisted ? "operator-stored" : "session-only"}` : incident.log[0]?.text ?? "No observation recorded"}</strong></div>
                  </div>
                  {paperOrders.length > 0 && (
                    <div className="ledger-block">
                      <div className="ledger-head"><span>PAPER LEDGER</span><span>{paperOrders.length} RECEIPT{paperOrders.length === 1 ? "" : "S"}</span></div>
                      {[...paperOrders].reverse().map((order) => (
                        <div className="ledger-row" key={order.id}>
                          <div><strong>{order.instrument} · {order.side}</strong><span>{order.incidentId} · {new Date(order.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {order.mode} · {order.runId}</span></div>
                          <Badge className={order.status === "OPEN" ? "badge-confirmed" : "outline-badge"}>{order.status}</Badge>
                          <Button variant="ghost" size="icon-xs" className="top-icon" onClick={() => copyOrderReceipt(order)} aria-label="Copy paper receipt"><Copy size={13} /></Button>
                        </div>
                      ))}
                      {copiedReceipt && <div className="receipt-copied"><CheckCircle2 size={12} /> Receipt copied</div>}
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="replay" className="tab-panel">
                  <div className="empty-tab"><TimerReset size={18} /><div><strong>Replay the incident without changing the ledger</strong><span>Re-run the graph against the same evidence snapshot and compare the decision.</span></div><Button variant="outline" size="sm" className="quiet-button" onClick={runInvestigation}><Play size={13} /> {isRunning ? "Running…" : "Replay"}</Button></div>
                  {runHistory.filter((run) => run.incidentId === incident.id).length > 0 && <div className="replay-history"><div className="ledger-head"><span>REPLAY RUNS · ORIGINAL LEDGER UNCHANGED</span><span>{runHistory.filter((run) => run.incidentId === incident.id).length}</span></div>{runHistory.filter((run) => run.incidentId === incident.id).map((run) => <div className="replay-history-row" key={run.id}><strong>{run.id}</strong><span>{run.decision} · {run.workflowState} · {new Date(run.completedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span><b className={run.riskGate.passed ? "risk-pass" : "risk-hold"}>{run.riskGate.passed ? "PASS" : "HOLD"}</b></div>)}</div>}
                </TabsContent>
              </Tabs>
            </div>
          </div>
        </section>

        <aside className="right-rail">
          <div className="rail-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> RUN STATUS</div><h2>Agent pulse</h2></div><Button variant="ghost" size="icon-xs" className="top-icon" aria-label="Pause agent"><Pause size={14} /></Button></div>
          <Card className="pulse-card card-dark">
            <CardContent>
              <div className="pulse-orb"><div className="pulse-ring ring-one" /><div className="pulse-ring ring-two" /><div className="pulse-core"><Activity size={18} /></div></div>
              <div className="pulse-state"><StatusDot tone="amber" /> REPLAY MODE</div>
              <div className="pulse-caption">The current queue is a deterministic replay surface. Live watcher adapters remain a separate capture boundary.</div>
              <div className="pulse-stats"><div><strong>{String(incidents.filter((item) => item.provenance === "REAL_CAPTURE").length).padStart(2, "0")}</strong><span>captures</span></div><div><strong>{String(incidents.length).padStart(2, "0")}</strong><span>incidents</span></div><div><strong>{String(activePositionCount).padStart(2, "0")}</strong><span>positions</span></div></div>
            </CardContent>
          </Card>
          <Card className="rail-card card-dark">
            <CardHeader className="card-head"><CardTitle className="card-title"><LockKeyhole size={15} className="title-icon" /> Policy gate</CardTitle><Badge className={riskGate.passed ? "badge-confirmed" : "outline-badge"}>{riskGate.passed ? "PASS" : "HOLD"}</Badge></CardHeader>
            <CardContent className="policy-content"><PolicyRow label="Decision gate" value={riskGate.passed ? "PASSED" : "HELD"} /><PolicyRow label="Declared max loss" value={incident.maxLoss} /><PolicyRow label="Market liquidity" value="NOT CAPTURED" /><PolicyRow label="Abstain on weak edge" value="ON" /></CardContent>
          </Card>
          <Card className="rail-card card-dark">
            <CardHeader className="card-head"><CardTitle className="card-title"><Globe2 size={15} className="title-icon" /> Coverage registry</CardTitle><span className="tiny-live"><StatusDot tone="amber" /> EXPLICIT</span></CardHeader>
            <CardContent className="watcher-content">{coverageRegistry.filter((item) => item.chain !== "BITGET").map((item) => <Watcher key={`${item.chain}-${item.protocol}`} name={item.chain} detail={`${item.protocol} · ${item.resolver}`} tone={item.chain === "BASE" ? "lime" : item.chain === "ETH" ? "cyan" : "violet"} status={item.status} />)}<div className="watcher-footnote">Only captured adapters are marked validated; automatic discovery is not claimed.</div></CardContent>
          </Card>
          <div className="rail-callout"><div className="callout-icon"><ShieldCheck size={16} /></div><div><strong>Proof over prediction.</strong><p>Every action is attached to evidence, a declared loss bound, and a reason to abstain.</p></div></div>
          <div className="rail-footer"><span>v0.3.2 · local paper ledger</span><span>UTC</span></div>
        </aside>
      </div>
    </main>
  )
}

function GraphNode({ id, className, tone, icon, kicker, label, detail, selected, onClick }: GraphNodeData & { selected: boolean; onClick: () => void }) {
  return <button type="button" className={`graph-node ${className} node-${tone} ${selected ? "node-selected" : ""}`} onClick={onClick} aria-pressed={selected}><span className="node-icon"><NodeGlyph icon={icon} /></span><span className="node-text"><span className="node-kicker">{kicker}</span><strong>{label}</strong><span className="node-detail">{detail}</span></span><span className="sr-only">Select {id}</span></button>
}

function NodeGlyph({ icon }: { icon: GraphNodeData["icon"] }) {
  if (icon === "incident") return <Siren size={16} />
  if (icon === "collateral") return <Layers3 size={16} />
  if (icon === "protocol") return <Database size={16} />
  if (icon === "market") return <TrendingDown size={16} />
  if (icon === "action") return <ArrowDownRight size={16} />
  return <Ban size={16} />
}

function EvidenceGlyph({ icon }: { icon: EvidenceItem["icon"] }) {
  if (icon === "onchain") return <Database size={15} />
  if (icon === "exposure") return <GitBranch size={15} />
  return <LineChart size={15} />
}

function PolicyRow({ label, value }: { label: string; value: string }) {
  return <div className="policy-row"><CheckCircle2 size={14} /><span>{label}</span><strong>{value}</strong></div>
}

function Watcher({ name, detail, tone, status }: { name: string; detail: string; tone: string; status: "VALIDATED" | "PLANNED" }) {
  return <div className="watcher-row"><StatusDot tone={status === "VALIDATED" ? tone : "amber"} /><div><strong>{name}</strong><span>{detail}</span></div><span className={`watcher-state watcher-${status.toLowerCase()}`}>{status}</span></div>
}
