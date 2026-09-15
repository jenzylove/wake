"use client"

import * as React from "react"
import { AlertTriangle, RotateCcw, ShieldCheck } from "lucide-react"
import { CONVERSION_SCENARIOS, IMPACT_COEFFICIENT, type ConsequenceInputs } from "@/lib/consequence-model"
import { GATE_THRESHOLDS } from "@/lib/wake-engine"

// Re-runs the consequence model under assumptions the viewer chooses.
//
// The old replay button re-derived the same static numbers and so could only
// ever return the same verdict, which made it theatre. The honest version lets
// someone attack the two inputs that are not observed, the conversion share and
// the impact coefficient, and watch what the gate does.

type Props = {
  inputs: ConsequenceInputs
  marketDeltaPct: number
  confidence: number | null
  instrument: string
}

function impactPct(inputs: ConsequenceInputs, share: number, coefficient: number) {
  const { grossFlowUsd, windowQuoteVolumeUsd, windowSigma } = inputs
  if (!(grossFlowUsd > 0) || !(windowQuoteVolumeUsd > 0) || !(windowSigma > 0)) return 0
  const participation = (grossFlowUsd * share) / windowQuoteVolumeUsd
  return coefficient * windowSigma * Math.sqrt(participation) * 100
}

export function StressTest({ inputs, marketDeltaPct, confidence, instrument }: Props) {
  const [share, setShare] = React.useState<number>(CONVERSION_SCENARIOS.base)
  const [coefficient, setCoefficient] = React.useState<number>(IMPACT_COEFFICIENT)

  const modelled = impactPct(inputs, share, coefficient)
  const residual = modelled - marketDeltaPct
  const residualPasses = residual >= GATE_THRESHOLDS.minResidualPct
  const confidencePasses = confidence !== null && confidence >= GATE_THRESHOLDS.minConfidence
  const gatePasses = residualPasses && confidencePasses

  // What would the coefficient have to be, at the current share, to clear the
  // residual threshold? This is the number that makes the abstention concrete.
  const unitImpact = impactPct(inputs, share, 1)
  const coefficientToFlip = unitImpact > 0
    ? (GATE_THRESHOLDS.minResidualPct + marketDeltaPct) / unitImpact
    : Infinity

  const maxedOut = impactPct(inputs, CONVERSION_SCENARIOS.maximum, coefficient) - marketDeltaPct

  return (
    <div className="stress">
      <div className="stress-head">
        <div>
          <strong>Stress the assumptions</strong>
          <span>Only two inputs are not observed. Attack them and watch the gate.</span>
        </div>
        <button
          type="button"
          className="stress-reset"
          onClick={() => { setShare(CONVERSION_SCENARIOS.base); setCoefficient(IMPACT_COEFFICIENT) }}
        >
          <RotateCcw size={12} /> Reset
        </button>
      </div>

      <div className="stress-controls">
        <label className="stress-control">
          <span className="stress-label">
            CONVERSION SHARE <em>assumed</em>
            <b>{(share * 100).toFixed(0)}%</b>
          </span>
          <input
            type="range" min={5} max={100} step={1}
            value={Math.round(share * 100)}
            onChange={(event) => setShare(Number(event.target.value) / 100)}
            aria-label="Share of the outflow reaching this instrument"
          />
          <small>How much of the ${Math.round(inputs.grossFlowUsd).toLocaleString()} outflow reached {instrument}. The receipt does not prove this.</small>
        </label>

        <label className="stress-control">
          <span className="stress-label">
            IMPACT COEFFICIENT Y <em>estimated</em>
            <b>{coefficient.toFixed(2)}</b>
          </span>
          <input
            type="range" min={25} max={400} step={5}
            value={Math.round(coefficient * 100)}
            onChange={(event) => setCoefficient(Number(event.target.value) / 100)}
            aria-label="Square root law impact coefficient"
          />
          <small>Empirical estimates for liquid futures cluster near 1.0.</small>
        </label>
      </div>

      <div className="stress-out">
        <div className="stress-cell">
          <span>MODELLED IMPACT</span>
          <strong>{modelled.toFixed(3)}%</strong>
        </div>
        <div className="stress-cell">
          <span>MARKET ALREADY MOVED</span>
          <strong>{marketDeltaPct.toFixed(3)}%</strong>
        </div>
        <div className="stress-cell">
          <span>RESIDUAL</span>
          <strong className={residualPasses ? "stress-pass" : "stress-hold"}>{residual.toFixed(3)}%</strong>
        </div>
        <div className="stress-cell">
          <span>GATE</span>
          <strong className={gatePasses ? "stress-pass" : "stress-hold"}>{gatePasses ? "PASS" : "HOLD"}</strong>
        </div>
      </div>

      <div className={gatePasses ? "stress-verdict stress-verdict-pass" : "stress-verdict"}>
        {gatePasses ? <ShieldCheck size={14} /> : <AlertTriangle size={14} />}
        <div>
          {!residualPasses && (
            <p>
              Residual needs {GATE_THRESHOLDS.minResidualPct}%. At this conversion share the impact coefficient would have to reach{" "}
              <b>{Number.isFinite(coefficientToFlip) ? coefficientToFlip.toFixed(2) : "n/a"}</b> before the trade clears, against the{" "}
              {IMPACT_COEFFICIENT.toFixed(1)} that empirical estimates cluster around.
            </p>
          )}
          {!confidencePasses && (
            <p>
              Causal confidence is {confidence ?? "n/a"} against a {GATE_THRESHOLDS.minConfidence} floor, so the gate holds on that check
              independently of anything these sliders do.
            </p>
          )}
          {residualPasses && !confidencePasses && (
            <p>The residual clears under these assumptions, but confidence does not. Both are required.</p>
          )}
          {gatePasses && (
            <p>Under these assumptions the gate would open. Note which inputs you had to move to get here, and whether the evidence supports them.</p>
          )}
          {!gatePasses && maxedOut < GATE_THRESHOLDS.minResidualPct && (
            <p className="stress-note">
              Even at 100% conversion and this coefficient the residual reaches only {maxedOut.toFixed(3)}%. There is no assumption inside
              this range that makes the trade clear.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
