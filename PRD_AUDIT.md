# WAKE ActionGraph PRD audit

Audit date: 2026-09-13

This audit is against [`WAKE_ACTIONGRAPH_PRD.md`](./WAKE_ACTIONGRAPH_PRD.md), not against a generic SaaS checklist. The app is deliberately paper-only by default; a missing live observation is displayed as `n/a` instead of being filled with demo data.

## Product contract

| PRD requirement | Status | Evidence in build |
| --- | --- | --- |
| Event-to-economic-consequence thesis | Implemented | `lib/wake-engine.ts`, incident queue and ActionGraph |
| Six explicit action outcomes | Implemented | `TRADE_DIRECT`, `TRADE_CONTAGION`, `TRADE_RESOLUTION`, `HEDGE`, `MONITOR`, `NO_TRADE` |
| No alert-to-order shortcut | Implemented | Investigation run + deterministic risk gate are required before a paper order |
| No fabricated live evidence | Implemented | Real capture and replay fixture provenance are visible and exported |

## Core behavior

| PRD requirement | Status | Current boundary |
| --- | --- | --- |
| Extensible watcher coverage registry | Implemented | Registry is visible in the UI and exposed at `/api/watchers/coverage`; only Base/Moonwell receipt capture and Bitget public marks are validated |
| Universal Ethereum/Base/Arbitrum coverage | Intentionally not claimed | Ethereum and Arbitrum are shown as planned until validated resolvers are captured |
| ActionGraph node and edge metadata | Implemented | Nodes expose inferred types; edges carry relation, source, timestamp, direction, magnitude, evidence ref, confidence, and observed/inferred status |
| Deterministic numbers, AI interpretation boundary | Partial and explicit | Consequence ranges, residuals, and risk checks are deterministic; the current replay slice has no LLM investigator, so its interpretation is rule-backed and labeled rather than marketed as autonomous AI |
| Causal falsifier | Implemented | Six explicit checks cover collateral, debt cap, absorption, association, repricing, and invalidation evidence |
| Workflow state machine | Implemented for captured/replay records | State transitions are timestamped and exported; live watcher transitions are not yet running continuously |
| Bitget paper executor | Implemented | Local paper receipts are tied to an investigation run; Bitget Demo adapter is isolated and separately authenticated |
| Live monitor | Partial | Position surface polls Bitget public mark price every 15 seconds and calculates paper P&L when an entry mark exists; there is no hosted position scheduler yet |

## Required interface

| PRD surface | Status | Notes |
| --- | --- | --- |
| Incident queue | Implemented | Time, chain, state, event kind, risk, provenance, and position status are visible |
| ActionGraph + edge inspector | Implemented | Observed/inferred legend, node type, relationship, magnitude, and evidence reference are visible |
| Evidence packet | Implemented | JSON export includes capture hash, sources, graph, consequence assumptions, falsification, transitions, risk gate, orders, and replay runs |
| Decision card | Implemented | Outcome, instrument, side, loss bound, invalidation, catalyst horizon, consequence range, risk checks, and abstention reason are shown |
| Position monitor | Implemented with explicit data boundary | Entry, current price, unrealized P&L, thesis, exposure, exit condition, and latest observation are shown; unobserved live values remain `n/a` |
| Replay lab | Implemented | Runs persist separately from the paper ledger and do not mutate the original evidence snapshot or orders |

## Demo acceptance

| PRD requirement | Status | Notes |
| --- | --- | --- |
| Main demo is real, timestamped, replayable | Implemented | Moonwell/Base capture with preserved receipt, 60 Bitget ETHUSDT mark candles, and verified SHA-256 packet |
| Contagion trade case | Partial | The Aave/rsETH case exercises a paper trade, but is explicitly a replay fixture and needs a second real capture before being called historical |
| False causal link | Implemented | Moonwell capture correctly abstains because the ETH-specific residual edge is not proven |
| Resolution or invalidation case | Partial | The resolved treasury case exercises the path, but remains explicitly labeled as a replay fixture |
| Judge opens without credentials | Implemented | Hosted app is paper-only and does not receive private `.env.local` values |
| Reproducible calculations and evidence export | Implemented | `npm run data:verify` checks the included packet hash |

## Remaining work, in priority order

1. Capture two additional real incidents with source-backed protocol exposure: one that genuinely passes the contagion trade gate and one that supplies resolution/invalidation evidence.
2. Add a server-side watcher scheduler that consumes only the validated coverage registry and records new captures; do not label planned chains as live.
3. Add durable position-observation records so public mark polling survives refreshes and can be included in a time-series evidence packet.
4. Only after the paper flow is demonstrated should the explicitly authenticated Bitget Demo order route be exercised; no live trading route is supported.
