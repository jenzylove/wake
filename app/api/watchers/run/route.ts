import { runValidatedWatcherPass } from "@/lib/watcher-service"

function authorized(request: Request) {
  const secret = process.env.WAKE_SCHEDULER_SECRET || process.env.CRON_SECRET
  if (!secret) return true
  return request.headers.get("authorization") === `Bearer ${secret}` || request.headers.get("x-wake-scheduler-secret") === secret
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Watcher scheduler authorization failed" }, { status: 401 })
  try {
    return Response.json({ product: "WAKE", source: "server-watcher-pass", report: await runValidatedWatcherPass() })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Watcher pass failed" }, { status: 502 })
  }
}
