# WAKE

WAKE is an evidence-first causal market-response system for the Bitget hackathon. It turns a confirmed on-chain incident into an explicit ActionGraph, challenges the proposed causal path, and records a bounded trade, monitor, hedge, or abstention decision with exportable evidence.

The repository is paper-only by default. It does not support Bitget live trading.

## What is real today

- Three timestamped capture packets: Moonwell/Base, the AFX/Arbitrum bridge outflow, and the AFX response transaction.
- Successful chain receipts and Bitget ETHUSDT mark-candle windows preserved with SHA-256 integrity hashes.
- Incident-specific ActionGraph edges with source, evidence reference, confidence, magnitude, and observed/inferred status.
- Deterministic decision and falsification policy. A blocking falsifier cannot display a trade recommendation.
- Local paper receipts tied to investigation runs.
- A server-only, decision-bound Bitget Demo adapter protected by an operator secret and an opening-notional cap.
- An optional Anthropic evidence reviewer. Its labels cannot change deterministic numbers, the risk gate, or execution.

- Autonomous incident discovery. Every two hours a GitHub Actions workflow reads the DefiLlama exploit feed, opens an incident for each new exploit of at least $250k, maps it to a Bitget perpetual (protocol token first, chain token second, always marked inferred), captures the hourly market window, and records live spread, depth within 1%, funding and open interest. Open incidents are re checked every run and retired after 21 days without a receipt. See `data/discovered/` and `GET /api/discovered`.
- An append only, hash chained decision log (`data/discovered/log.jsonl`). `npm run data:verify` replays the chain, and editing any past entry breaks it.
- Position size and max loss computed from each capture (`lib/sizing.mjs`): stop at two window sigmas, fees plus a Corwin Schultz spread estimate, bounded by a 0.5% risk budget, 0.5% participation of traded value, and the venue cap. Every input is labelled observed, estimated or assumed.
- Execution eligibility: only a real capture with computed numbers, a trade decision, a passing gate and a computed size can open a Demo order, and the server sets the size. Replay fixtures can never open orders.

Consequence magnitudes use the square root impact law over observed volatility and traded value, with conversion scenarios stated as assumptions. Discovered incidents hold at MONITOR: the exploit feed publishes no transaction hashes, so escalation needs `node scripts/attach-receipt.mjs <id> <chainId> <txHash>`, which only attaches a receipt fetched from the chain. As of 19 September 2026 no real incident has cleared the gate, so there is no strategy origin Demo order yet; the NO_TRADE and MONITOR decisions are the honest record. See [`AUDIT_2026-09-16.md`](./AUDIT_2026-09-16.md).

## The console

The site is a desk, not a brochure. `/` shows what the agent is doing right now: the incident queue across real captures, feed discoveries and blind runs, the decision and the challenges behind it, the Claude write up, the size WAKE computed, its open Bitget Demo positions with live unrealised profit, and the tail of the decision log. It reads three routes, all served from committed data: `GET /api/incidents`, `GET /api/discovered`, `GET /api/agent/state`. The earlier evidence and replay surface is still available at `/classic`.

## The agent loop and its paper log

Every hour `.github/workflows/discover.yml` discovers new incidents, then runs one agent tick (`scripts/wake-agent.mjs`). The tick evaluates every incident WAKE knows about (captured, discovered and blind test), applies `lib/agent-policy.mjs`, opens a Bitget Demo position for anything eligible at WAKE's computed size (capped at $100), and closes positions on their stop, on a changed decision, or after 72 hours. The exchange keys never reach the runner: orders go through `POST /api/agent/execute` on the deployment, which enforces Demo mode, the notional cap and venue minimums, and accepts only the scheduler token.

WAKE's paper log is `data/wake-paper/log.jsonl` (hash chained, replayed by `npm run data:verify`) with totals in `data/wake-paper/metrics.json`. The older `data/paper/` log belongs to a separate delta neutral basis engine and is not WAKE's incident strategy.

