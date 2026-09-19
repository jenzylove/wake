import { getBitgetMarkSnapshot } from "@/lib/bitget-client"
import { appendRuntimeRecord, runtimeStoreStatus } from "@/lib/runtime-store"
import { coverageRegistry } from "@/lib/wake-engine"
import discovered from "@/data/discovered/index.json"

export type WatcherRunReport = {
  runId: string
  startedAt: string
  completedAt: string
  liveDiscoveryEnabled: true
  discovery: { feed: string; updatedAt: string; lastRun: unknown; monitoring: number; noTrade: number }
  adapters: Array<{ chain: string; protocol: string; status: string; reason: string }>
  observations: Array<{ symbol: string; markPrice: number; capturedAt: string; source: string }>
  persisted: boolean
  storage: ReturnType<typeof runtimeStoreStatus>
}

export async function runValidatedWatcherPass(): Promise<WatcherRunReport> {
  const startedAt = new Date().toISOString()
  const adapters: WatcherRunReport["adapters"] = []
  const observations: WatcherRunReport["observations"] = []

  for (const coverage of coverageRegistry.filter((item) => item.status === "VALIDATED")) {
    if (coverage.chain === "BITGET") {
      for (const symbol of ["BTCUSDT", "ETHUSDT"]) {
        try {
          const snapshot = await getBitgetMarkSnapshot(symbol)
          observations.push(snapshot)
        } catch (error) {
          adapters.push({ chain: coverage.chain, protocol: `${coverage.protocol} · ${symbol}`, status: "ERROR", reason: error instanceof Error ? error.message : "public mark request failed" })
        }
      }
      adapters.push({ chain: coverage.chain, protocol: coverage.protocol, status: "OBSERVED", reason: "Public mark snapshots captured; no private execution request made." })
      continue
    }
    adapters.push({ chain: coverage.chain, protocol: coverage.protocol, status: "CAPTURE_READY", reason: "Validated receipt adapter for transaction candidates. Incidents are discovered automatically from the exploit feed (see discovery)." })
  }

  const completedAt = new Date().toISOString()
  const report: WatcherRunReport = {
    runId: `watch_${completedAt.replace(/[-:TZ.]/g, "").slice(0, 14)}`,
    startedAt,
    completedAt,
    liveDiscoveryEnabled: true,
    discovery: { feed: "https://api.llama.fi/hacks", updatedAt: discovered.updatedAt, lastRun: discovered.lastRun, monitoring: discovered.incidents.filter((i) => i.decision === "MONITOR").length, noTrade: discovered.incidents.filter((i) => i.decision === "NO_TRADE").length },
    adapters,
    observations,
    persisted: false,
    storage: runtimeStoreStatus(),
  }
  const write = await appendRuntimeRecord("watcher-runs", report)
  return { ...report, persisted: write.persisted, storage: write.status }
}
