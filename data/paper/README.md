# WAKE paper ledger

This directory is the live paper trading log. It is written by
`scripts/paper-tick.mjs`, which runs every ten minutes from
`.github/workflows/paper-engine.yml` and commits whatever changed.

The commit history is the point. Each tick lands as its own timestamped commit
from the Actions runner, so the claim that this log was produced live during the
competition window is checkable from `git log` rather than taken on trust.

| File | Contents |
| --- | --- |
| `equity.jsonl` | One mark to market point per tick: equity, realised PnL, open exposure, and the scan summary for that tick |
| `trades.jsonl` | Append only. One record when a position opens, another when it closes, carrying entry, exit, fees, funding, slippage and realised PnL |
| `decisions.jsonl` | Every candidate that cleared the dislocation trigger, including the ones the gate refused, with the full check list |
| `metrics.json` | Sharpe, max drawdown, win rate, profit factor, turnover and cost totals, recomputed from the two logs above on every tick |
| `state.json` | Engine state: open positions, equity, tick count |

## Reproducing the metrics

Nothing in `metrics.json` is privileged. It is a pure function of `equity.jsonl`
and `trades.jsonl`, both of which are in this directory:

```sh
node -e "
import('./scripts/paper/metrics.mjs').then(async ({computeMetrics}) => {
  const {readJsonl} = await import('./scripts/paper/ledger.mjs')
  const trades = new Map(readJsonl('trades.jsonl').map(t => [t.id, t]))
  console.log(computeMetrics({
    equityCurve: readJsonl('equity.jsonl'),
    trades: [...trades.values()],
    startingEquityUsd: 100000,
  }))
})"
```

## What is being traded

Tier 2 only: perpetual basis and funding dislocation on Bitget USDT-M futures.
This is a microstructure trade and is labelled as one. It is a different claim
from the tier 1 causal incident path in `lib/wake-engine.ts`, and the two are
kept separate on purpose.

Costs are modelled at the conservative end. Entries and exits cross the spread at
the observed touch, fees are charged at the Bitget published taker rate rather
than a maker rate, and funding accrues at the observed rate per eight hour
interval. No fill is assumed that the book did not show.