## How a real incident escalates

Discovery opens an investigation from a feed entry, and that is all a feed entry can do. Two measurements move it further, in order:

1. `node scripts/attach-receipt.mjs <id> <chainId> <txHash>` fetches the exploit transaction from the chain and attaches it only if it exists and succeeded.
2. `node scripts/quantify-exposure.mjs <chainId> <txHash> <id>` reads what that transaction did (`lib/onchain-exposure.mjs`): the token flows from the receipt logs, priced through DefiLlama, the contract that lost the most value, and, when that contract issues its own token, which other contracts hold it and what the holding was worth before and after. No protocol ABI is assumed, so a protocol WAKE has never seen still measures. With no explorer key it finds holders from the node's own Transfer logs.

Only with both measurements can a modeled move exist, and only when the exposed protocol has a market capitalisation to measure the loss against. Contagion through a chain token has none, so it holds at MONITOR. `tests/discovery-escalation.test.mjs` pins each rung of that ladder, including that a Claude veto stops a trade the numbers would otherwise take.

Measured against the captured incidents in this repository, the same code reads $24.1M of USDC leaving the Arbitrum contract and $989k on Base, straight from the receipts.

## Watching real chains

`scripts/watch-chain.mjs` runs every hour on Ethereum, Base and Arbitrum. It reads every block it has not yet seen, takes the transfers of major assets (USDC, USDT, DAI, WETH) worth $250,000 or more, and keeps only those where the sending contract ended the block holding less than 40% of what it held before. That is what a drain looks like from outside.

A big transfer is not a drain, and the first live runs proved it: a settlement contract on Base emptied itself five times in an hour, each time "losing" 100% of an identical $789,438. So two rules now reject flows that only look like losses. A contract that empties itself more than once in a pass is being refilled, and a contract whose balance an hour earlier was mostly empty was only forwarding funds. Incidents opened before a rule tightened are re-checked by `scripts/recheck-live.mjs`; anything that no longer qualifies is retracted, with the reason appended to the hash chained log rather than quietly deleted.

A confirmed drain goes through the same path as every other incident: the loss is measured from the receipt, matched to a protocol and a Bitget perpetual where one exists, reviewed by Claude, and decided by the policy. Most are refused, usually because the contract matches no listed protocol and there is no market to express the consequence in.

## What Claude does, and what it cannot do

WAKE follows one rule: AI determines meaning, code enforces money. After code has built the evidence packet (trace, authorisation, share backing, integrators, candidates, numbers), Claude (`lib/ai-interpret.mjs`) names the exploit mechanism, says who bears the loss, and writes the explanation a trader reads. It may veto a trade when the evidence does not support the loss path; the veto becomes a blocking falsifier and the policy holds. It cannot create a trade, change a number, choose an instrument or size a position, and a failed review changes nothing. Tests in `tests/ai-interpret.test.mjs` prove each of those limits. In blind runs Claude has classified every decoy as an authorised operation and vetoed it, and named the exploit class of the real attacks from the trace alone. Scheduled runs reach Claude through `POST /api/agent/interpret`, so the Anthropic key stays on the server.

## Blind exploit challenge

`npm run blind:build && npm run blind:run` starts an empty local chain, starts WAKE's watcher, and only then lets a red team deploy a randomized protocol set (random names, balances, vault classes, lending markets and borrowers). The red team publishes a registry and a SHA-256 commitment to its answer, then at a random moment runs an authorised decoy sweep and a real exploit from one of three vulnerability classes. WAKE sees only blocks, logs, traces and contract state. It reconstructs holdings from Transfer logs, flags the drain, checks authorisation, measures share backing before and after, finds lending markets holding the damaged receipt token and computes their bad debt from their own logs, then decides through the same policy, sizer and gate as every other incident. Because the contracts did not exist before the run, no model can have memorised the answer.

