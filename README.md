# WAKE

**Causal market response for Bitget.** WAKE reads a confirmed on chain incident, maps who actually absorbs the damage, computes how large that damage is relative to real traded liquidity, and then decides whether a trade exists. Most of the time it decides one does not, and it shows its working either way.

- **Live demo:** https://bitget-lilac.vercel.app
- **Track:** Agentic Trading (event driven agent)
- **Execution:** paper only. There is no live trading path in this repository.

---

## The thing worth checking first

WAKE refuses its own flagship trade.

The 22 July AFX bridge drain moved $24.15M of USDC on Arbitrum. That is a real, verified receipt. The obvious move is to short ETH. WAKE does not, and the reason is arithmetic rather than caution:

| | |
| --- | --- |
| Gross outflow, proven by receipt | $24,150,000 |
| ETHUSDT traded value in the window, observed | $26.44M |
| Realised volatility in the window, observed | 0.455% |
| Modelled impact even if **100%** converted | **0.435%** |
| What the market had already moved | **0.424%** |
| Residual edge | **0.011%** against a 1.2% threshold |
| Computed causal confidence | **67** against a 75 threshold |

The contagion path is real and traced. The size of it is not. So the gate holds and no order is written.

An earlier version of this build carried `modeledDelta: 5.4` as a hand typed constant, which made that trade pass. Replacing the constant with a computed model is what killed the trade. That change is the honest centre of this submission.

---

## Two tiers, deliberately separated

WAKE makes two different kinds of claim and never blends them.

**Tier 1 · causal incident.** A real on chain event, a traced exposure graph, a falsification pass, and a decision. Incidents of the size this tier cares about are rare, so it produces very few trades. All three real captures currently abstain, each for a computed reason.

**Tier 2 · market dislocation.** A perpetual whose mark has pulled away from its own index is quoting a carry the funding mechanism exists to close. This tier fades that gap. It is microstructure, not contagion, and it is labelled as such everywhere it appears. It exists because a paper log with one trade cannot produce a Sharpe ratio.

Both tiers pass through the same risk gate and write to the same ledger. Every trade record carries its tier.

---

## The paper log

`data/paper/` is a live paper trading run. It is written by `scripts/paper-tick.mjs`, which runs from `.github/workflows/paper-engine.yml` and commits after every tick.

**The commit history is the evidence.** Each tick lands as its own timestamped commit from the Actions runner, so "this log was produced live during the competition window" is checkable with `git log` rather than asserted in a slide.

```sh
git log --oneline --grep="paper tick"
```

| File | Contents |
| --- | --- |
| `equity.jsonl` | One mark to market point per tick, plus that tick's scan summary |
| `trades.jsonl` | Append only. A record on open and another on close, carrying entry, exit, fees, funding, slippage and realised PnL |
| `decisions.jsonl` | Every candidate that cleared the dislocation trigger, **including the ones the gate refused**, with the full check list |
| `metrics.json` | Sharpe, max drawdown, win rate, profit factor, turnover, cost totals |

`metrics.json` is not privileged. It is a pure function of the two logs beside it, and `data/paper/README.md` has the command to recompute it yourself.

### Costs are modelled at the conservative end

This matters more than the headline numbers. Every figure is labelled observed, estimated or assumed:

- **Fees** at the Bitget published **taker** rate, not maker. Estimated.
- **Slippage** from the real quoted spread at decision time, plus a linear overflow term when the clip exceeds resting size. Observed.
- **Funding** at the observed rate, accrued per 8h interval. Observed.
- **No fill is assumed that the book did not show.**

Round trip taker cost is roughly 12 bps of fee plus the full spread. That is why the dislocation triggers sit where they do: calibrated against a live snapshot of 787 perpetuals, a basis trade only clears cost above roughly 25 bps. The triggers are set at that economic break even, not at a level that manufactures trades. A typical tick evaluates ~52 instruments and opens at most one.

---

## How a number gets to be a number

Nothing in the real captures is typed in.

