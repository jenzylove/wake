function holdDecision(incident) {
  return incident.workflowState === "MONITORING" || incident.state === "INVESTIGATING" ? "MONITOR" : "NO_TRADE"
}

export function deriveDecisionPolicy(incident) {
  if (incident.falsification.some((check) => check.blocksTrade === true)) return holdDecision(incident)
  if (incident.modeledDelta === null || incident.confidence === null) return holdDecision(incident)
  const residual = incident.modeledDelta - incident.marketDelta
  if (residual >= 1.2 && incident.confidence >= 75) {
    if (incident.kind === "CONTAGION") return "TRADE_CONTAGION"
    if (incident.state === "RESOLVED") return "TRADE_RESOLUTION"
    return "TRADE_DIRECT"
  }
  return holdDecision(incident)
}

export function evaluateRiskGatePolicy(incident) {
  const residual = incident.modeledDelta === null ? null : incident.modeledDelta - incident.marketDelta
  const blockingFalsifiers = incident.falsification.filter((check) => check.blocksTrade === true)
  const checks = [
    { key: "confidence", label: "Causal confidence", passed: incident.confidence !== null && incident.confidence >= 75, value: incident.confidence === null ? "n/a" : `${incident.confidence}%`, threshold: "≥ 75%" },
    { key: "residual", label: "Residual edge", passed: residual !== null && residual >= 1.2, value: residual === null ? "n/a" : `${residual.toFixed(1)}%`, threshold: "≥ 1.2%" },
    { key: "loss-bound", label: "Maximum loss bound", passed: incident.maxLoss !== "$0", value: incident.maxLoss, threshold: "defined" },
    { key: "evidence", label: "Evidence packet", passed: incident.evidence.length >= 3, value: `${incident.evidence.length} sources`, threshold: "≥ 3 sources" },
    { key: "causal", label: "Causal challenge", passed: blockingFalsifiers.length === 0, value: blockingFalsifiers.length === 0 ? "no blocking checks" : `${blockingFalsifiers.length} blocking check${blockingFalsifiers.length === 1 ? "" : "s"}`, threshold: "0 blocking checks" },
  ]
  return { passed: checks.every((check) => check.passed), checks }
}
