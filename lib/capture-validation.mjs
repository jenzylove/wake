import { createHash } from "node:crypto"

function finitePositive(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
}

export function validateCapturePacket(parsed) {
  const errors = []
  if (parsed?.schema !== "wake.historical-capture.v1") errors.push("unsupported schema")
  if (!/^INC-REAL-[A-Z0-9-]+$/.test(parsed?.incident?.id || "")) errors.push("invalid incident id")
  if (!/^0x[0-9a-f]{64}$/i.test(parsed?.incident?.txHash || "")) errors.push("invalid incident transaction hash")
  if (parsed?.receipt?.status !== "0x1") errors.push("receipt is not successful")
  if (parsed?.receipt?.transactionHash !== parsed?.incident?.txHash) errors.push("receipt transaction hash mismatch")

  const candles = parsed?.market?.candles
  if (!Array.isArray(candles) || candles.length === 0) {
    errors.push("market candle window is empty")
  } else {
    const seen = new Set()
    let previous = -Infinity
    for (const [index, candle] of candles.entries()) {
      if (!Number.isFinite(candle.timestamp) || candle.timestamp <= previous || seen.has(candle.timestamp)) errors.push(`candle ${index} timestamp is not strictly increasing`)
      previous = candle.timestamp
      seen.add(candle.timestamp)
      if (candle.timestamp < parsed.market.startTime || candle.timestamp >= parsed.market.endTime) errors.push(`candle ${index} is outside the declared window`)
      if (![candle.open, candle.high, candle.low, candle.close].every(finitePositive)) errors.push(`candle ${index} has invalid OHLC values`)
      if (finitePositive(candle.high) && candle.high < Math.max(candle.open, candle.close)) errors.push(`candle ${index} high is inconsistent`)
      if (finitePositive(candle.low) && candle.low > Math.min(candle.open, candle.close)) errors.push(`candle ${index} low is inconsistent`)
      if (![candle.baseVolume, candle.quoteVolume].every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0)) errors.push(`candle ${index} has invalid volume values`)
    }
    const receiptTimestamp = parsed.receipt?.logs?.[0]?.blockTimestamp
    const incidentTimestampMs = Number.isFinite(parsed?.incident?.blockTimestamp)
      ? parsed.incident.blockTimestamp * 1000
      : typeof receiptTimestamp === "string" ? Number.parseInt(receiptTimestamp, 16) * 1000 : Number.NaN
    if (!Number.isFinite(incidentTimestampMs) || incidentTimestampMs < parsed.market.startTime || incidentTimestampMs >= parsed.market.endTime) errors.push("incident timestamp is outside the market window")
  }

  const { integrity, ...packet } = parsed || {}
  const actualIntegrity = createHash("sha256").update(JSON.stringify(packet)).digest("hex")
  if (typeof integrity !== "string" || integrity !== actualIntegrity) errors.push("integrity hash mismatch")
  return { ok: errors.length === 0, errors, actualIntegrity, expectedIntegrity: integrity }
}
