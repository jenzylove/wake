import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

export const PAPER_DIR = process.env.WAKE_PAPER_DIR || path.join(process.cwd(), "data", "paper")
export const STARTING_EQUITY_USD = Number(process.env.WAKE_STARTING_EQUITY ?? 100_000)

const file = (name) => path.join(PAPER_DIR, name)

export function ensureDir() {
  if (!existsSync(PAPER_DIR)) mkdirSync(PAPER_DIR, { recursive: true })
}

export function appendJsonl(name, record) {
  ensureDir()
  appendFileSync(file(name), `${JSON.stringify(record)}\n`, "utf8")
}

export function readJsonl(name) {
  const target = file(name)
  if (!existsSync(target)) return []
  return readFileSync(target, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line) } catch { return null }
    })
    .filter(Boolean)
}

export function readJson(name, fallback) {
  const target = file(name)
  if (!existsSync(target)) return fallback
  try { return JSON.parse(readFileSync(target, "utf8")) } catch { return fallback }
}

export function writeJson(name, value) {
  ensureDir()
  writeFileSync(file(name), `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

export function loadState() {
  return readJson("state.json", {
    schema: "wake.paper.state.v1",
    startedAt: null,
    equityUsd: STARTING_EQUITY_USD,
    realizedPnlUsd: 0,
    openPositions: [],
    lastLogged: {},
    tickCount: 0,
  })
}

export function saveState(state) {
  writeJson("state.json", state)
}
