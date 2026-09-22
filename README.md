# WAKE

WAKE watches blockchains for exploits and decides, with evidence, whether an exploit should move a market that can be traded. It detects the drain, reconstructs what happened from chain data alone, measures who bears the loss, and hands the whole packet to Claude. Claude makes the trading decision. Code can only refuse it. Anything that survives is placed on Bitget Demo Trading, and the result is read back from the exchange.

It is paper and Demo only. It does not support Bitget live trading.

## The rule: Claude decides, code refuses

Code builds the evidence (trace, authorisation, share backing, integrators, measured candidates, sizes). Claude (`lib/ai-decide.mjs`) then chooses one of `TRADE_DIRECT`, `TRADE_CONTAGION`, `NO_TRADE` or `MONITOR`, picks which measured candidate to trade, and states its conviction, thesis and what would invalidate it.

`enforce()` then checks the money. It refuses when the candidate does not exist, the action does not match the candidate, the instrument is not listed on Bitget Demo, the modeled edge is under 1.2%, the size cannot be computed, conviction is under 75, or the outflow was signed by the owner. A refusal lands on NO_TRADE. Code never swaps in a different trade, never raises a size and never trades when Claude did not ask to. With no model answer, nothing trades. The older rule based decision is still recorded beside Claude's for comparison. `tests/ai-decide.test.mjs` pins each of these limits.

## One command, end to end

```sh
npm run demo
```

This starts a fresh local chain, lets a red team deploy protocols nobody has seen and attack one at a random moment, then prints each step: detection latency, the exploit mechanism, the measured loss, Claude's decision and thesis, the checks code applied, and either a Bitget Demo order ID or the reason nothing was placed. It needs Foundry's `anvil`, and Demo keys in `.env.local` to place an order.

## Blind tests prove detection and reasoning, not edge

The blind challenge (`npm run blind:build && npm run blind:run`, hourly in `.github/workflows/blind.yml`) seals a SHA-256 commitment to its answer before the attack, so no model can have memorised it. Across 29 runs: 28 exploits detected, 29 of 29 decoys dismissed as authorised, 0 false positives, median detection about 4 seconds. Scores are in `data/blind/runs.jsonl`, hash chained.

What blind tests cannot prove is tradeable edge. The red team pairs each invented protocol with a real Bitget perpetual and an invented market cap. The earlier rule based policy accepted that pairing and cleared 5 trades. With Claude deciding, it refuses them, for the correct reason: a drain on a protocol that does not exist cannot move a real token's price. We treat that refusal as the result. Blind trades are never presented as performance.

## Watching real chains

`scripts/watch-chain.mjs` runs every hour on Ethereum, Base and Arbitrum. It reads every new block, takes transfers of USDC, USDT, DAI and WETH worth $250,000 or more, and keeps only those where the sending contract ended the block holding under 40% of what it held before.

A large transfer is not a drain, and the first live runs proved it: a settlement contract on Base emptied itself five times in an hour. So a contract that empties itself repeatedly is treated as refilled, and one that was mostly empty an hour earlier as a forwarder. Incidents opened before a rule tightened are re checked by `scripts/recheck-live.mjs` and retracted with the reason appended to the hash chained log. Eight real drains are currently open, all at MONITOR, because none matches a listed protocol with a market to express the consequence in.

The DefiLlama exploit feed is read every hour as a second source (`data/discovered/`). Feed entries publish no transaction hashes, so they hold at MONITOR until a receipt is attached with `node scripts/attach-receipt.mjs` and measured with `node scripts/quantify-exposure.mjs`.

## Supply to exchange: the everyday event class

Exploits are rare, so a watcher that only trades exploits almost never trades. The second live class is a holder moving a large block of a token onto an exchange, where it can be sold. `scripts/watch-supply.mjs` runs every hour on the four Ethereum tokens with a Bitget Demo perpetual: LINK, UNI, PEPE and SHIB.

