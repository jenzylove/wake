import { createHash } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

const input = process.argv[2]
const files = input
  ? [path.resolve(input)]
  : (await readdir(path.resolve("data", "incidents")))
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => path.resolve("data", "incidents", name))

if (files.length === 0) throw new Error("No JSON capture packets found")

const results = []
for (const filePath of files) {
  const parsed = JSON.parse(await readFile(filePath, "utf8"))
  const { integrity, ...packet } = parsed
  const actual = createHash("sha256").update(JSON.stringify(packet)).digest("hex")
  results.push({ filePath, incident: packet.incident?.id, ok: typeof integrity === "string" && integrity === actual, expected: integrity, actual })
}

const ok = results.every((result) => result.ok)
console.log(JSON.stringify({ ok, packets: results }, null, 2))
process.exit(ok ? 0 : 1)
