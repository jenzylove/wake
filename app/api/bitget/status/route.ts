import { bitgetConfigStatus } from "@/lib/bitget-client"
import { chainEvidenceConfigStatus } from "@/lib/chain-evidence"

export async function GET() {
  return Response.json({
    product: "WAKE",
    version: "0.3.2",
    data: bitgetConfigStatus(),
    chainEvidence: chainEvidenceConfigStatus(),
    liveTrading: false,
    demoOrderProtection: {
      operatorSecretConfigured: Boolean(process.env.WAKE_OPERATOR_SECRET),
      maxNotionalUSDT: Number(process.env.WAKE_MAX_DEMO_NOTIONAL_USDT || "100"),
      decisionBound: true,
    },
  })
}
