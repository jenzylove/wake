"use client"

import * as React from "react"
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  Ban,
  Bell,
  BookOpen,
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Code2,
  Crosshair,
  Database,
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

type Incident = {
  id: string
  time: string
  title: string
  subtitle: string
  state: "CONFIRMED" | "INVESTIGATING" | "RESOLVED"
  kind: "CONTAGION" | "DIRECT" | "NO TRADE"
  chain: string
  risk: string
  move: string
  confidence: number
  accent: "cyan" | "amber" | "violet"
}

const incidents: Incident[] = [
  { id: "INC-0921", time: "14:32:18", title: "Oracle deviation", subtitle: "rsETH collateral on Aave v3", state: "CONFIRMED", kind: "CONTAGION", chain: "BASE", risk: "$8.4M", move: "3.7%", confidence: 86, accent: "cyan" },
  { id: "INC-0918", time: "13:58:44", title: "Bridge mint anomaly", subtitle: "USDC supply delta on Arbitrum", state: "INVESTIGATING", kind: "NO TRADE", chain: "ARB", risk: "$2.1M", move: "0.4%", confidence: 61, accent: "amber" },
  { id: "INC-0907", time: "11:16:05", title: "Treasury transfer", subtitle: "Dormant multisig → exchange", state: "RESOLVED", kind: "DIRECT", chain: "ETH", risk: "$540K", move: "1.2%", confidence: 92, accent: "violet" },
]

const evidence = [
  { type: "ONCHAIN", label: "State change confirmed", text: "Oracle answer moved 4.8σ from the 30d median.", ref: "0x7f3a…91c2", icon: Database, tone: "cyan" },
  { type: "EXPOSURE", label: "Material downstream link", text: "Aave v3 Base accepts rsETH as collateral; debt cap is 12.5M USDC.", ref: "aave-v3/base", icon: GitBranch, tone: "lime" },
  { type: "MARKET", label: "Price not fully adjusted", text: "AAVE perp moved 0.9% while modeled protocol loss is 3.7%.", ref: "AAVEUSDT · Bitget", icon: LineChart, tone: "orange" },
]

const logEntries = [
  { time: "14:36:08", actor: "MONITOR", text: "AAVEUSDT moved +0.3%; thesis remains live.", tone: "cyan" },
  { time: "14:34:51", actor: "RISK GATE", text: "Size capped at 18% of incident VaR; max loss $420.", tone: "lime" },
  { time: "14:33:27", actor: "ACTIONGRAPH", text: "Added Aave v3 → AAVE governance token edge.", tone: "violet" },
  { time: "14:32:18", actor: "WATCHER", text: "Incident created from Base log + oracle deviation.", tone: "orange" },
]

function StatusDot({ tone = "cyan" }: { tone?: string }) {
  return <span className={`status-dot status-${tone}`} aria-hidden="true" />
}

function ToneIcon({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`icon-tile icon-${tone}`}>{children}</span>
}

function Metric({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: string }) {
  return <div className="metric-cell"><div className="metric-label">{label}</div><div className={`metric-value value-${tone}`}>{value}</div><div className="metric-sub">{sub}</div></div>
}

