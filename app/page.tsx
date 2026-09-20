"use client"

import * as React from "react"
import "./console.css"
import { ExposureField } from "@/components/exposure-field"

// The WAKE console.
//
// Everything on this page is served from what the scheduled agent committed: incidents derived
// from capture packets, incidents discovered from the public exploit feed, blind challenge runs,
// and the Bitget Demo positions the agent opened by itself. Nothing is illustrative.

/* eslint-disable @typescript-eslint/no-explicit-any -- the console reads committed JSON whose
   shape is pinned by the API routes and the data tests, not by this view. */
type Json = Record<string, any>
type Decision = string
type Source = "captured" | "discovered" | "blind"

type Falsifier = { key?: string; question: string; status: string; blocksTrade: boolean; answer?: string }
type Ai = { exploitClass: string; mechanism?: string; lossBearer?: string; narrative?: string; veto: boolean; concerns?: string[] } | null

type Item = {
  id: string
  source: Source
  title: string
  subtitle: string
  decision: Decision
  instrument: string | null
  when: string
  numbers: Array<{ label: string; value: string }>
  falsification: Falsifier[]
  ai: Ai
  note?: string
  sizing?: { notionalUsd: number; maxLossUsd: number; stopPct?: number; bindingConstraint?: string } | null
  extra?: Array<{ label: string; value: string }>
  links?: Array<{ label: string; href: string }>
}

type State = {
  agent?: { mode: string; updatedAt: string; incidentsEvaluated: number; eligibleNow: number; open: number; closedTrades: number; realizedPnlUsd: number; executorOk: boolean | null; closedBySource?: Record<string, { trades: number; realizedPnlUsd: number; wins: number }> }
  positions?: { open: Array<Record<string, unknown>>; closed: Array<Record<string, unknown>> }
  recentLog?: Array<Record<string, unknown>>
  blind?: { runs: number; detected: number; decoysDismissed: number; tradeTargetCorrect: number; gateCleared: number; falsePositives: number; medianDetectionMs: number | null; contagionFound: { found: number; applicable: number }; incidents?: Array<Record<string, unknown>> }
  discovery?: { updatedAt: string }
}

const usd = (n: number | null | undefined, digits = 0) =>
  typeof n === "number" && Number.isFinite(n) ? `$${n.toLocaleString("en-US", { maximumFractionDigits: digits })}` : "n/a"
const pct = (n: number | null | undefined) => (typeof n === "number" ? `${n > 0 ? "+" : ""}${n.toFixed(2)}%` : "n/a")
const ago = (iso: string | undefined) => {
  if (!iso) return "n/a"
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000)
  if (s < 90) return `${Math.round(s)}s ago`
  if (s < 5400) return `${Math.round(s / 60)}m ago`
  if (s < 172800) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}
const tone = (decision: Decision) =>
  decision.startsWith("TRADE") || decision === "HEDGE" ? "is-trade" : decision === "MONITOR" ? "is-hold" : "is-stop"

