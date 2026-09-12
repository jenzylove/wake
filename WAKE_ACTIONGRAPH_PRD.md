# PRD 1 — WAKE + ACTIONGRAPH

## 1. Product contract

### Product name

WAKE — Causal Market Response

### One-line thesis

WAKE discovers when a real onchain or market event creates an economically exposed asset that the market has not fully repriced, then chooses to trade, hedge, monitor, or abstain.

### Problem

Most event-driven trading systems stop at:

```text
Event detected → sentiment classified → asset traded
```

That skips the important question:

> Who actually absorbs the economic damage or benefit?

A protocol exploit may affect a collateral asset, lending market, governance token, stablecoin, or correlated Bitget instrument. WAKE maps those consequences before deciding whether a trade exists.

### Primary user

A trader, risk manager, or judge who wants to inspect:

- what happened;
- which entities and assets are exposed;
- how large the exposure is;
- what evidence supports each relationship;
- whether the market has already priced it;
- why the agent traded or abstained.

### Primary track

Bitget S2 Agentic Trading.

### Product output

Every event must produce one of these decisions:

- `TRADE_DIRECT`
- `TRADE_CONTAGION`
- `TRADE_RESOLUTION`
- `HEDGE`
- `MONITOR`
- `NO_TRADE`

The system must never turn a third-party alert directly into an order.

### Core product boundary

WAKE is not:

- a generic exploit alert dashboard;
- a sentiment bot;
- a “hack detected, short token” rule;
- a generic risk gate;
- a chatbot;
- a fabricated exploit simulator presented as live evidence.

The unique capability is the **event-to-economic-consequence graph**.

## 2. Core behavior

### Event sources

Support an extensible watcher architecture covering:

- Ethereum;
- Base;
- Arbitrum;
- protocol state changes;
- oracle deviations;
- collateral/debt changes;
- abnormal token transfers;
- bridge supply changes;
- real-world market events;
- earnings, guidance, or corporate events where they affect an onchain or Bitget-traded asset.

Do not claim universal protocol coverage. Maintain a visible coverage registry showing which protocols and event types have validated resolvers.

### ActionGraph model

The graph contains:

#### Nodes

- event;
- transaction;
- contract;
- protocol;
- token;
- collateral asset;
- debt asset;
- issuer;
- market;
- Bitget instrument;
- open position;
- evidence source.

#### Edges

- `caused_by`;
- `controls`;
- `collateralizes`;
- `owes`;
- `depends_on`;
- `tracks`;
- `impacts`;
- `trades_as`;
- `invalidates`;
- `resolved_by`.

Each edge must include:

- source;
- timestamp;
- confidence;
- direction;
- estimated magnitude;
- evidence reference;
- whether it is observed or inferred.

### Agent roles

Use AI for interpretation and causal reasoning. Use deterministic code for numbers and execution.

1. **Watcher** — detects candidate state changes and normalizes them into an event record.
2. **Investigator** — reads transaction traces, protocol documentation, public disclosures, and market context.
3. **ActionGraph builder** — creates and updates the exposure graph.
4. **Consequence modeler** — estimates minimum, base-case, and maximum plausible economic impact.
5. **Market scanner** — compares modeled consequence with Bitget price movement, liquidity, spread, funding, and open interest.
6. **Causal falsifier** — attempts to disprove the proposed causal path.
7. **Risk gate** — applies deterministic position limits, exposure limits, slippage limits, invalidation rules, and maximum-loss constraints.
8. **Executor** — writes a Bitget paper order by default and records the complete request/response.
9. **Monitor** — rechecks the event, graph, market, and position as new observations arrive.

### Causal falsification requirements

Before trading, the agent must answer:

- Is the asset actually accepted as collateral?
- Is the debt cap material?
- Has the loss already been absorbed?
- Is the downstream relationship only associative?
- Has the market already repriced?
- What evidence would invalidate the trade?

### State machine

```text
WATCHING
→ ANOMALY_DETECTED
→ INVESTIGATING
→ INCIDENT_CONFIRMED
→ EXPOSURE_MAPPING
→ MARKET_CHECK
→ CAUSAL_CHALLENGE
→ TRADE_READY
→ RISK_APPROVED
→ POSITION_OPEN
→ MONITORING
→ CLOSE / REVERSE / NO_TRADE
```

### Required user interface

The first screen must be the working investigation surface.

#### Incident queue

Show event time, chain, event type, confidence, state, value at risk, current decision, and whether a position exists.

#### ActionGraph view

Show observed versus inferred relationships, node types, exposure magnitude, selected edge details, evidence references, graph confidence, and invalidation conditions.

#### Evidence packet

Show transaction hashes, RPC/API source, protocol references, state changes, exposure formula, market snapshot, model assumptions, timestamp, and paper order ID.

#### Decision card

Show trade/no-trade decision, instrument, direction, size, entry, maximum loss, invalidation, catalyst horizon, and abstention reason when applicable.

#### Position monitor

Show entry, current price, unrealized P&L, thesis status, updated exposure, exit condition, and latest observation.

#### Replay lab

Allow a judge to rerun an evidence snapshot without changing the original ledger.

## 3. Build and demo acceptance

### Primary demo

Use a real, timestamped, replayable event as the main demonstration.

```text
Real event
→ evidence collection
→ ActionGraph construction
→ consequence estimate
→ market check
→ causal falsification
→ Bitget paper trade or NO_TRADE
→ position monitoring
→ immutable evidence record
```

The blind randomized incident harness may remain as a secondary evaluation mode, but it must not be the only proof of the product.

### Demo cases

Prepare three cases:

1. **Contagion trade** — a real event creates non-obvious downstream exposure and the agent opens a paper position.
2. **False causal link** — the event appears related to an asset, but exposure is immaterial or already priced. The agent chooses `NO_TRADE`.
3. **Resolution or thesis invalidation** — new evidence changes the graph or market state and the agent closes or invalidates the position.

### Definition of done

The product is complete when:

- a judge can open the demo without credentials;
- the README explains local execution;
- the app runs in paper mode by default;
- at least one event flows end-to-end;
- the graph contains evidence-backed nodes and edges;
- numerical exposure calculations are reproducible;
- at least one Bitget paper order or explicit `NO_TRADE` record exists;
- the decision log includes timestamps and state transitions;
- the evidence packet can be exported as JSON;
- the system distinguishes observed data from inference;
- no fabricated value is presented as live data.

### Implementation order

1. Define event, evidence, graph, decision, order, and position schemas.
2. Build replayable event fixtures from real historical evidence.
3. Build the ActionGraph renderer and edge evidence panel.
4. Add deterministic consequence and risk calculations.
5. Add Bitget market-data adapter and paper executor.
6. Add causal falsification output.
7. Add incident queue, decision card, and position monitor.
8. Add evidence export and README.
9. Add live watcher adapters after the replay flow is stable.

### Submission separation rule

This is an independent submission. Do not describe it as a component of RESIDUAL, and do not reuse RESIDUAL’s earnings strategy or quantitative factor model.
