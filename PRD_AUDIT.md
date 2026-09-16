# WAKE ActionGraph PRD audit

Audit date: 15 September 2026. Supersedes the 13 September audit.

This is checked against [`WAKE_ACTIONGRAPH_PRD.md`](./WAKE_ACTIONGRAPH_PRD.md), not a generic checklist. The app is paper only by default, and a missing observation is shown as `n/a` rather than filled in.

## Corrections to the previous audit

The 13 September audit overclaimed in two places. Both are recorded here rather than quietly edited, because an audit that revises itself silently is worth nothing.

**It claimed deterministic, reproducible consequence numbers. That was not true.** `modeledDelta` was the literal `5.4` and `confidence` was the literal `88`, written into [`lib/wake-engine.ts`](./lib/wake-engine.ts) by hand. The residual that drove the decision was therefore a typed number minus an observed one. It is now computed from the capture packet; see Core behavior below.

**It claimed a working contagion trade case.** That trade only existed because of the literal above. With a computed model the AFX incident does not clear the gate, and the build no longer produces a tier 1 trade at all. The case is now an abstention, and it is a better demonstration than the trade was.

## Product contract

| PRD requirement | Status | Evidence in build |
| --- | --- | --- |
| Event to economic consequence thesis | Implemented | [`lib/wake-engine.ts`](./lib/wake-engine.ts), incident queue, ActionGraph |
| Six explicit action outcomes | Implemented | `TRADE_DIRECT`, `TRADE_CONTAGION`, `TRADE_RESOLUTION`, `HEDGE`, `MONITOR`, `NO_TRADE` |
| No alert to order shortcut | Implemented | An investigation run and the deterministic gate are both required before any order |
| No fabricated live evidence | Implemented | Capture and fixture provenance are visible and exported. Fixtures additionally carry `numbersProvenance: "AUTHORED_SCENARIO"` so their authored numbers cannot read as measurements |

## Core behavior

| PRD requirement | Status | Current boundary |
| --- | --- | --- |
| Extensible watcher coverage registry | Implemented | Visible in the interface and at `/api/watchers/coverage`. Base/Moonwell and Arbitrum/AFX receipt captures plus Bitget public marks are validated; Ethereum and the remaining Arbitrum resolvers are shown as planned |
| Universal Ethereum/Base/Arbitrum coverage | Intentionally not claimed | Planned coverage is never drawn as live |
| ActionGraph node and edge metadata | Implemented | Edges are declared per incident with relation, epistemic status, evidence reference, magnitude and a per edge confidence penalty. Previously a fixed five edge template that threw on any incident without exactly six nodes |
| Deterministic numbers, AI interpretation boundary | **Implemented, and this is the correction above** | Consequence uses the square root law `impact = Y · sigma · sqrt(Q / V)` in [`lib/consequence-model.ts`](./lib/consequence-model.ts). `sigma` and `V` are realised volatility and traded value over the event window, read from the capture. `Y` is a documented constant. `Q` decomposes into a proven gross outflow times an assumed conversion share that is swept from 10% to 100% rather than asserted. Confidence is `100 · (0.5 · observed evidence share + 0.5 · resolved falsification share)`. `/api/investigator` sends only evidence context to a server side Claude reviewer, validates the structured response, strips evidence references outside the allow list, and never accepts model numbers or execution instructions |
| Causal falsifier | Implemented | Six checks covering collateral, debt cap, absorption, association, repricing and invalidation evidence |
| Workflow state machine | Implemented for captured and replay records | Transitions are timestamped and exported. AFX now terminates at `NO_TRADE` with the gate reason recorded, not at `RISK_APPROVED` |
| Bitget paper executor | Implemented | Tier 1 writes local paper receipts tied to an investigation run. Tier 2 writes a server side ledger, below. The Bitget Demo adapter is isolated and separately authenticated |
| Live monitor | Implemented | Tier 2 marks the book to market every tick and commits. The tier 1 position surface polls the public mark and records server owned observations |

## Required interface

| PRD surface | Status | Notes |
| --- | --- | --- |
| Incident queue | Implemented | Time, chain, state, event kind, risk, provenance, position status |
| ActionGraph and edge inspector | Implemented | Observed and inferred legend, node type, relation, magnitude, evidence reference |
| Evidence packet | Implemented | JSON export carries capture hash, sources, graph, consequence assumptions and inputs, falsification, transitions, risk gate, orders, replay runs, server observations, and `numbersProvenance` |
| Decision card | Implemented | Outcome, instrument, side, loss bound, invalidation, catalyst horizon, consequence range, risk checks, abstention reason |
| Position monitor | Implemented with an explicit data boundary | Unobserved live values remain `n/a` |
| Replay lab | Implemented, and now more than replay | The old button re-derived identical numbers and could only return the verdict it already had. It is now a stress test over the two inputs that are not observed, the conversion share and the impact coefficient, with the gate recomputing live |

