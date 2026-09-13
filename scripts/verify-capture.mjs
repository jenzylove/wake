import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"

const input = process.argv[2] || "data/incidents/inc-real-moonwell-20260827.json"
const filePath = path.resolve(input)
const parsed = JSON.parse(await readFile(filePath, "utf8"))
const { integrity, ...packet } = parsed
const actual = createHash("sha256").update(JSON.stringify(packet)).digest("hex")
const ok = typeof integrity === "string" && integrity === actual
console.log(JSON.stringify({ filePath, ok, expected: integrity, actual }, null, 2))
process.exit(ok ? 0 : 1)
