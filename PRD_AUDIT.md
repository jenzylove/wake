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
| Extensible watcher coverage registry | Implemented | Registry is visible in the UI and exposed at `/api/watchers/coverage`; Base/Moonwell and Arbitrum/AFX receipt captures plus Bitget public marks are validated |
| Universal Ethereum/Base/Arbitrum coverage | Intentionally not claimed | Ethereum and Arbitrum are shown as planned until validated resolvers are captured |
| ActionGraph node and edge metadata | Implemented | Nodes expose inferred types; edges carry relation, source, timestamp, direction, magnitude, evidence ref, confidence, and observed/inferred status |
| Deterministic numbers, AI interpretation boundary | Implemented as an optional boundary | Consequence ranges, residuals, and risk checks stay deterministic; `/api/investigator` sends only the evidence context to a server-side Anthropic reviewer, validates its structured response, and never accepts AI numbers or execution instructions |
| Causal falsifier | Implemented | Six explicit checks cover collateral, debt cap, absorption, association, repricing, and invalidation evidence |
| Workflow state machine | Implemented for captured/replay records | State transitions are timestamped and exported; the hosted native watcher cadence is plan-limited to once daily on Vercel Hobby, while the route is ready for an external shorter-cadence scheduler |
| Bitget paper executor | Implemented | Local paper receipts are tied to an investigation run; Bitget Demo adapter is isolated and separately authenticated |
| Live monitor | Partial | Position surface polls Bitget public mark price every 15 seconds and sends server-owned observations; local append-only persistence works, but hosted Vercel history still needs a durable provider |

## Required interface

| PRD surface | Status | Notes |
| --- | --- | --- |
| Incident queue | Implemented | Time, chain, state, event kind, risk, provenance, and position status are visible |
| ActionGraph + edge inspector | Implemented | Observed/inferred legend, node type, relationship, magnitude, and evidence reference are visible |
| Evidence packet | Implemented | JSON export includes capture hash, sources, graph, consequence assumptions, falsification, transitions, risk gate, orders, replay runs, and server-owned position observations |
| Decision card | Implemented | Outcome, instrument, side, loss bound, invalidation, catalyst horizon, consequence range, risk checks, and abstention reason are shown |
| Position monitor | Implemented with explicit data boundary | Entry, current price, unrealized P&L, thesis, exposure, exit condition, and latest observation are shown; unobserved live values remain `n/a` |
| Replay lab | Implemented | Runs persist separately from the paper ledger and do not mutate the original evidence snapshot or orders |

## Demo acceptance

| PRD requirement | Status | Notes |
| --- | --- | --- |
| Main demo is real, timestamped, replayable | Implemented | Moonwell/Base capture with preserved receipt, 60 Bitget ETHUSDT mark candles, and verified SHA-256 packet |
| Contagion trade case | Implemented with a bounded real capture | AFX/Arbitrum has a verified receipt, decoded 24.15M USDC outflow, Bitget market window, explicit uncertainty, and a real contagion decision path; downstream conversion remains an inferred edge |
| False causal link | Implemented | Moonwell capture correctly abstains because the ETH-specific residual edge is not proven |
| Resolution or invalidation case | Implemented as conditional real evidence | AFX recovery-response transaction and post-response market window are captured; the UI correctly treats a recovery request as a signal, not proof that funds were recovered |
| Judge opens without credentials | Implemented | Hosted app is public, paper-only, and does not receive private `.env.local` values |
| Reproducible calculations and evidence export | Implemented | `npm run data:verify` checks the included packet hash |

## Remaining work, in priority order

1. Configure a durable hosted runtime store for watcher runs and position observations. The route, export field, and append-only interface exist; Vercel’s ephemeral filesystem must not be treated as history. Add a private Vercel Blob store and `BLOB_READ_WRITE_TOKEN` to make hosted history durable.
2. Extend the watcher worker from scheduled validated mark/receipt passes to resolver-backed discovery. The scheduler currently records its pass and refuses to claim automatic discovery for planned chains; Vercel Hobby also limits the native cron to once daily, so shorter cadence needs an external scheduler or a plan upgrade.
3. Capture the full downstream AFX conversion/freeze trace so the contagion edge can move from inferred to observed; the existing packet intentionally does not overclaim it.
4. Add follow-up recovery evidence for the AFX response case before changing its conditional monitor state.
5. Keep the authenticated Bitget Demo route explicitly opt-in. The minimum-size open/close smoke test passed in hedge mode; live trading remains unsupported.