function useConsoleData() {
  const [data, setData] = React.useState<{ items: Item[]; state: State; error: string | null }>({ items: [], state: {}, error: null })

  const load = React.useCallback(async () => {
    try {
      const json = (path: string) => fetch(path).then((r) => r.json() as Promise<Json>)
      const [incidentsRes, discoveredRes, stateRes] = await Promise.all([
        json("/api/incidents"), json("/api/discovered"), json("/api/agent/state"),
      ])

      const captured: Item[] = (incidentsRes.incidents ?? []).map((r: Json) => {
        const model: Json = r.model ?? {}
        const gate: Json | undefined = r.gate
        return {
          id: String(r.id), source: "captured" as const, title: String(r.title),
          subtitle: `${r.chain} · ${r.provenance === "REAL_CAPTURE" ? "real capture" : "replay fixture"} · ${r.numbersProvenance === "COMPUTED" ? "computed numbers" : "authored scenario"}`,
          decision: String(r.decision), instrument: r.instrument ?? null, when: String(r.observedAt),
          numbers: [
            { label: "modeled", value: pct(model.modeledDeltaPct) },
            { label: "already priced", value: pct(model.marketDeltaPct) },
            { label: "residual", value: pct(model.residualPct) },
            { label: "confidence", value: model.confidence === null || model.confidence === undefined ? "n/a" : `${model.confidence}%` },
          ],
          falsification: (r.falsification ?? []) as Falsifier[],
          ai: null,
          note: r.decisionReason ?? undefined,
          sizing: r.sizing ?? null,
          extra: (gate?.checks ?? []).map((c: Json) => ({ label: String(c.label), value: `${c.value} (needs ${c.threshold})` })),
        }
      })

      const discovered: Item[] = (discoveredRes.detail ?? []).map((r: Json) => ({
        id: String(r.id), source: "discovered" as const, title: String(r.name),
        subtitle: `${(r.chains ?? []).join(", ")} · ${r.technique ?? "technique not stated"} · ${usd(r.amountUsd)} reported`,
        decision: String(r.decision), instrument: r.instrument ?? null, when: String(r.day),
        numbers: [
          { label: "reported loss", value: usd(r.amountUsd) },
          { label: "move that day", value: pct(r.market?.exploitDayMovePct) },
          { label: "receipt", value: r.hasReceipt ? "attached" : "not captured" },
          { label: "loss path", value: r.exposureQuantified ? "measured" : "not measured" },
        ],
        falsification: (r.assessment?.falsification ?? []) as Falsifier[],
        ai: (r.ai ?? null) as Ai,
        note: String(r.reason ?? ""),
        sizing: r.sizing ?? null,
        extra: [
          ...((r.exposures ?? []) as Json[]).map((e) => ({ label: `${e.symbol} (${String(e.kind).toLowerCase()})`, value: String(e.relation) })),
          ...(r.microstructure ? [
            { label: "spread", value: `${r.microstructure.spreadBps} bps` },
            { label: "depth within 1%", value: usd(r.microstructure.bidDepthUsd1pct) },
            { label: "funding", value: String(r.microstructure.fundingRate) },
          ] : []),
          { label: "next step", value: String(r.nextStep ?? "") },
        ],
        links: [{ label: "source record hash", href: `https://github.com/jenzylove/wake/blob/main/data/discovered/${r.id}.json` }],
      }))

      const blind: Item[] = ((stateRes.blind?.incidents ?? []) as Json[]).map((r) => ({
        id: String(r.id), source: "blind" as const,
        title: `${r.target ?? "unregistered contract"}${r.authorised ? " (authorised sweep)" : ""}`,
        subtitle: `blind run ${r.runId} · detected in ${(Number(r.latencyMs) / 1000).toFixed(1)}s · ${r.authorised ? "decoy" : "exploit"}`,
        decision: String(r.decision), instrument: r.instrument ?? null, when: String(r.detectedAt),
        numbers: [
          { label: "loss measured", value: usd(r.lossUsd) },
          { label: "modeled", value: pct(r.modeledDeltaPct) },
          { label: "already priced", value: pct(r.marketDeltaPct) },
          { label: "confidence", value: `${r.confidence}%` },
        ],
        falsification: [],
        ai: (r.ai ?? null) as Ai,
        note: r.authorised
          ? "The outflow was signed by the contract owner, so this is a treasury operation, not an exploit. WAKE dismissed it."
          : `Loss path measured on chain. ${r.integrators} contract holder${r.integrators === 1 ? "" : "s"} of the damaged token checked for downstream exposure.`,
        extra: [{ label: "victim", value: String(r.victim) }, { label: "exposure type", value: String(r.kind ?? "none") }, { label: "gate", value: r.gatePassed ? "cleared" : "held" }],
      }))

      const items = [...captured, ...discovered, ...blind]
      setData({ items, state: stateRes as unknown as State, error: null })
    } catch (error) {
      setData((d) => ({ ...d, error: error instanceof Error ? error.message : "load failed" }))
    }
  }, [])

  React.useEffect(() => {
    load()
    const timer = setInterval(load, 60_000)
    return () => clearInterval(timer)
  }, [load])

  return data
}