**Consequence** uses the square root law, `impact = Y · sigma · sqrt(Q / V)`. `sigma` and `V` are realised volatility and traded value over the event window, read straight from the capture packet. `Y` is a documented constant. `Q` is the only judgement call, so it is decomposed: the receipt proves a gross outflow, it does not prove what share reached the instrument, and that share is swept from 10% to 100% rather than asserted.

**Confidence** is `100 · (0.5 · observed evidence share + 0.5 · resolved falsification share)`. An investigation leaning on inference with open questions does not get to report the same number as one that does not.

Replay fixtures still carry authored numbers, which is fine for a scenario. They are tagged `numbersProvenance: "AUTHORED_SCENARIO"` so neither the interface nor the exported packet can present them as measurements.

Implementation: [`lib/consequence-model.ts`](./lib/consequence-model.ts).

---

## Evidence packets

Each incident is a capture packet in `data/incidents/` holding a real transaction receipt, a Bitget mark window, a traded liquidity window, and a SHA-256 integrity hash over the whole thing.

```sh
npm run data:verify     # recompute every hash, fail if any packet changed
```

Three real captures: the 27 August Moonwell MAMO incident on Base, the 22 July AFX bridge outflow on Arbitrum, and the 23 July AFX recovery response. The remaining queue entries are labelled replay fixtures in the interface and in the export.

---

## The role of the LLM

Deterministic code owns every number, every gate and all execution. The model does not get to move any of them.

`/api/investigator` is a server side boundary that sends only the assembled evidence context to Claude and gets back a structured interpretation: a causal hypothesis, a verdict on each of the six falsification questions, and what evidence would settle them. The response is schema validated, and evidence references outside the supplied allow list are stripped. An `actionBias` it returns is an interpretation label, never an order instruction.

If the key is absent the route reports itself unconfigured and the rest of the product is unaffected.

---

## Run it

```sh
npm install
npm run dev          # http://127.0.0.1:5173
```

```sh
npm run lint
npm run build
npm run data:verify        # capture integrity
npm run paper:tick         # one paper engine tick
npm run paper:calibrate    # threshold calibration against a ticker snapshot
```

### Bitget Demo

There is no live trading path. The authenticated Demo route stays off unless
`WAKE_EXECUTION_MODE=bitget-demo` is set explicitly, and both Demo scripts write
a redacted, hashed artifact to `data/bitget-demo/` on every run. That directory
is empty in a fresh clone, which is the honest state until someone runs it with
Demo credentials. Credentials and request signatures are never written; see
[`data/bitget-demo/README.md`](./data/bitget-demo/README.md).

Copy `env.example` to `.env.local`. Every key in it is optional: Bitget market data is public and needs none. WAKE runs in paper mode by default and the Bitget Demo route stays behind an explicit `WAKE_EXECUTION_MODE=bitget-demo` opt in.

---

## What WAKE is not

- Not a live trading system. There is no code path to a funded account.
- Not an exploit alert feed. An alert is an input, never an order.
- Not a sentiment bot.
- Not a claim of universal protocol coverage. `/api/watchers/coverage` lists what has a validated resolver and what is merely planned, and planned coverage is never drawn as live.

---

## Layout

| Path | Purpose |
| --- | --- |
| `lib/wake-engine.ts` | Incidents, exposure graph, falsification, risk gate, evidence export |
| `lib/consequence-model.ts` | Square root impact model and computed confidence |
| `scripts/paper/` | Tier 2 strategy, cost model, ledger, metrics |
| `scripts/paper-tick.mjs` | The engine tick that GitHub Actions runs |
| `data/incidents/` | Hashed capture packets |
| `data/paper/` | The live paper log |
| `app/api/paper/` | Serves the ledger to the interface |

Architecture and the line by line implementation boundary: [`WAKE_ACTIONGRAPH_PRD.md`](./WAKE_ACTIONGRAPH_PRD.md) and [`PRD_AUDIT.md`](./PRD_AUDIT.md).

Built on [vinext](https://github.com/cloudflare/vinext). Starter scaffolding notes live in [`docs/STARTER.md`](./docs/STARTER.md).
