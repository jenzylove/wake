import { bitgetConfigStatus } from "@/lib/bitget-client"
import { chainEvidenceConfigStatus } from "@/lib/chain-evidence"

export async function GET() {
  return Response.json({
    product: "WAKE",
    version: "0.3.1",
    data: bitgetConfigStatus(),
    chainEvidence: chainEvidenceConfigStatus(),
    liveTrading: false,
  })
}