// Live marks for the instruments the agent is holding, so open positions show a real number
// rather than their entry price. Public Bitget data, refreshed every 30 seconds.
function useMarks(symbols: string[]) {
  const [marks, setMarks] = React.useState<Record<string, number>>({})
  const key = symbols.join(",")
  React.useEffect(() => {
    let cancelled = false
    const load = async () => {
      const list = key ? key.split(",") : []
      const pairs = await Promise.all(list.map(async (symbol) => {
        try {
          const r = await fetch(`/api/market/ticker?symbol=${symbol}`).then((x) => x.json() as Promise<Json>)
          return [symbol, Number(r.markPrice)] as const
        } catch { return [symbol, NaN] as const }
      }))
      if (!cancelled) setMarks(Object.fromEntries(pairs.filter(([, v]) => Number.isFinite(v))))
    }
    load()
    const timer = setInterval(load, 30_000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [key])
  return marks
}

const STAGES = [
  { key: "watch", word: "Watch", lead: "Every two hours WAKE reads the public exploit feed, keeps anything material and recent, and opens an investigation. No human files the incident." },
  { key: "investigate", word: "Investigate", lead: "It pulls the transaction, reads the token flows, names the contract that lost value and finds who else holds the damaged asset. Claude explains the mechanism and may veto." },
  { key: "price", word: "Price", lead: "The measured loss becomes a modeled move, set against what the market has already done. Most incidents are already priced, and that is a refusal." },
  { key: "act", word: "Act", lead: "Only if the gap survives every check does WAKE size the position from the capture, place a Bitget Demo order itself, and manage it to a stop, a changed thesis or a time stop." },
] as const

export default function Console() {
  const { items, state, error } = useConsoleData()
  const [filter, setFilter] = React.useState<"all" | Source>("all")
  const [selected, setSelected] = React.useState<string | null>(null)

  const shown = React.useMemo(
    () => items.filter((i) => filter === "all" || i.source === filter).sort((a, b) => (a.when < b.when ? 1 : -1)),
    [items, filter],
  )
  const current = shown.find((i) => i.id === selected) ?? shown[0] ?? null
  const [stage, setStage] = React.useState(0)
  React.useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const timer = setInterval(() => setStage((current) => (current + 1) % STAGES.length), 5200)
    return () => clearInterval(timer)
  }, [])

  const openPositions = React.useMemo(() => (state.positions?.open ?? []) as Json[], [state.positions])
  const marks = useMarks(React.useMemo(() => [...new Set(openPositions.map((p) => String(p.instrument)))], [openPositions]))
  // Decision mix across everything the agent has seen. Refusals are the majority by design.
  const mix = React.useMemo(() => {
    const trade = items.filter((i) => i.decision.startsWith("TRADE") || i.decision === "HEDGE").length
    const monitor = items.filter((i) => i.decision === "MONITOR").length
    const noTrade = items.filter((i) => i.decision === "NO_TRADE").length
    const total = Math.max(1, trade + monitor + noTrade)
    return { trade, monitor, noTrade, tradePct: (trade / total) * 100, monitorPct: (monitor / total) * 100, noTradePct: (noTrade / total) * 100 }
  }, [items])
  const latestAi = React.useMemo(() => items.find((i) => i.ai)?.ai ?? null, [items])
  const disc = ((state as Json).discovery?.lastRun ?? {}) as Json
  const logEntries = (state as Json).logEntries ?? "--"
  const agent = state.agent
  const blind = state.blind
  const live = agent?.mode === "bitget-demo"

  return (
    <div className="wkc">
      <header className="wkc-top">
        <span className="wkc-mark">WAKE<span>.</span></span>
        <span className="wkc-tag">autonomous incident trader · Bitget Demo only</span>
        <div className="wkc-top-right">
          <span className="wkc-live"><span className={`wkc-dot${live ? "" : " is-idle"}`} />{live ? "agent live" : "agent idle"} · tick {ago(agent?.updatedAt)}</span>
          <a className="wkc-link" href="/classic">evidence view</a>
          <a className="wkc-link" href="https://github.com/jenzylove/wake">repository</a>
        </div>
      </header>

      <section className="wkc-hero" aria-labelledby="wkc-title">
        <div className="wkc-stage">
          <ExposureField className="wkc-field" />

          <div className="wkc-float wkc-float-tl">
            <span className={live ? "wkc-pulse" : "wkc-dot is-idle"} />
            <span style={{ fontFamily: "var(--mono)", fontSize: 11 }}>
              {live ? "watching" : "idle"} · {agent?.incidentsEvaluated ?? "--"} incidents · tick {ago(agent?.updatedAt)}
            </span>
          </div>

          <div className="wkc-float wkc-float-br">
            <h3>The hit is obvious. The path is not.</h3>
            <p>
              A protocol is drained. WAKE traces who holds the damaged asset, prices what they lose, and asks whether the market
              has already moved. Most of the time it has, and WAKE holds.
            </p>
          </div>

          <div className="wkc-hero-head">
            <div className="wkc-eyebrow">
              <span className={live ? "is-live" : ""}>{live ? "live on bitget demo" : "paper"}</span>
              <span>event driven agent</span>
            </div>
            <h1 id="wkc-title">Who pays<br />for the <em>hack?</em></h1>
          </div>

          <a className="wkc-cta" href="#desk">Open the desk <i>↓</i></a>
        </div>
      </section>

      <section className="wkc-head">
        <p>
          WAKE watches for security incidents, works out which asset actually absorbs the loss, checks whether the market has
          already priced it, and trades the gap on Bitget with a size it computes itself. It abstains far more often than it trades,
          and every decision below, including the refusals, was produced by the scheduled agent and committed to the repository.
        </p>
        <dl className="wkc-proof">
          <div><dt>incidents evaluated</dt><dd>{agent?.incidentsEvaluated ?? "--"}</dd></div>
          <div><dt>eligible to trade now</dt><dd>{agent?.eligibleNow ?? "--"}</dd></div>
          <div><dt>demo positions open</dt><dd>{agent?.open ?? "--"}</dd></div>
          <div><dt>blind exploits detected</dt><dd>{blind ? `${blind.detected}/${blind.runs}` : "--"}<small>median {blind?.medianDetectionMs ? `${(blind.medianDetectionMs / 1000).toFixed(1)}s` : "n/a"}</small></dd></div>
          <div><dt>decoys dismissed</dt><dd>{blind ? `${blind.decoysDismissed}/${blind.runs}` : "--"}</dd></div>
          <div><dt>false positives</dt><dd>{blind?.falsePositives ?? "--"}</dd></div>
        </dl>
      </section>

      <div className="wkc-desk" id="desk">
        <div className="wkc-col">
          <div className="wkc-colhead"><h2>Incident queue</h2><span className="wkc-count">{shown.length}</span></div>
          <div className="wkc-filters">
            {(["all", "captured", "discovered", "blind"] as const).map((key) => (
              <button key={key} aria-pressed={filter === key} onClick={() => { setFilter(key); setSelected(null) }}>
                {key === "captured" ? "real captures" : key === "blind" ? "blind tests" : key}
              </button>
            ))}
          </div>
          <div className="wkc-queue">
            {shown.length === 0 && <div className="wkc-empty">{error ? `Could not load: ${error}` : "Loading the agent's queue."}</div>}
            {shown.map((item) => (
              <button key={item.id} className="wkc-row" aria-current={current?.id === item.id} onClick={() => setSelected(item.id)}>
                <div className="wkc-row-top">
                  <span className={`wkc-chip ${tone(item.decision)}`}>{item.decision.replace("TRADE_", "").toLowerCase()}</span>
                  <span className="wkc-src">{item.source}</span>
                </div>
                <div className="wkc-row-title">{item.title}</div>
                <div className="wkc-row-meta">
                  <span>{item.instrument ?? "no instrument"}</span>
                  <span>{item.when.length > 12 ? ago(item.when) : item.when}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="wkc-col">
          <div className="wkc-colhead"><h2>Decision</h2>{current && <span className={`wkc-chip ${tone(current.decision)}`}>{current.decision.toLowerCase().replace("_", " ")}</span>}</div>
          {!current && <div className="wkc-empty">Select an incident.</div>}
          {current && (
            <div className="wkc-detail">
              <h3>{current.title}</h3>
              <p className="wkc-sub">{current.subtitle}</p>

              <div className="wkc-block">
                <header><h4>What the numbers say</h4></header>
                <div className="wkc-grid">
                  {current.numbers.map((n) => (
                    <dl className="wkc-kv" key={n.label}><dt>{n.label}</dt><dd>{n.value}</dd></dl>
                  ))}
                </div>
              </div>

              {current.note && (
                <div className="wkc-block">
                  <header><h4>Why</h4></header>
                  <div><p className="wkc-note">{current.note}</p></div>
                </div>
              )}

              {current.ai && (
                <div className="wkc-block">
                  <header>
                    <h4>Investigator</h4>
                    <span className={`wkc-chip ${current.ai.veto ? "is-stop" : "is-cool"}`}>{current.ai.veto ? "vetoed" : current.ai.exploitClass}</span>
                  </header>
                  <div className="wkc-ai">
                    {current.ai.narrative && <p>{current.ai.narrative}</p>}
                    {current.ai.lossBearer && <p className="wkc-note">Loss bearer: {current.ai.lossBearer}</p>}
                    {current.ai.concerns && current.ai.concerns.length > 0 && (
                      <ul>{current.ai.concerns.map((c) => <li key={c}>{c}</li>)}</ul>
                    )}
                  </div>
                </div>
              )}

              {current.falsification.length > 0 && (
                <div className="wkc-block">
                  <header><h4>Challenges that must fail before a trade</h4></header>
                  <div>
                    <ul className="wkc-ladder">
                      {current.falsification.map((f, i) => (
                        <li key={f.key ?? i}>
                          <span className={`wkc-chip ${f.blocksTrade ? "is-stop" : "is-trade"}`}>{f.blocksTrade ? "blocking" : "cleared"}</span>
                          <span className="q">{f.question}{f.answer ? ` — ${f.answer}` : ""}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {current.sizing && (
                <div className="wkc-block">
                  <header><h4>Size, computed from the capture</h4></header>
                  <div className="wkc-grid">
                    <dl className="wkc-kv"><dt>notional</dt><dd>{usd(current.sizing.notionalUsd)}</dd></dl>
                    <dl className="wkc-kv"><dt>max loss at stop</dt><dd>{usd(current.sizing.maxLossUsd)}</dd></dl>
                    <dl className="wkc-kv"><dt>stop</dt><dd>{current.sizing.stopPct ? `${(current.sizing.stopPct * 100).toFixed(1)}%` : "n/a"}</dd></dl>
                    <dl className="wkc-kv"><dt>bound by</dt><dd>{current.sizing.bindingConstraint ?? "n/a"}</dd></dl>
                  </div>
                </div>
              )}

              {current.extra && current.extra.length > 0 && (
                <div className="wkc-block">
                  <header><h4>Evidence and exposure</h4></header>
                  <div>
                    <table className="wkc-table">
                      <tbody>
                        {current.extra.filter((e) => e.value).map((e) => (
                          <tr key={e.label}><td>{e.label}</td><td className="num">{e.value}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {current.links && current.links.map((l) => (
                <a className="wkc-link" key={l.href} href={l.href} target="_blank" rel="noreferrer">{l.label}</a>
              ))}
            </div>
          )}
        </div>

        <div className="wkc-col wkc-rail">
          <div className="wkc-colhead"><h2>Demo positions</h2><span className="wkc-count">{state.positions?.open.length ?? 0}</span></div>
          {(state.positions?.open ?? []).length === 0 && <div className="wkc-empty">No position open. The agent holds unless an incident clears every check.</div>}
          {openPositions.map((p) => {
            const mark = marks[String(p.instrument)]
            const move = Number.isFinite(mark) ? (mark / Number(p.entryPrice) - 1) * (p.side === "LONG" ? 1 : -1) : null
            const pnl = move === null ? null : move * Number(p.notionalUsd)
            return (
              <div className="wkc-pos" key={String(p.incidentId)}>
                <div className="wkc-pos-top">
                  <span className="is-trade">{String(p.side)}</span>
                  <strong>{String(p.instrument)}</strong>
                  <span className={`wkc-count ${pnl === null ? "" : pnl >= 0 ? "is-trade" : "is-stop"}`}>
                    {pnl === null ? "--" : `${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} USDT`}
                  </span>
                </div>
                <div className="wkc-pos-meta">
                  {String(p.size)} @ {String(p.entryPrice)} · mark {Number.isFinite(mark) ? mark : "--"} · {move === null ? "" : pct(move * 100)}
                </div>
                <div className="wkc-pos-meta">opened {ago(String(p.openedAt))} · order {String(p.orderId ?? "n/a")} · {String(p.source)} incident</div>
              </div>
            )
          })}
          {(state.positions?.closed ?? []).slice(-3).reverse().map((c) => (
            <div className="wkc-pos" key={String(c.incidentId) + String(c.closedAt)}>
              <div className="wkc-pos-top">
                <span className={Number(c.pnlUsd) >= 0 ? "is-trade" : "is-stop"}>closed</span>
                <strong>{String(c.instrument)}</strong>
                <span className="wkc-count">{usd(Number(c.pnlUsd), 2)}</span>
              </div>
              <div className="wkc-pos-meta">{String(c.exitReason)}</div>
            </div>
          ))}

          <div className="wkc-colhead" style={{ borderTop: "1px solid var(--line)" }}><h2>Decision log</h2><span className="wkc-count">{state.recentLog?.length ?? 0} of {(state as { logEntries?: number }).logEntries ?? 0}</span></div>
          <div className="wkc-log">
            {(() => {
              const seen = new Set<string>()
              return ((state.recentLog ?? []) as Json[])
                .filter((l) => {
                  // One line per distinct event, so a quiet hour does not fill the rail.
                  const key = `${l.event}|${l.incidentId ?? l.instrument ?? ""}|${l.decision ?? l.reason ?? ""}`
                  if (seen.has(key)) return false
                  seen.add(key)
                  return true
                })
                .slice(0, 26)
                .map((l, i) => (
                  <div key={`${String(l.at)}-${i}`} title={JSON.stringify(l)}>
                    <b className={l.event === "ENTRY" ? "is-trade" : String(l.event).includes("FAIL") ? "is-stop" : ""}>{String(l.event).toLowerCase()}</b>{" "}
                    {String(l.decision ?? l.instrument ?? l.incidentId ?? "")}{" "}
                    <span style={{ color: "var(--txt-3)" }}>{ago(String(l.at))}</span>
                  </div>
                ))
            })()}
          </div>
        </div>
      </div>

      <section className="wkc-section" aria-labelledby="wkc-why">
        <header>
          <h2 id="wkc-why">Most incidents are <em>not</em> a trade</h2>
          <p>That is the product. Anyone can short a hacked token. The work is knowing when the move has already happened, and refusing the rest.</p>
        </header>
        <div className="wkc-bento">
          <article className="is-wide">
            <h3>What it decided across every incident it has seen</h3>
            <p>Real captures, feed discoveries and blind tests, counted together. Refusals are the majority and always will be.</p>
            <div className="wkc-figure">
              <div className="wkc-bar">
                <span style={{ width: `${mix.tradePct}%`, background: "var(--trade)" }} />
                <span style={{ width: `${mix.monitorPct}%`, background: "var(--hold)" }} />
                <span style={{ width: `${mix.noTradePct}%`, background: "var(--stop)" }} />
              </div>
              <div className="wkc-legend">
                <span><i className="wkc-swatch" style={{ background: "var(--trade)" }} /><b>{mix.trade}</b> cleared to trade</span>
                <span><i className="wkc-swatch" style={{ background: "var(--hold)" }} /><b>{mix.monitor}</b> still investigating</span>
                <span><i className="wkc-swatch" style={{ background: "var(--stop)" }} /><b>{mix.noTrade}</b> refused</span>
              </div>
            </div>
          </article>

          <article>
            <h3>Proved on exploits it could not have memorised</h3>
            <p>Contracts deployed after WAKE starts watching, attacked at a random moment, with the answer sealed beforehand.</p>
            <div className="wkc-figure">
              <div className="wkc-big">{blind ? `${blind.detected}/${blind.runs}` : "--"}<small>detected</small></div>
              <div className="wkc-legend">
                <span><b>{blind?.falsePositives ?? "--"}</b> false positives</span>
                <span><b>{blind?.decoysDismissed ?? "--"}</b> decoys dismissed</span>
              </div>
            </div>
          </article>

          <article>
            <h3>Sized from the capture, not a guess</h3>
            <p>A stop at two observed sigmas, fees and spread priced in, bounded by a risk budget, by a share of real traded value, and by the venue cap.</p>
            <div className="wkc-figure wkc-pills">
              <span>observed volatility</span><span>traded value</span><span>spread estimate</span><span>venue cap</span>
            </div>
          </article>

          <article>
            <h3>Claude reads the evidence. Code moves the money.</h3>
            <p>The investigator names the mechanism and who bears the loss, and can veto a trade. It can never create one, change a number or choose a size.</p>
            <div className="wkc-figure wkc-pills">
              <span className="on">may veto</span><span className="off">may not trade</span><span className="off">may not size</span>
            </div>
          </article>

          <article>
            <h3>Every decision is committed before you read it</h3>
            <p>Each evaluation, order and exit lands in a hash chained log written by the scheduled run. Editing any past entry breaks the chain.</p>
            <div className="wkc-figure">
              <div className="wkc-big">{logEntries}<small>log entries</small></div>
            </div>
          </article>
        </div>
      </section>

      <section className="wkc-section" aria-labelledby="wkc-how">
        <header>
          <h2 id="wkc-how">One loop, four moves</h2>
          <p>The same loop runs whether the incident arrived from the feed, from a capture, or from a blind test.</p>
        </header>
        <div className="wkc-stages">
          <div className="wkc-stage-art">
            <h4>{STAGES[stage].key} · live</h4>
            {stage === 0 && (
              <>
                <div className="wkc-artcard"><div className="k">exploit feed</div><div className="v">{String(disc.feedRecords ?? "--")} records scanned</div></div>
                <div className="wkc-artrow"><span>material and recent</span><b>{String(disc.inWindow ?? "--")}</b></div>
                <div className="wkc-artrow"><span>investigations open</span><b>{items.filter((i) => i.source === "discovered" && i.decision === "MONITOR").length}</b></div>
                <div className="wkc-artrow"><span>last pass</span><b>{ago(state.discovery?.updatedAt)}</b></div>
              </>
            )}
            {stage === 1 && (
              <>
                <div className="wkc-artcard">
                  <div className="k">latest investigator note</div>
                  <div className="v" style={{ fontSize: 13, lineHeight: 1.55 }}>{latestAi?.narrative ? `${latestAi.narrative.slice(0, 230)}…` : "No review recorded yet."}</div>
                </div>
                <div className="wkc-artrow"><span>mechanism</span><b>{latestAi?.exploitClass ?? "--"}</b></div>
                <div className="wkc-artrow"><span>loss bearer</span><b>{latestAi?.lossBearer?.slice(0, 40) ?? "--"}</b></div>
                <div className="wkc-artrow"><span>veto</span><b>{latestAi ? (latestAi.veto ? "yes" : "no") : "--"}</b></div>
              </>
            )}
            {stage === 2 && (
              <>
                <div className="wkc-artcard"><div className="k">{current?.title ?? "incident"}</div><div className="v">{current?.decision.toLowerCase().replace("_", " ") ?? "--"}</div></div>
                {(current?.numbers ?? []).map((n) => (
                  <div className="wkc-artrow" key={n.label}><span>{n.label}</span><b>{n.value}</b></div>
                ))}
              </>
            )}
            {stage === 3 && (
              <>
                <div className="wkc-artcard"><div className="k">open demo positions</div><div className="v">{openPositions.length} · $100 cap each</div></div>
                {openPositions.slice(0, 3).map((p) => (
                  <div className="wkc-artrow" key={String(p.incidentId)}>
                    <span>{String(p.side)} {String(p.instrument)}</span><b>order {String(p.orderId ?? "n/a")}</b>
                  </div>
                ))}
                {openPositions.length === 0 && <div className="wkc-artrow"><span>nothing open</span><b>holding</b></div>}
              </>
            )}
          </div>

          <div>
            <ol className="wkc-steps">
              {STAGES.map((item, i) => (
                <li key={item.key} data-on={i === stage}>
                  <button onClick={() => setStage(i)} aria-current={i === stage}>{i === stage ? <em>{item.word}</em> : item.word}</button>
                  {i === stage && <p>{item.lead}</p>}
                </li>
              ))}
            </ol>
            <div className="wkc-progress"><span style={{ width: `${((stage + 1) / STAGES.length) * 100}%` }} /></div>
          </div>
        </div>
      </section>

      <section className="wkc-section" aria-labelledby="wkc-close">
        <div className="wkc-close">
          <div className="wkc-close-grid">
            <div><div className="k">incidents evaluated</div><div className="v">{agent?.incidentsEvaluated ?? "--"}</div></div>
            <div><div className="k">refused or still open</div><div className="v">{mix.noTrade + mix.monitor}</div></div>
            <div><div className="k">demo orders placed</div><div className="v">{(agent?.open ?? 0) + (agent?.closedTrades ?? 0)}</div></div>
            <div><div className="k">median detection</div><div className="v">{blind?.medianDetectionMs ? `${(blind.medianDetectionMs / 1000).toFixed(1)}s` : "--"}</div></div>
          </div>
          <h2 id="wkc-close">See what it <em>refused</em> today</h2>
          <a className="wkc-cta" href="#desk">Open the desk <i>↓</i></a>
        </div>
      </section>

      <footer className="wkc-footer">
        <div className="wkc-footer-grid">
          <div>
            <span className="wkc-mark">WAKE<span>.</span></span>
            <p style={{ marginTop: 12 }}>
              An autonomous incident trader built for the Bitget AI Genesis hackathon, Agentic Trading track. Paper only: every order is
              a Bitget Demo order capped at $100 of notional, and the exchange keys never leave the server.
            </p>
          </div>
          <div>
            <h5>Surfaces</h5>
            <ul>
              <li><a href="#desk">The desk</a></li>
              <li><a href="/classic">Evidence and replay</a></li>
              <li><a href="/api/incidents">/api/incidents</a></li>
              <li><a href="/api/discovered">/api/discovered</a></li>
              <li><a href="/api/agent/state">/api/agent/state</a></li>
            </ul>
          </div>
          <div>
            <h5>Verify</h5>
            <ul>
              <li><code>npm test</code></li>
              <li><code>npm run data:verify</code></li>
              <li><code>npm run blind:run</code></li>
              <li><code>npm run agent:tick</code></li>
            </ul>
          </div>
          <div>
            <h5>Source</h5>
            <ul>
              <li><a href="https://github.com/jenzylove/wake">Repository</a></li>
              <li><a href="https://github.com/jenzylove/wake/tree/main/data/wake-paper">Paper log</a></li>
              <li><a href="https://github.com/jenzylove/wake/tree/main/data/blind">Blind runs</a></li>
              <li><a href="https://github.com/jenzylove/wake/tree/main/data/discovered">Discovered incidents</a></li>
            </ul>
          </div>
        </div>
        <div className="wkc-footer-bar">
          <span>no live trading · paptrading 1 on every signed request</span>
          <span>blind test incidents are labelled and never blended with real performance</span>
          <span className="sep">agent tick {ago(agent?.updatedAt)}</span>
        </div>
      </footer>
    </div>
  )
}
