# WAKE ActionGraph PRD audit

Audit date: 2026-09-16

This is the compact line-by-line status against [`WAKE_ACTIONGRAPH_PRD.md`](./WAKE_ACTIONGRAPH_PRD.md). See [`AUDIT_2026-09-16.md`](./AUDIT_2026-09-16.md) for severity, judging impact, fixes, and the winning-path plan.

| PRD requirement | Status | Evidence / boundary |
| --- | --- | --- |
| Clear event-to-economic-consequence thesis | Implemented | The interface, data model, and exports are built around ActionGraph and a falsifiable causal path. |
| Six action outcomes | Implemented | Trade direct, trade contagion, trade resolution, hedge, monitor, and no-trade are represented. |
| No alert-to-order shortcut | Implemented | Investigation run, falsifier, risk gate, operator authorization, and incident binding precede Demo execution. |
| Observed versus inferred evidence | Implemented | Real captures have incident-specific edges with epistemic status and evidence references. |
| Extensible watcher coverage | Partial | Coverage registry and scheduled adapter pass exist; automatic incident discovery does not. |
| Universal chain coverage | Not claimed | Base/Moonwell and Arbitrum/AFX captures are validated; generic Ethereum/Arbitrum resolvers remain planned. |
| Deterministic consequence model | Partial | Scenario values are reproducible but not calibrated from market depth; the UI now labels this honestly. |
| AI interpretation boundary | Implemented | Anthropic output is schema-checked, must use the six supplied keys and packet evidence, and cannot change numeric gates or execution. |
| Causal falsifier | Implemented | A blocking falsifier now forces monitor/no-trade even if the numeric signal would otherwise trade. |
| State machine and logs | Implemented for replay | Timestamped transitions and runs are exported; discovery-driven transitions are not yet produced live. |
| Bitget paper execution | Partial | Local paper ledger works. Demo adapter is authenticated, capped, and incident-bound, but no strategy-origin Demo receipt is committed yet. |
| Market execution checks | Not complete | Captured mark candles preserve price, but volume is zero and spread, funding, open interest, and slippage are absent. |
| Live position monitor | Partial | Public mark polling works. Browser observations are session-only; protected server writes can be durable with Blob. |
| Evidence packet export | Implemented | Capture, graph, falsifier, transition, decision, risk gate, runs, orders, and observations are exportable. |
| Real main demo | Implemented as replay | Three genuine timestamped packets load without credentials and pass semantic plus hash verification. |
| Contagion case | Partial | The bridge outflow is observed; the downstream ETH conversion/exchange path remains inferred. |
| False-link abstention | Implemented | Moonwell correctly records no-trade because the ETH proxy edge is unproven. |
| Resolution case | Implemented as monitor | The response transaction is observed; a blocking recovery check prevents the previous contradictory long recommendation. |
| Runnable without credentials | Implemented | Public evidence and paper replay work without private keys. |
| Automated verification | Implemented | CI runs lint, typecheck, policy tests, semantic capture verification, and production build. |

## Definition-of-done verdict

WAKE is a credible, runnable evidence replay and causal-decision prototype. It is not yet a complete autonomous trading agent because discovery, calibrated market-impact/liquidity gating, and a strategy-origin Bitget Demo receipt remain unfinished.
