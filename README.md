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
