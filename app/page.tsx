"use client"

import * as React from "react"
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  Ban,
  Bell,
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
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
  Radio,
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
  deriveDecision,
  exportEvidencePacket,
  incidents,
  type Decision,
  type EvidenceItem,
  type GraphNodeData,
  type PaperOrder,
} from "@/lib/wake-engine"

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
      return JSON.parse(saved) as PaperOrder[]
    } catch {
      window.localStorage.removeItem("wake.paper-orders")
      return []
    }
  })
  const [copiedReceipt, setCopiedReceipt] = React.useState(false)
  const [mobileNav, setMobileNav] = React.useState(false)

  const incident = incidents.find((item) => item.id === selectedId) ?? incidents[0]
  const activeOrder = paperOrders.find((order) => order.incidentId === incident.id && order.status === "OPEN")
  const selectedGraphNode = incident.graphNodes.find((node) => node.id === selectedNode) ?? incident.graphNodes[2]
  const activePositionCount = paperOrders.filter((order) => order.status === "OPEN").length

  React.useEffect(() => {
    window.localStorage.setItem("wake.paper-orders", JSON.stringify(paperOrders))
  }, [paperOrders])

  function runInvestigation() {
    setIsRunning(true)
    window.setTimeout(() => setIsRunning(false), 1600)
  }

  function selectIncident(id: string) {
    const nextIncident = incidents.find((item) => item.id === id) ?? incidents[0]
    const nextOrder = paperOrders.find((order) => order.incidentId === id && order.status === "OPEN")
    setSelectedId(id)
    setDecision(deriveDecision(nextIncident))
    setIsOpen(Boolean(nextOrder))
    setSelectedNode(nextIncident.graphNodes[2].id)
    setCopiedReceipt(false)
  }

  function openPaperPosition() {
    const existing = paperOrders.find((order) => order.incidentId === incident.id && order.status === "OPEN")
    if (existing) {
      setIsOpen(true)
      setDecision("TRADE")
      return
    }

    const order = createPaperOrder(incident)
    if (!order) {
      setDecision("NO TRADE")
      setIsOpen(false)
      return
    }

    setPaperOrders((current) => [...current.filter((item) => item.incidentId !== incident.id), order])
    setDecision("TRADE")
    setIsOpen(true)
  }

  function closePaperPosition() {
    setPaperOrders((current) => current.map((order) => (
      order.incidentId === incident.id && order.status === "OPEN"
        ? { ...order, status: "CLOSED" }
        : order
    )))
    setIsOpen(false)
  }

  function rejectThesis() {
    closePaperPosition()
    setDecision("NO TRADE")
  }

  function exportPacket() {
    const packet = exportEvidencePacket(incident, decision, paperOrders)
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
      <header className="topbar">
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
        <div className="topbar-center">
          <div className="system-status"><StatusDot tone="lime" /> SYSTEM OPERATIONAL</div>
          <div className="network-status"><Radio size={13} /> 3 CHAINS · 12 WATCHERS</div>
        </div>
        <div className="topbar-right">
          <Button variant="ghost" size="icon-sm" className="top-icon" aria-label="Notifications"><Bell size={16} /></Button>
          <Button variant="outline" size="sm" className="paper-button"><CircleDollarSign size={14} /> PAPER MODE <ChevronDown size={13} /></Button>
          <div className="avatar">AK</div>
        </div>
      </header>

      <div className="app-body">
        <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
          <div className="sidebar-nav">
            <div className="nav-label">WORKSPACE</div>
            <button className="nav-item active"><ScanSearch size={15} /> Incident queue <span className="nav-count">03</span></button>
            <button className="nav-item"><Network size={15} /> ActionGraph <span className="live-pulse" /></button>
            <button className="nav-item"><Crosshair size={15} /> Positions <span className="nav-count muted">{String(activePositionCount).padStart(2, "0")}</span></button>
            <button className="nav-item"><History size={15} /> Decision log</button>
            <div className="nav-label nav-label-spaced">EVIDENCE</div>
            <button className="nav-item"><FileCheck2 size={15} /> Evidence packets</button>
            <button className="nav-item"><TimerReset size={15} /> Replay lab</button>
            <button className="nav-item"><SlidersHorizontal size={15} /> Risk policy</button>
          </div>
          <div className="sidebar-footer">
            <div className="coverage-card">
              <div className="coverage-head"><span>WATCH COVERAGE</span><span className="coverage-percent">87%</span></div>
              <div className="coverage-track"><span /></div>
              <div className="coverage-copy">Ethereum · Base · Arbitrum</div>
            </div>
            <div className="agent-id">
              <div className="agent-avatar"><BrainCircuit size={15} /></div>
              <div><div className="agent-name">agent.wake</div><div className="agent-sub">key: 0x…a91f · verified</div></div>
              <ShieldCheck size={14} className="verified-icon" />
            </div>
          </div>
        </aside>

        <section className="main-canvas">
          <div className="page-heading">
            <div>
              <div className="eyebrow"><span className="eyebrow-line" /> LIVE INCIDENT QUEUE</div>
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

          <div className="workspace-grid">
            <Card className="incident-queue card-dark">
              <CardHeader className="card-head compact-head">
                <div><CardTitle className="card-title">Event queue</CardTitle><div className="card-subtitle">WATCHING IN REAL TIME</div></div>
                <Badge variant="outline" className="queue-badge"><StatusDot tone="lime" /> 03 ACTIVE</Badge>
              </CardHeader>
              <CardContent className="queue-content">
                {incidents.map((item) => (
                  <button key={item.id} className={`incident-row ${item.id === selectedId ? "selected" : ""}`} onClick={() => selectIncident(item.id)}>
                    <div className="incident-row-top"><span className="incident-time">{item.time} UTC</span><span className={`state-label state-${item.state.toLowerCase()}`}>{item.state}</span></div>
                    <div className="incident-title">{item.title}</div>
                    <div className="incident-subtitle">{item.subtitle}</div>
                    <div className="incident-row-bottom"><span className={`chain-pill chain-${item.accent}`}>{item.chain}</span><span>{item.kind}</span><span className="row-risk">{item.risk}</span></div>
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
                  </div>
                </CardHeader>
                <CardContent className="hero-card-content">
                  <div className="metric-strip">
                    <Metric label="VALUE AT RISK" value={incident.risk} sub="modeled downstream loss" tone="orange" />
                    <Metric label="MISPRICING" value={`${(incident.modeledDelta - incident.marketDelta).toFixed(1)}%`} sub={`model ${incident.modeledDelta.toFixed(1)}% · market ${incident.marketDelta.toFixed(1)}%`} tone="cyan" />
                    <Metric label="CONFIDENCE" value={`${incident.confidence}%`} sub="causal graph confidence" tone="lime" />
                    <Metric label="DECISION" value={decision} sub={isOpen ? "paper position open" : "awaiting action"} tone={decision === "TRADE" ? "violet" : "muted"} />
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
                      <div className="side-note-copy">Evidence linked · exposure bounded · market checked</div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="lower-grid">
                <Card className="evidence-card card-dark">
                  <CardHeader className="card-head">
                    <div><CardTitle className="card-title"><FileCheck2 size={16} className="title-icon" /> Evidence packet</CardTitle><div className="card-subtitle">WHY THE GRAPH IS ALLOWED TO EXIST</div></div>
                    <div className="evidence-head-actions"><Badge variant="outline" className="outline-badge">{incident.evidence.length} SOURCES</Badge><Button variant="ghost" size="icon-xs" className="top-icon" onClick={exportPacket} aria-label="Export evidence packet"><Download size={14} /></Button></div>
                  </CardHeader>
                  <CardContent className="evidence-content">
                    {incident.evidence.map((item) => (
                      <div className="evidence-row" key={item.type}>
                        <ToneIcon tone={item.tone}><EvidenceGlyph icon={item.icon} /></ToneIcon>
                        <div className="evidence-copy"><div className="evidence-label">{item.label}</div><div className="evidence-text">{item.text}</div><div className="evidence-ref"><Code2 size={11} /> {item.ref}</div></div>
                        <Check size={14} className="evidence-check" />
                      </div>
                    ))}
                    <Button variant="ghost" size="sm" className="evidence-link" onClick={exportPacket}><Download size={13} /> Export verifiable JSON packet <ArrowRight size={13} /></Button>
                  </CardContent>
                </Card>

                <Card className={`decision-card card-dark ${decision === "NO TRADE" ? "decision-no-trade" : ""}`}>
                  <CardHeader className="card-head">
                    <div><CardTitle className="card-title"><Sparkles size={16} className="title-icon" /> Agent decision</CardTitle><div className="card-subtitle">CAUSAL FALSIFICATION PASSED</div></div>
                    <div className="decision-confidence"><span>{incident.confidence}</span><small>/100</small></div>
                  </CardHeader>
                  <CardContent className="decision-content">
                    <div className="decision-verdict">
                      <div className="verdict-kicker">RECOMMENDATION</div>
                      <div className={`verdict-value ${decision === "TRADE" ? "trade" : "no-trade"}`}>{decision}</div>
                      <div className="verdict-reason">{incident.decisionReason}</div>
                    </div>
                    <div className="decision-detail-grid">
                      <div><span>Instrument</span><strong>{decision === "TRADE" ? incident.instrument : "—"}</strong></div>
                      <div><span>Side</span><strong>{decision === "TRADE" ? incident.side : "—"}</strong></div>
                      <div><span>Max loss</span><strong>{decision === "TRADE" ? incident.maxLoss : "$0"}</strong></div>
                      <div><span>Invalidation</span><strong>{decision === "TRADE" ? incident.invalidation : "n/a"}</strong></div>
                    </div>
                    <div className="decision-actions">
                      <Button size="sm" className="accent-button full-action" onClick={openPaperPosition}><Zap size={14} /> {activeOrder ? "POSITION OPEN" : "OPEN PAPER POSITION"}</Button>
                      <Button variant="outline" size="sm" className="quiet-button" onClick={rejectThesis}><Ban size={14} /> Reject thesis</Button>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Tabs defaultValue="activity" className="detail-tabs">
                <div className="tabs-header"><TabsList variant="line" className="tabs-list"><TabsTrigger value="activity">Decision log</TabsTrigger><TabsTrigger value="position">Position</TabsTrigger><TabsTrigger value="replay">Replay lab</TabsTrigger></TabsList><div className="tabs-live"><StatusDot tone="lime" /> autosaving evidence</div></div>
                <TabsContent value="activity" className="tab-panel">
                  <div className="timeline">
                    {incident.log.map((entry) => <div className="timeline-row" key={`${entry.time}-${entry.actor}`}><div className="timeline-time">{entry.time}</div><div className={`timeline-marker marker-${entry.tone}`} /><div className="timeline-body"><div className="timeline-actor">{entry.actor}</div><div className="timeline-text">{entry.text}</div></div></div>)}
                  </div>
                  <div className="log-footer"><TerminalSquare size={13} /> Immutable run id <span>run_{incident.id.slice(4).toLowerCase()}_wake</span><ExternalLink size={12} /></div>
                </TabsContent>
                <TabsContent value="position" className="tab-panel">
                  <div className="empty-tab">
                    <Crosshair size={18} />
                    <div><strong>{activeOrder ? `${activeOrder.instrument} ${activeOrder.side.toLowerCase()} is open in paper mode` : "No active paper position"}</strong><span>{activeOrder ? `Receipt ${activeOrder.id} · max loss ${activeOrder.maxLoss} · monitoring every 15s` : "The agent will only write after the causal graph and risk gate pass."}</span></div>
                    {activeOrder && <Button variant="outline" size="sm" className="quiet-button" onClick={closePaperPosition}><X size={13} /> Close</Button>}
                  </div>
                  {paperOrders.length > 0 && (
                    <div className="ledger-block">
                      <div className="ledger-head"><span>PAPER LEDGER</span><span>{paperOrders.length} RECEIPT{paperOrders.length === 1 ? "" : "S"}</span></div>
                      {[...paperOrders].reverse().map((order) => (
                        <div className="ledger-row" key={order.id}>
                          <div><strong>{order.instrument} · {order.side}</strong><span>{order.incidentId} · {new Date(order.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {order.mode}</span></div>
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
              <div className="pulse-state"><StatusDot tone="lime" /> SCANNING</div>
              <div className="pulse-caption">The agent is watching for causal state changes across your configured protocols.</div>
              <div className="pulse-stats"><div><strong>12</strong><span>watchers</span></div><div><strong>03</strong><span>incidents</span></div><div><strong>{String(activePositionCount).padStart(2, "0")}</strong><span>positions</span></div></div>
            </CardContent>
          </Card>
          <Card className="rail-card card-dark">
            <CardHeader className="card-head"><CardTitle className="card-title"><LockKeyhole size={15} className="title-icon" /> Policy gate</CardTitle><Badge className="badge-confirmed">PASS</Badge></CardHeader>
            <CardContent className="policy-content"><PolicyRow label="Max incident risk" value="18% VaR" /><PolicyRow label="Max position loss" value={incident.maxLoss} /><PolicyRow label="Minimum liquidity" value="2.5×" /><PolicyRow label="Abstain on weak edge" value="ON" /><Button variant="outline" size="sm" className="quiet-button policy-button"><SlidersHorizontal size={13} /> Edit policy</Button></CardContent>
          </Card>
          <Card className="rail-card card-dark">
            <CardHeader className="card-head"><CardTitle className="card-title"><Globe2 size={15} className="title-icon" /> Chain watchers</CardTitle><span className="tiny-live"><StatusDot tone="lime" /> LIVE</span></CardHeader>
            <CardContent className="watcher-content"><Watcher name="Ethereum" detail="5 protocols" tone="cyan" /><Watcher name="Base" detail="4 protocols" tone="lime" /><Watcher name="Arbitrum" detail="3 protocols" tone="violet" /></CardContent>
          </Card>
          <div className="rail-callout"><div className="callout-icon"><ShieldCheck size={16} /></div><div><strong>Proof over prediction.</strong><p>Every action is attached to evidence, a bounded loss model, and a reason to abstain.</p></div></div>
          <div className="rail-footer"><span>v0.3.0 · local paper ledger</span><span>UTC</span></div>
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

function Watcher({ name, detail, tone }: { name: string; detail: string; tone: string }) {
  return <div className="watcher-row"><StatusDot tone={tone} /><div><strong>{name}</strong><span>{detail}</span></div><span className="watcher-state">SYNCED</span></div>
}
