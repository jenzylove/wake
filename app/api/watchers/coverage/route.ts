import { coverageRegistry } from "@/lib/wake-engine"

export async function GET() {
  return Response.json({
    product: "WAKE",
    watcherMode: "validated-coverage-registry",
    liveDiscoveryEnabled: false,
    coverage: coverageRegistry,
  })
}