First 12 runs (19 September 2026): 12 of 12 exploits detected, 12 of 12 decoys dismissed, 4 of 4 contagion paths found, 12 of 12 trade targets correct, 0 false positives, median detection 2.9 seconds. The gate cleared 2; the rest were real exploits too small relative to market cap to clear the 1.2% edge, and WAKE held. One cleared trade executed on Bitget Demo: UNIUSDT short, order `1485315090898124800`. Scores are in `data/blind/runs.jsonl` (hash chained) and per run under `data/blind/runs/`.

The challenge now runs every three hours (`.github/workflows/blind.yml`), followed by an agent tick that executes any cleared trade on Demo. Blind trades are labelled `BLIND_TEST` everywhere, and `metrics.json` reports them separately from real incidents in `closedBySource`; the two are never blended. The chain event is synthetic; the Bitget instrument, price, candles and Demo order are real.

## Run and verify

```sh
npm install
npm run dev          # http://127.0.0.1:5173
```

The portable development server defaults to `http://127.0.0.1:5173`.

```sh
npm run lint
npm run typecheck
npm test
npm run data:verify
npm run build
npm run data:verify        # capture integrity and discovery log chain
npm run discover           # one discovery pass against the live feeds
npm run paper:tick         # one paper engine tick
npm run paper:calibrate    # threshold calibration against a ticker snapshot
```

`data:verify` checks packet schema, receipt success, transaction identity, candle ordering and OHLC invariants, incident-window alignment, and integrity hashes.

## Configuration

Copy `env.example` to `.env.local`. Never commit credentials.

Key boundaries:

- `CHAIN_RPC_URL` or `ETHERSCAN_API_KEY`: chain evidence capture.
- Public Bitget market data: no key required.
- `BITGET_API_KEY`, `BITGET_SECRET_KEY`, `BITGET_PASSPHRASE`: Demo Trading only, always sent with `paptrading: 1`.
- `WAKE_EXECUTION_MODE=bitget-demo`: explicit Demo-order opt-in; default is `paper`.
- `WAKE_OPERATOR_SECRET`: required for hosted Demo orders, observation writes, and the investigator unless public investigator access is explicitly enabled.
- `WAKE_MAX_DEMO_NOTIONAL_USDT`: opening-order hard cap; defaults to `100`.
- `WAKE_SCHEDULER_SECRET` or Vercel `CRON_SECRET`: required for hosted watcher runs.
- `BITGET_API_IP`: optional DNS workaround. Normal deployments resolve `api.bitget.com` directly.
- `BLOB_READ_WRITE_TOKEN`: optional private Vercel Blob persistence for runtime records.

`npm run bitget:verify` makes the smallest read-only Demo account request and never places an order. The separate smoke-test script is explicitly confirmed and is not part of normal builds or CI.

## API safety

- `POST /api/bitget/demo-order` accepts a known `incidentId`, derives symbol and side server-side, requires the deterministic decision and risk gate for opens, enforces Bitget contract limits, and applies the configured notional cap.
- `POST /api/position/observations` is operator-protected. The public UI keeps its 15-second mark observations in the browser session instead of allowing anonymous durable writes.
- `GET /api/watchers/run` fails closed on hosted deployments without a scheduler secret.
- `POST /api/investigator` is operator-protected unless `WAKE_PUBLIC_INVESTIGATOR=1` is deliberately set.

## Current product boundary

The captured queue holds three real incidents plus labelled replay fixtures. New incidents arrive through the discovery workflow; the watcher route reports the latest discovery run alongside its adapter checks. Vercel Hobby runs the included cron once daily; a shorter cadence requires an external scheduler or a different plan.

The full target is in [`WAKE_ACTIONGRAPH_PRD.md`](./WAKE_ACTIONGRAPH_PRD.md). The current severity audit and winning-path blockers are in [`AUDIT_2026-09-16.md`](./AUDIT_2026-09-16.md).