export default function Home() {
  const [selectedId, setSelectedId] = React.useState(incidents[0].id)
  const [isRunning, setIsRunning] = React.useState(false)
  const [isOpen, setIsOpen] = React.useState(false)
  const [decision, setDecision] = React.useState<"TRADE" | "NO TRADE">("TRADE")
  const [selectedNode, setSelectedNode] = React.useState("AAVE v3 Base")
  const [mobileNav, setMobileNav] = React.useState(false)
  const incident = incidents.find((item) => item.id === selectedId) ?? incidents[0]

  function runInvestigation() {
    setIsRunning(true)
    window.setTimeout(() => setIsRunning(false), 1600)
  }

  function selectIncident(id: string) {
    setSelectedId(id)
    setDecision(id === incidents[1].id ? "NO TRADE" : "TRADE")
    setIsOpen(false)
    setSelectedNode(id === incidents[1].id ? "USDC bridge" : "AAVE v3 Base")
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="topbar-left">
          <button className="mobile-menu" onClick={() => setMobileNav((value) => !value)} aria-label="Toggle navigation"><Menu size={18} /></button>
          <div className="brand-mark"><span>↯</span></div>
          <div><div className="brand-name">WAKE</div><div className="brand-kicker">EVIDENCE BEFORE EXECUTION</div></div>
        </div>
        <div className="topbar-center"><div className="system-status"><StatusDot tone="lime" /> SYSTEM OPERATIONAL</div><div className="network-status"><Radio size={13} /> 3 CHAINS · 12 WATCHERS</div></div>
        <div className="topbar-right"><Button variant="ghost" size="icon-sm" className="top-icon" aria-label="Notifications"><Bell size={16} /></Button><Button variant="outline" size="sm" className="paper-button"><CircleDollarSign size={14} /> PAPER MODE <ChevronDown size={13} /></Button><div className="avatar">AK</div></div>
      </header>

      <div className="app-body">
        <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
          <div className="sidebar-nav">
            <div className="nav-label">WORKSPACE</div>
            <button className="nav-item active"><ScanSearch size={15} /> Incident queue <span className="nav-count">03</span></button>
            <button className="nav-item"><Network size={15} /> ActionGraph <span className="live-pulse" /></button>
            <button className="nav-item"><Crosshair size={15} /> Positions <span className="nav-count muted">01</span></button>
            <button className="nav-item"><History size={15} /> Decision log</button>
            <div className="nav-label nav-label-spaced">EVIDENCE</div>
            <button className="nav-item"><FileCheck2 size={15} /> Evidence packets</button>
            <button className="nav-item"><TimerReset size={15} /> Replay lab</button>
            <button className="nav-item"><SlidersHorizontal size={15} /> Risk policy</button>
          </div>
          <div className="sidebar-footer"><div className="coverage-card"><div className="coverage-head"><span>WATCH COVERAGE</span><span className="coverage-percent">87%</span></div><div className="coverage-track"><span /></div><div className="coverage-copy">Ethereum · Base · Arbitrum</div></div><div className="agent-id"><div className="agent-avatar"><BrainCircuit size={15} /></div><div><div className="agent-name">agent.wake</div><div className="agent-sub">key: 0x…a91f · verified</div></div><ShieldCheck size={14} className="verified-icon" /></div></div>
        </aside>

        <section className="main-canvas">
          <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> LIVE INCIDENT QUEUE</div><h1>Find the consequence,<br /><em>not just the headline.</em></h1></div><div className="heading-actions"><Button variant="outline" size="sm" className="quiet-button" onClick={runInvestigation}><RefreshCw size={14} className={isRunning ? "spin" : ""} /> {isRunning ? "RE-ANALYZING" : "REFRESH GRAPH"}</Button><Button size="sm" className="accent-button" onClick={() => setIsOpen((value) => !value)}>{isOpen ? <X size={14} /> : <Play size={14} />} {isOpen ? "CLOSE POSITION" : "RUN PAPER ACTION"}</Button></div></div>

          <div className="workspace-grid">
            <Card className="incident-queue card-dark"><CardHeader className="card-head compact-head"><div><CardTitle className="card-title">Event queue</CardTitle><div className="card-subtitle">WATCHING IN REAL TIME</div></div><Badge variant="outline" className="queue-badge"><StatusDot tone="lime" /> 03 ACTIVE</Badge></CardHeader><CardContent className="queue-content">{incidents.map((item) => <button key={item.id} className={`incident-row ${item.id === selectedId ? "selected" : ""}`} onClick={() => selectIncident(item.id)}><div className="incident-row-top"><span className="incident-time">{item.time} UTC</span><span className={`state-label state-${item.state.toLowerCase()}`}>{item.state}</span></div><div className="incident-title">{item.title}</div><div className="incident-subtitle">{item.subtitle}</div><div className="incident-row-bottom"><span className={`chain-pill chain-${item.accent}`}>{item.chain}</span><span>{item.kind}</span><span className="row-risk">{item.risk}</span></div></button>)}<button className="load-more"><Activity size={13} /> View all observations <ArrowRight size={13} /></button></CardContent></Card>

            <div className="content-stack">
              <Card className="hero-card card-dark"><CardHeader className="hero-card-head"><div><div className="incident-code"><StatusDot tone="orange" /> {incident.id} <span>·</span> {incident.time} UTC <span>·</span> {incident.chain}</div><CardTitle className="hero-title">{incident.title} <span className="hero-arrow">→</span> downstream exposure</CardTitle></div><div className="hero-tags"><Badge className="badge-confirmed"><CheckCircle2 size={12} /> {incident.state}</Badge><Badge className="badge-contagion"><GitBranch size={12} /> {incident.kind}</Badge></div></CardHeader><CardContent className="hero-card-content"><div className="metric-strip"><Metric label="VALUE AT RISK" value={incident.risk} sub="modeled downstream loss" tone="orange" /><Metric label="MISPRICING" value={incident.move} sub="versus exposure model" tone="cyan" /><Metric label="CONFIDENCE" value={`${incident.confidence}%`} sub="causal graph confidence" tone="lime" /><Metric label="DECISION" value={decision} sub={isOpen ? "paper position open" : "awaiting action"} tone={decision === "TRADE" ? "violet" : "muted"} /></div></CardContent></Card>

              <Card className="graph-card card-dark"><CardHeader className="card-head graph-head"><div><CardTitle className="card-title"><Network size={16} className="title-icon" /> ActionGraph</CardTitle><div className="card-subtitle">CAUSAL EXPOSURE MAP · {incident.id}</div></div><div className="graph-actions"><span className="graph-key"><span className="legend-dot solid" /> observed</span><span className="graph-key"><span className="legend-dot ring" /> inferred</span><Button variant="ghost" size="icon-xs" className="top-icon" aria-label="Open graph"><ExternalLink size={14} /></Button></div></CardHeader><CardContent className="graph-content"><div className="graph-stage"><svg className="graph-lines" viewBox="0 0 900 310" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="line-cyan" x1="0" x2="1"><stop offset="0" stopColor="#3ee7e1" stopOpacity=".25" /><stop offset="1" stopColor="#3ee7e1" /></linearGradient><linearGradient id="line-orange" x1="0" x2="1"><stop offset="0" stopColor="#3ee7e1" /><stop offset="1" stopColor="#f7a76a" /></linearGradient></defs><path d="M 163 156 C 230 156, 240 86, 304 86" stroke="url(#line-cyan)" strokeWidth="2" fill="none" /><path d="M 163 156 C 232 156, 236 232, 304 232" stroke="url(#line-cyan)" strokeWidth="2" fill="none" /><path d="M 440 86 C 506 86, 520 156, 572 156" stroke="url(#line-orange)" strokeWidth="2.5" fill="none" /><path d="M 440 232 C 500 232, 520 156, 572 156" stroke="#9b7cf8" strokeWidth="1.5" strokeDasharray="5 5" fill="none" opacity=".75" /><path d="M 710 156 C 760 156, 764 84, 806 84" stroke="#f7a76a" strokeWidth="2" fill="none" /><path d="M 710 156 C 760 156, 764 232, 806 232" stroke="#f7a76a" strokeWidth="2" fill="none" opacity=".5" /><circle cx="233" cy="123" r="3" fill="#3ee7e1" /><circle cx="233" cy="190" r="3" fill="#3ee7e1" /><circle cx="505" cy="121" r="3" fill="#f7a76a" /><circle cx="759" cy="122" r="3" fill="#f7a76a" /></svg><GraphNode className="node-incident" tone="orange" icon={<Siren size={16} />} kicker="OBSERVED · 14:32:18" label="Oracle deviation" detail="4.8σ from median" selected={selectedNode === "Oracle deviation"} onClick={() => setSelectedNode("Oracle deviation")} /><GraphNode className="node-collateral" tone="cyan" icon={<Layers3 size={16} />} kicker="ASSET · rsETH" label="Collateral" detail="$12.5M debt cap" selected={selectedNode === "rsETH collateral"} onClick={() => setSelectedNode("rsETH collateral")} /><GraphNode className="node-protocol" tone="lime" icon={<Database size={16} />} kicker="PROTOCOL · BASE" label="AAVE v3 Base" detail="$8.4M modeled loss" selected={selectedNode === "AAVE v3 Base"} onClick={() => setSelectedNode("AAVE v3 Base")} /><GraphNode className="node-market" tone="violet" icon={<TrendingDown size={16} />} kicker="BITGET · PERP" label="AAVEUSDT" detail="+0.9% priced in" selected={selectedNode === "AAVEUSDT"} onClick={() => setSelectedNode("AAVEUSDT")} /><GraphNode className="node-route-a" tone="orange" icon={<ArrowDownRight size={16} />} kicker="ACTION · DIRECT" label="AAVE short" detail="0.18R · paper" selected={selectedNode === "AAVE short"} onClick={() => setSelectedNode("AAVE short")} /><GraphNode className="node-route-b" tone="violet" icon={<Ban size={16} />} kicker="ALTERNATE" label="NO TRADE" detail="if already repriced" selected={selectedNode === "NO TRADE"} onClick={() => setSelectedNode("NO TRADE")} /><div className="graph-side-note"><div className="side-note-label">SELECTED EDGE</div><div className="side-note-value">{selectedNode}</div><div className="side-note-copy">Evidence linked · exposure bounded · market checked</div></div></div></CardContent></Card>

              <div className="lower-grid"><Card className="evidence-card card-dark"><CardHeader className="card-head"><div><CardTitle className="card-title"><FileCheck2 size={16} className="title-icon" /> Evidence packet</CardTitle><div className="card-subtitle">WHY THE GRAPH IS ALLOWED TO EXIST</div></div><Badge variant="outline" className="outline-badge">3 SOURCES</Badge></CardHeader><CardContent className="evidence-content">{evidence.map((item) => { const Icon = item.icon; return <div className="evidence-row" key={item.type}><ToneIcon tone={item.tone}><Icon size={15} /></ToneIcon><div className="evidence-copy"><div className="evidence-label">{item.label}</div><div className="evidence-text">{item.text}</div><div className="evidence-ref"><Code2 size={11} /> {item.ref}</div></div><Check size={14} className="evidence-check" /></div> })}<Button variant="ghost" size="sm" className="evidence-link"><BookOpen size={13} /> Open full evidence packet <ArrowRight size={13} /></Button></CardContent></Card><Card className={`decision-card card-dark ${decision === "NO TRADE" ? "decision-no-trade" : ""}`}><CardHeader className="card-head"><div><CardTitle className="card-title"><Sparkles size={16} className="title-icon" /> Agent decision</CardTitle><div className="card-subtitle">CAUSAL FALSIFICATION PASSED</div></div><div className="decision-confidence"><span>86</span><small>/100</small></div></CardHeader><CardContent className="decision-content"><div className="decision-verdict"><div className="verdict-kicker">RECOMMENDATION</div><div className={`verdict-value ${decision === "TRADE" ? "trade" : "no-trade"}`}>{decision}</div><div className="verdict-reason">{decision === "TRADE" ? "Exposure remains underpriced after cost and liquidity checks." : "The apparent link is not material enough to justify a position."}</div></div><div className="decision-detail-grid"><div><span>Instrument</span><strong>{decision === "TRADE" ? "AAVEUSDT" : "—"}</strong></div><div><span>Side</span><strong>{decision === "TRADE" ? "SHORT" : "—"}</strong></div><div><span>Max loss</span><strong>{decision === "TRADE" ? "$420" : "$0"}</strong></div><div><span>Invalidation</span><strong>{decision === "TRADE" ? "+2.0%" : "n/a"}</strong></div></div><div className="decision-actions"><Button size="sm" className="accent-button full-action" onClick={() => { setDecision("TRADE"); setIsOpen(true) }}><Zap size={14} /> {isOpen ? "POSITION OPEN" : "OPEN PAPER POSITION"}</Button><Button variant="outline" size="sm" className="quiet-button" onClick={() => { setDecision("NO TRADE"); setIsOpen(false) }}><Ban size={14} /> Reject thesis</Button></div></CardContent></Card></div>

              <Tabs defaultValue="activity" className="detail-tabs"><div className="tabs-header"><TabsList variant="line" className="tabs-list"><TabsTrigger value="activity">Decision log</TabsTrigger><TabsTrigger value="position">Position</TabsTrigger><TabsTrigger value="replay">Replay lab</TabsTrigger></TabsList><div className="tabs-live"><StatusDot tone="lime" /> autosaving evidence</div></div><TabsContent value="activity" className="tab-panel"><div className="timeline">{logEntries.map((entry) => <div className="timeline-row" key={`${entry.time}-${entry.actor}`}><div className="timeline-time">{entry.time}</div><div className={`timeline-marker marker-${entry.tone}`} /><div className="timeline-body"><div className="timeline-actor">{entry.actor}</div><div className="timeline-text">{entry.text}</div></div></div>)}</div><div className="log-footer"><TerminalSquare size={13} /> Immutable run id <span>run_0921_a91f</span><ExternalLink size={12} /></div></TabsContent><TabsContent value="position" className="tab-panel"><div className="empty-tab"><Crosshair size={18} /><div><strong>{isOpen ? "AAVEUSDT short is open in paper mode" : "No live position"}</strong><span>{isOpen ? "Entry 14:36:08 UTC · max loss $420 · monitoring every 15s" : "The agent will only write after the causal graph and risk gate pass."}</span></div></div></TabsContent><TabsContent value="replay" className="tab-panel"><div className="empty-tab"><TimerReset size={18} /><div><strong>Replay the incident without changing the ledger</strong><span>Re-run the graph against the same evidence snapshot and compare the decision.</span></div><Button variant="outline" size="sm" className="quiet-button" onClick={runInvestigation}><Play size={13} /> Replay</Button></div></TabsContent></Tabs>
            </div>
          </div>
        </section>

        <aside className="right-rail"><div className="rail-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> RUN STATUS</div><h2>Agent pulse</h2></div><Button variant="ghost" size="icon-xs" className="top-icon" aria-label="Pause agent"><Pause size={14} /></Button></div><Card className="pulse-card card-dark"><CardContent><div className="pulse-orb"><div className="pulse-ring ring-one" /><div className="pulse-ring ring-two" /><div className="pulse-core"><Activity size={18} /></div></div><div className="pulse-state"><StatusDot tone="lime" /> SCANNING</div><div className="pulse-caption">The agent is watching for causal state changes across your configured protocols.</div><div className="pulse-stats"><div><strong>12</strong><span>watchers</span></div><div><strong>03</strong><span>incidents</span></div><div><strong>01</strong><span>position</span></div></div></CardContent></Card><Card className="rail-card card-dark"><CardHeader className="card-head"><CardTitle className="card-title"><LockKeyhole size={15} className="title-icon" /> Policy gate</CardTitle><Badge className="badge-confirmed">PASS</Badge></CardHeader><CardContent className="policy-content"><PolicyRow label="Max incident risk" value="18% VaR" /><PolicyRow label="Max position loss" value="$420" /><PolicyRow label="Minimum liquidity" value="2.5×" /><PolicyRow label="Abstain on weak edge" value="ON" /><Button variant="outline" size="sm" className="quiet-button policy-button"><SlidersHorizontal size={13} /> Edit policy</Button></CardContent></Card><Card className="rail-card card-dark"><CardHeader className="card-head"><CardTitle className="card-title"><Globe2 size={15} className="title-icon" /> Chain watchers</CardTitle><span className="tiny-live"><StatusDot tone="lime" /> LIVE</span></CardHeader><CardContent className="watcher-content"><Watcher name="Ethereum" detail="5 protocols" tone="cyan" /><Watcher name="Base" detail="4 protocols" tone="lime" /><Watcher name="Arbitrum" detail="3 protocols" tone="violet" /></CardContent></Card><div className="rail-callout"><div className="callout-icon"><ShieldCheck size={16} /></div><div><strong>Proof over prediction.</strong><p>Every action is attached to evidence, a bounded loss model, and a reason to abstain.</p></div></div><div className="rail-footer"><span>v0.1.0 · local evidence mode</span><span>UTC</span></div></aside>
      </div>
    </main>
  )
}

function GraphNode({ className, tone, icon, kicker, label, detail, selected, onClick }: { className: string; tone: string; icon: React.ReactNode; kicker: string; label: string; detail: string; selected: boolean; onClick: () => void }) {
  return <button className={`graph-node ${className} node-${tone} ${selected ? "node-selected" : ""}`} onClick={onClick}><span className="node-icon">{icon}</span><span className="node-text"><span className="node-kicker">{kicker}</span><strong>{label}</strong><span className="node-detail">{detail}</span></span></button>
}

function PolicyRow({ label, value }: { label: string; value: string }) {
  return <div className="policy-row"><CheckCircle2 size={14} /><span>{label}</span><strong>{value}</strong></div>
}

function Watcher({ name, detail, tone }: { name: string; detail: string; tone: string }) {
  return <div className="watcher-row"><StatusDot tone={tone} /><div><strong>{name}</strong><span>{detail}</span></div><span className="watcher-state">SYNCED</span></div>
}
