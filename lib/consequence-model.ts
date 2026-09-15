// Deterministic consequence model.
//
// This replaces hand entered impact figures with a computed one. The previous
// build carried `modeledDelta: 5.4` as a literal, which meant the trade decision
// was a typed number minus an observed one. Anyone reading the engine found that
// in a minute, and it undercut the evidence discipline everywhere else.
//
// The model is the square root law for market impact:
//
//     impact = Y * sigma * sqrt(Q / V)
//
// where sigma is realised volatility over the event window, V is traded value
// over the same window, and Q is the flow reaching the instrument. sigma and V
// are read from the capture packet, so they are observed. Y is a documented
// constant. Q is the only judgement call and it is decomposed explicitly:
// the receipt proves a gross on chain outflow, it does not prove how much of
// that outflow reached this particular instrument, so the conversion share is
// declared as an assumption and swept across a range rather than asserted.

export type ImpactProvenance = "OBSERVED" | "ESTIMATED" | "ASSUMED"

export type ConsequenceInputs = {
  /** Gross flow proven by the on chain receipt, in USD. */
  grossFlowUsd: number
  /** Traded value over the event window, in USD. Observed from the packet. */
  windowQuoteVolumeUsd: number
  /** Realised volatility across the event window. Observed from the packet. */
  windowSigma: number
}

// Square root law coefficient. Empirical estimates cluster near 1 for liquid
// futures; 1.0 is used so the model is not quietly tuned to produce an edge.
export const IMPACT_COEFFICIENT = 1.0

// The receipt proves money left a bridge. It does not prove the share that was
// converted into this instrument and sold inside the window. These are the
// scenarios the model is willing to state.
export const CONVERSION_SCENARIOS = {
  minimum: 0.1,
  base: 0.25,
  maximum: 1.0,
} as const

export type ConsequenceResult = {
  minimumPct: number
  basePct: number
  maximumPct: number
  participationRate: number
  formula: string
  assumptions: string[]
  inputs: Array<{ label: string; value: string; provenance: ImpactProvenance }>
  computable: true
}

function impactRate({ flowUsd, windowQuoteVolumeUsd, windowSigma }: { flowUsd: number; windowQuoteVolumeUsd: number; windowSigma: number }) {
  if (!(windowQuoteVolumeUsd > 0) || !(windowSigma > 0) || !(flowUsd > 0)) return 0
  const participation = flowUsd / windowQuoteVolumeUsd
  return IMPACT_COEFFICIENT * windowSigma * Math.sqrt(participation)
}

export function modelConsequence(inputs: ConsequenceInputs): ConsequenceResult | null {
  const { grossFlowUsd, windowQuoteVolumeUsd, windowSigma } = inputs
  if (!(grossFlowUsd > 0) || !(windowQuoteVolumeUsd > 0) || !(windowSigma > 0)) return null

  const rate = (share: number) => impactRate({
    flowUsd: grossFlowUsd * share,
    windowQuoteVolumeUsd,
    windowSigma,
  })

  const round = (value: number) => Number((value * 100).toFixed(3))

  return {
    minimumPct: round(rate(CONVERSION_SCENARIOS.minimum)),
    basePct: round(rate(CONVERSION_SCENARIOS.base)),
    maximumPct: round(rate(CONVERSION_SCENARIOS.maximum)),
    participationRate: (grossFlowUsd * CONVERSION_SCENARIOS.base) / windowQuoteVolumeUsd,
    formula: "impact = Y · sigma · sqrt(Q / V), with Y = 1.0, sigma and V observed over the event window, and Q = gross outflow × conversion share",
    assumptions: [
      `Gross outflow of $${Math.round(grossFlowUsd).toLocaleString()} is proven by the transaction receipt`,
      `Traded value of $${(windowQuoteVolumeUsd / 1e6).toFixed(2)}M and realised volatility of ${(windowSigma * 100).toFixed(3)}% are observed over the same window`,
      `The share of the outflow reaching this instrument is not proven by the receipt; it is swept from ${CONVERSION_SCENARIOS.minimum * 100}% to ${CONVERSION_SCENARIOS.maximum * 100}% with ${CONVERSION_SCENARIOS.base * 100}% as the base case`,
      "Square root impact is a market convention, not a measurement of this event",
    ],
    inputs: [
      { label: "Gross outflow (Q gross)", value: `$${Math.round(grossFlowUsd).toLocaleString()}`, provenance: "OBSERVED" },
      { label: "Window traded value (V)", value: `$${(windowQuoteVolumeUsd / 1e6).toFixed(2)}M`, provenance: "OBSERVED" },
      { label: "Window realised vol (sigma)", value: `${(windowSigma * 100).toFixed(3)}%`, provenance: "OBSERVED" },
      { label: "Impact coefficient (Y)", value: IMPACT_COEFFICIENT.toFixed(1), provenance: "ESTIMATED" },
      { label: "Conversion share (base)", value: `${CONVERSION_SCENARIOS.base * 100}%`, provenance: "ASSUMED" },
    ],
    computable: true,
  }
}

/**
 * Causal confidence, computed rather than asserted.
 *
 * Two things drive it, weighted equally: how much of the evidence is directly
 * observed rather than inferred, and how many of the falsification questions
 * actually got resolved. An investigation that leans on inference and leaves
 * questions open should not report the same confidence as one that does not.
 */
export function computeConfidence({
  evidenceEpistemics,
  falsificationStatuses,
}: {
  evidenceEpistemics: Array<"OBSERVED" | "INFERRED">
  falsificationStatuses: Array<"SUPPORTED" | "UNRESOLVED" | "FAILED">
}): { value: number; observedShare: number; resolvedShare: number; formula: string } | null {
  if (evidenceEpistemics.length === 0 || falsificationStatuses.length === 0) return null
  const observedShare = evidenceEpistemics.filter((item) => item === "OBSERVED").length / evidenceEpistemics.length
  const resolvedShare = falsificationStatuses.filter((item) => item !== "UNRESOLVED").length / falsificationStatuses.length
  return {
    value: Math.round(100 * (observedShare * 0.5 + resolvedShare * 0.5)),
    observedShare,
    resolvedShare,
    formula: "confidence = 100 · (0.5 · observed evidence share + 0.5 · resolved falsification share)",
  }
}