## Demo acceptance

| PRD requirement | Status | Notes |
| --- | --- | --- |
| Main demo is real, timestamped, replayable | Implemented | Three captures with preserved receipts, Bitget mark windows, traded liquidity windows and verified SHA-256 hashes. `npm run data:verify` |
| Contagion trade case | **Changed: it is now an abstention** | The path is traced and real. The model then refuses it: even at 100% conversion, modelled impact is 0.435% against a market that had already moved 0.424%, giving a residual of 0.011% against a 1.2% threshold, with computed confidence of 67 against a 75 floor. The PRD asked for a contagion trade. The evidence does not support one, so the build does not fabricate one |
| False causal link | Implemented | Moonwell abstains because the ETH specific residual edge is not proven |
| Resolution or invalidation case | Implemented as conditional | The AFX recovery response is captured. A recovery request moves no money, so there is no flow to model and the incident holds in `MONITOR` |
| Judge opens without credentials | Implemented | Hosted, public, paper only |
| Reproducible calculations and evidence export | Implemented | Capture hashes verify; `data/paper/metrics.json` is a pure function of the two logs beside it |

## Tier 2, an addition beyond the PRD

The PRD describes a causal incident agent. Incidents of that size are rare, and a paper log with one trade cannot produce a Sharpe ratio, which the track scores. Tier 2 was added for that reason and is labelled as a different claim everywhere it appears: delta neutral perpetual versus spot basis arbitrage on Bitget. It is microstructure, not contagion.

Its first version was falsified by its own log and replaced. It held one leg of a two leg idea, so although the basis converged in 8 of 10 trades, all 10 lost, with $7,444 of the loss from directional price movement against $432 of fees. It also suffered adverse selection: six of the nine instruments it traded have no spot listing, several being tokenised equity perpetuals whose index goes stale when the underlying market closes, so the apparent basis was the market pricing gap risk rather than a mispricing. Requiring a tradeable spot leg and holding both legs fixes both faults. The transition, attribution and the alternatives tested are recorded in `data/paper/config-changes.jsonl`.

Testing the fix against live books produced a further result worth stating plainly: **no delta neutral trade on Bitget clears taker costs in the submission window.** Gap arbitrage clears on 0 of 343 pairs at any volume floor, because wider gaps carry proportionally wider spreads. Funding carry is profitable on 0 of 76 liquid positive funding pairs over five days, because funding at 5 to 11 percent annualised earns 7 to 15 bps against 24 to 45 bps of round trip cost. The gate therefore refuses nearly everything, and on ticks where it opens nothing it records the edge distribution across the scanned universe so the refusal is quantified rather than merely counted.

| Property | Status |
| --- | --- |
| Runs live and commits its own log | `scripts/paper-tick.mjs` via `.github/workflows/paper-engine.yml`, committing to `data/paper/` after every tick. The commit history is the proof of liveness |
| Costs | Fees at the Bitget published taker rate, slippage from the observed spread plus a modelled overflow term, funding at the observed rate per 8h interval. No fill is assumed the book did not show |
| Calibration | Set from a live snapshot of 787 perpetuals before any results existed. A $10M daily volume floor leaves 52 instruments; round trip taker cost is about 12 bps plus spread, so triggers sit at that economic break even |
| Abstention is logged | A typical tick evaluates 52 instruments, a handful clear the trigger, and most of those are still refused. Refusals are written to `decisions.jsonl` with the full check list |
| Parameter changes are disclosed | `data/paper/config-changes.jsonl` records each change with before and after values and the reason, so the log can be split and the regimes judged separately |

## Remaining work, in priority order

1. Tier 1's paper ledger still lives in browser `localStorage`, so a judge opens it empty and nothing is verifiable server side. Tier 2's ledger is the model to follow.
2. ~~The Bitget Demo smoke test is asserted in prose with no artifact.~~ Done: the claim is withdrawn and both Demo scripts now write a redacted, hashed artifact to `data/bitget-demo/` on every run. That directory is empty in a fresh clone, which is the honest state until someone runs it with Demo credentials.
3. Watcher coverage is a validated registry and a scheduled mark pass, not resolver backed discovery. The route refuses to claim discovery it does not do, which is correct, but it is not yet a watcher in the PRD's sense.
4. Capture the full downstream AFX conversion trace so the market edge can move from inferred to observed. Until then the conversion share stays an assumption, which is what the stress test exposes.
5. Replay fixtures still carry authored numbers. They are tagged, but a build with only computed numbers would be stronger.