- **Finding the deposit.** Exchanges sweep user deposit addresses into hot wallets, so a deposit is found from the sweep and traced one hop back to the wallet that funded the deposit address. Hot wallets come from a short list of publicly labelled addresses or are inferred from the chain (a plain wallet receiving these tokens from eight or more distinct senders in one pass); each record says which. Exchange to exchange movement is ignored.
- **Measuring it.** The modeled move is the square root impact of selling the whole block into the token's real daily volume across all venues. The depositor is profiled from chain state: contract or wallet, transaction count, share of its own balance sent, share of supply.
- **Deciding.** Claude judges whether this is supply that will be sold (team, treasury, unlock, fund or long held wallets) or not (market makers, custody, OTC settlement, wallets that deposit all day). Code refuses unless the modeled move, less what the market has already done, beats **three times the live round trip cost**: two taker fees plus the spread quoted on Bitget's book at that moment. That bar was fixed before any data was seen. A depositor already in a position is refused.

Replaying the 24 hours before launch (`node scripts/probe-supply.mjs 24`): 26 deposits of $500,000 or more, one of which cleared the bar, a $4.8M PEPE deposit to Coinbase. So this class is expected to trade about once a day, not constantly. Supply records carry `eventClass: "SUPPLY_TO_EXCHANGE"` and are reported apart from drains and blind tests.

## Trade record, verified by the exchange

Realised profit and loss is not computed by WAKE. After each close the agent reads Bitget's own position history (`/api/v2/mix/position/history-position`) and records the venue's net profit, including fees and funding, as `pnlUsd` with `pnlSource: "bitget"`. The value WAKE computed is kept beside it as `pnlComputedUsd`.

Every closed trade so far came from blind tests, before Claude made the decision:

| Instrument | Net per Bitget (USDT) |
|---|---|
| UNIUSDT short | -0.61 |
| ADAUSDT short | -0.75 |
| LTCUSDT short | -0.71 |

WAKE had computed these near +0.03. The gap came from pricing exits on mainnet marks while Demo orders fill on Bitget's separate Demo market; exits are now judged on the Demo mark. The account equity on the console is shared with RESIDUAL, a separate project on the same Demo account, and is labelled so.

## How execution stays honest

Every hour `.github/workflows/discover.yml` runs one agent tick (`scripts/wake-agent.mjs`). Exchange and Anthropic keys never reach the runner. Orders go through `POST /api/agent/execute`, which trusts nothing in the request:

- an opening order is placed only for an incident already in the published record, whose recorded decision is a trade that cleared, with matching instrument and side, detected within the last 6 hours;
- the instrument must be listed on Bitget Demo, checked before the incident is called tradeable and again at order time;
- the size may not exceed the record's own sizing or the $100 Demo cap;
- a closing order must match a position the record shows as open.

Refusals return a code (`UNPUBLISHED`, `NOT_ELIGIBLE`, `NOT_LISTED`, `OVERSIZE` and others) and are logged. Positions close on their stop, a changed decision, or after 18 hours. The agent log is `data/wake-paper/log.jsonl`, hash chained and replayed by `npm run data:verify`.

## Tokenized stocks: what exists and what does not

The rules for trading listed companies exist and are tested: an exploit whose loss lands on a listed company (for example a bridge operated by Coinbase) maps to that company's Bitget contract. COINUSDT, CRCLUSDT, MSTRUSDT and HOODUSDT are confirmed tradeable on Bitget Demo. No real incident so far has had a direct path to a listed company, so no stock trade exists, and we will not manufacture one. The working implementation today trades crypto perpetuals.

## The console

`/` shows what the agent is doing now: the trade record per Bitget, the incident queue across live chain, real captures, feed discoveries and blind tests, Claude's decision and code's refusals for each, open Demo positions, and the tail of the decision log. It reads committed data through `GET /api/incidents`, `GET /api/discovered` and `GET /api/agent/state`.

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
npm run build
npm run data:verify        # capture integrity and every hash chained log
npm run demo               # one continuous run, exploit to Demo order
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

## Current boundary

Few real trades will exist, by design: a real exploit has to hit a protocol with a Bitget market, carry a loss large enough to clear costs, and convince Claude. Most incidents end at MONITOR or NO_TRADE, and that record is the product working. The full target is in [`WAKE_ACTIONGRAPH_PRD.md`](./WAKE_ACTIONGRAPH_PRD.md).
