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

export default function Console() {
  const { items, state, error } = useConsoleData()
  const [filter, setFilter] = React.useState<"all" | Source>("all")
  const [selected, setSelected] = React.useState<string | null>(null)

  const shown = React.useMemo(
    () => items.filter((i) => filter === "all" || i.source === filter).sort((a, b) => (a.when < b.when ? 1 : -1)),
    [items, filter],
  )
  const current = shown.find((i) => i.id === selected) ?? shown[0] ?? null
  const openPositions = React.useMemo(() => (state.positions?.open ?? []) as Json[], [state.positions])
  const marks = useMarks(React.useMemo(() => [...new Set(openPositions.map((p) => String(p.instrument)))], [openPositions]))
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

      <footer className="wkc-foot">
        <p>
          Paper only. Every order is a Bitget Demo order signed with <code>paptrading: 1</code>, capped at $100 of notional, and the
          exchange keys never leave the server. The agent runs hourly from GitHub Actions and commits its decision log, so the history
          of what it decided and when is in the repository rather than asserted here.
        </p>
        <p>
          Verify locally: <code>npm test</code>, <code>npm run data:verify</code> (replays the hash chained logs),
          <code> npm run blind:run</code> (a fresh randomized exploit against a watcher that starts blind).
          Blind test incidents are labelled and reported separately from real ones; they are never blended into one performance number.
        </p>
      </footer>
    </div>
  )
}
