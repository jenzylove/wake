import { readFile } from "node:fs/promises"
import path from "node:path"

// The paper ledger is committed to the repo by the scheduled engine, which marks
// its commits [skip ci] so ticks do not trigger a redeploy. That means the copy
// bundled into this deployment goes stale between deploys, so we read the live
// file from the public repo and fall back to the bundled copy if that fails.

const RAW_BASE = process.env.WAKE_LEDGER_RAW_BASE
  ?? "https://raw.githubusercontent.com/jenzylove/wake/main/data/paper"

const FILES = ["metrics.json", "equity.jsonl", "state.json"] as const

async function readRemote(name: string) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(`${RAW_BASE}/${name}`, {
      signal: controller.signal,
      next: { revalidate: 60 },
    })
    if (!response.ok) return null
    return await response.text()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function readLocal(name: string) {
  try {
    return await readFile(path.join(process.cwd(), "data", "paper", name), "utf8")
  } catch {
    return null
  }
}

async function readLedger(name: string) {
  const remote = await readRemote(name)
  if (remote !== null) return { text: remote, source: "github-raw" as const }
  const local = await readLocal(name)
  if (local !== null) return { text: local, source: "bundled" as const }
  return null
}

function parseJsonl(text: string) {
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try { return [JSON.parse(line) as Record<string, unknown>] } catch { return [] }
    })
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const curvePoints = Math.min(Math.max(Number(url.searchParams.get("points") ?? 500), 10), 2000)

  const [metricsRaw, equityRaw, stateRaw] = await Promise.all(FILES.map(readLedger))

  if (!metricsRaw) {
    return Response.json({
      product: "WAKE",
      running: false,
      note: "The paper engine has not produced a ledger yet. It publishes to data/paper on a 10 minute schedule.",
    }, { status: 200 })
  }

  let metrics: Record<string, unknown>
  try {
    metrics = JSON.parse(metricsRaw.text) as Record<string, unknown>
  } catch {
    return Response.json({ error: "Ledger metrics could not be parsed" }, { status: 502 })
  }

  const equityCurve = equityRaw ? parseJsonl(equityRaw.text) : []
  const state = stateRaw ? (() => { try { return JSON.parse(stateRaw.text) as Record<string, unknown> } catch { return null } })() : null
  const openPositions = Array.isArray((state as { openPositions?: unknown[] } | null)?.openPositions)
    ? (state as { openPositions: Record<string, unknown>[] }).openPositions
    : []

  // Downsample the curve so the client gets a drawable series, keeping the last point.
  const step = Math.max(1, Math.ceil(equityCurve.length / curvePoints))
  const sampled = equityCurve.filter((_, index) => index % step === 0)
  if (equityCurve.length && sampled.at(-1) !== equityCurve.at(-1)) sampled.push(equityCurve.at(-1)!)

  return Response.json({
    product: "WAKE",
    running: true,
    source: metricsRaw.source,
    metrics,
    equityCurve: sampled,
    equityPointsTotal: equityCurve.length,
    openPositions: openPositions.map((position) => ({
      id: position.id,
      symbol: position.symbol,
      side: position.side,
      openedAt: position.openedAt,
      entryPrice: position.entryPrice,
      notionalUsd: position.notionalUsd,
      unrealizedPnlUsd: position.unrealizedPnlUsd,
      fundingUsd: position.fundingUsd,
      entryBasisRate: position.entryBasisRate,
      currentBasisRate: position.currentBasisRate,
      stopPrice: position.stopPrice,
      maxLossUsd: position.maxLossUsd,
    })),
  })
}
