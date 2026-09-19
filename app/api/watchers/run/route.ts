import { runValidatedWatcherPass } from "@/lib/watcher-service"
import { authorizeSchedulerRequest } from "@/lib/request-auth.mjs"

export async function GET(request: Request) {
  const authorization = authorizeSchedulerRequest(request)
  if (!authorization.ok) return Response.json({ error: authorization.error }, { status: authorization.status })
  try {
    return Response.json({ product: "WAKE", source: "server-watcher-pass", report: await runValidatedWatcherPass() })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Watcher pass failed" }, { status: 502 })
  }
}
