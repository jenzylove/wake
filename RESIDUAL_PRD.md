# PRD 2 — RESIDUAL

## 1. Product contract

### Product name

RESIDUAL — Event-Neutral Earnings Agent

### One-line thesis

RESIDUAL trades only the company-specific portion of an earnings reaction after removing broad market, sector, and liquidity effects.

### Problem

Most earnings agents use a simplistic rule:

```text
Earnings beat → buy
Earnings miss → sell
```

But a stock’s reaction is not purely company-specific. The move may be caused by market beta, sector movement, index movement, rates, pre-event positioning, liquidity, or the actual company surprise.

RESIDUAL estimates the expected market and sector contribution, isolates the unexplained company-specific residual, and trades that residual through a Bitget pair or hedged position.

### Primary user

A quantitative trader or judge who wants to verify:

- what the company actually reported;
- what the market expected;
- how much of the move was explained by market and sector factors;
- whether a residual remained;
- why the agent opened, sized, or rejected a trade;
- whether the strategy works out of sample.

### Primary track

Bitget S2 Alpha Factory.

Relevant subthemes:

- earnings-driven trading;
- cross-market correlation;
- factor mining.

### Product output

Every event produces an event record, structured earnings surprise, expected factor move, actual move, residual move, hedge ratio, trade/no-trade decision, paper order record, and post-event attribution.

### Product boundary

RESIDUAL is not:

- a chat-based earnings assistant;
- a generic financial-news sentiment bot;
- a one-directional “beat equals long” strategy;
- a generic stock portfolio rebalance tool;
- a pure backtest generator.

The unique capability is **market-neutral event attribution followed by executable residual trading**.

## 2. Core behavior

### Supported universe

Start with a curated Bitget universe of liquid tokenized stocks, stock perpetuals, sector proxies, and broad-market proxies.

Each instrument must have:

- stable symbol mapping;
- historical price data;
- current market data;
- spread/liquidity measurements;
- documented trading availability.

If an event lacks sufficient data or a valid hedge, the system must return `NO_TRADE`.

### Data inputs

#### Earnings data

Use primary or traceable sources:

- issuer earnings release;
- SEC filing;
- reported revenue;
- reported EPS;
- guidance;
- margins;
- management commentary;
- consensus estimate;
- event timestamp.

The LLM may extract and classify information, but numerical values must be stored with source references and validated before entering the model.

#### Market data

Use Bitget ticker and candle data, the company instrument, sector proxy, market proxy, volatility, spread, volume, and funding or carrying cost where applicable.

#### Event calendar

Track earnings date, release time, pre-market or after-market release, guidance update, and event expiry window.

### Agent and model flow

1. **Event collector** — creates a timestamped event record.
2. **Earnings extractor** — converts the release into actual, expected, surprise, guidance direction, confidence, and durable-versus-transitory interpretation.
3. **Factor estimator** — estimates the expected company move from broad market return, sector return, relevant factor returns, pre-event volatility, and historical event behavior.
4. **Residual calculator** — computes:

```text
Observed company return
− expected market contribution
− expected sector contribution
− estimated liquidity effect
= company-specific residual
```

5. **Trade constructor** — builds a market-neutral or beta-reduced position:

```text
Long company / short sector
or
Short company / long sector
```

The hedge ratio must come from deterministic historical beta estimation, not from an LLM guess.

6. **AI interpretation layer** — determines whether the residual appears durable, temporary, already priced, contradicted by guidance, or too uncertain to trade.
7. **Risk and trade gate** — rejects trades when the residual is below the cost threshold, the hedge is unavailable, liquidity is too thin, event data is incomplete, the market reaction is already complete, or the edge is not robust across model assumptions.
8. **Paper executor** — records both legs, prices, quantities, fees, and balance change.
9. **Post-event evaluator** — attributes realized P&L to the company leg, hedge leg, factor error, residual estimate, execution slippage, and timing.

### Required user interface

#### Event board

Show company, event timestamp, actual versus expected metrics, guidance classification, event status, residual estimate, and decision.

#### Surprise decomposition

Example:

```text
Reported revenue: +7.2% versus +4.1% expected
Guidance: raised
Market contribution: +1.4%
Sector contribution: +0.8%
Observed company move: +1.1%
Estimated residual: -1.1%
Decision: short company / long sector
```

#### Strategy card

Show company instrument, hedge instrument, direction, hedge ratio, expected residual, entry, event horizon, maximum loss, and exit condition.

#### Evidence panel

Show source document, timestamp, extracted values, market snapshots, factor calculation, model version, and reproducible input file.

#### Results panel

Show event-by-event P&L, company-leg P&L, hedge-leg P&L, residual attribution, hit rate, drawdown, average holding time, rejected events, and comparison against naïve headline trading.

## 3. Build and demo acceptance

### Primary demo

Use real historical earnings events, not generated events.

```text
Real earnings release
→ structured surprise
→ market/sector attribution
→ residual calculation
→ paired Bitget paper trade
→ realized event outcome
→ P&L attribution
```

Historical replay is acceptable, but every event must retain its source URL, event timestamp, market-data timestamp, extracted values, generated decision, and paper execution record.

Also include a live mode that watches the next eligible event and records `NO_TRADE` when no qualifying setup exists.

### Required evaluation set

Use at least 15 real historical events across a small, documented universe.

Evaluate:

- residual strategy;
- naïve earnings-direction baseline;
- unhedged company trade;
- no-trade baseline.

Use time-split or walk-forward evaluation. Do not train and evaluate on the same event window.

### Definition of done

The product is complete when:

- the README runs the strategy from a documented dataset;
- the app presents at least 15 replayable events;
- all numerical earnings fields have provenance;
- factor decomposition is reproducible;
- at least one event produces a paired paper trade;
- at least one event produces `NO_TRADE`;
- both legs of every pair are logged;
- slippage and fees are included;
- results can be regenerated from code;
- the live watcher can add a new event record;
- the LLM never supplies unverified numerical values directly to execution.

### Implementation order

1. Define event, earnings, factor, residual, trade, and attribution schemas.
2. Build a small real earnings dataset with source links.
3. Build market/sector return extraction.
4. Implement deterministic factor decomposition.
5. Implement residual strategy and paired paper accounting.
6. Add LLM guidance interpretation with structured output validation.
7. Build event board, decomposition card, and results panel.
8. Add walk-forward evaluation and baseline comparison.
9. Add live event watcher and exportable paper ledger.

### Submission separation rule

This is an independent submission from WAKE. RESIDUAL must not depend on ActionGraph, onchain incident logic, exploit fixtures, or contagion terminology.

Its story is:

> The market moved—but how much of that move actually belonged to the company?
