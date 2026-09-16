import test from "node:test"
import assert from "node:assert/strict"
import { authorizeOperatorRequest, authorizeSchedulerRequest } from "../lib/request-auth.mjs"

function withEnvironment(values, run) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]))
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try { return run() } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

test("hosted operator mutations fail closed when no secret exists", () => withEnvironment({ VERCEL: "1", WAKE_OPERATOR_SECRET: undefined }, () => {
  const result = authorizeOperatorRequest(new Request("https://wake.example/api/mutation"))
  assert.equal(result.ok, false)
  assert.equal(result.status, 503)
}))

test("operator secret accepts bearer and rejects a wrong token", () => withEnvironment({ VERCEL: "1", WAKE_OPERATOR_SECRET: "correct-secret" }, () => {
  assert.equal(authorizeOperatorRequest(new Request("https://wake.example/api/mutation", { headers: { authorization: "Bearer correct-secret" } })).ok, true)
  assert.equal(authorizeOperatorRequest(new Request("https://wake.example/api/mutation", { headers: { authorization: "Bearer wrong-secret" } })).status, 401)
}))

test("hosted watcher fails closed without a scheduler secret", () => withEnvironment({ VERCEL: "1", WAKE_SCHEDULER_SECRET: undefined, CRON_SECRET: undefined }, () => {
  assert.equal(authorizeSchedulerRequest(new Request("https://wake.example/api/watchers/run")).status, 503)
}))
