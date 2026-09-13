import { appendFile, mkdir, readFile } from "node:fs/promises"
import path from "node:path"
import { get, list, put } from "@vercel/blob"

export type RuntimeRecord = Record<string, unknown>

function runtimeDirectory() {
  return process.env.WAKE_RUNTIME_DIR ? path.resolve(process.env.WAKE_RUNTIME_DIR) : path.resolve("data", "runtime")
}

export function runtimeStoreStatus() {
  const configured = Boolean(process.env.WAKE_RUNTIME_DIR)
  const serverless = process.env.VERCEL === "1"
  const blobConfigured = Boolean(process.env.BLOB_READ_WRITE_TOKEN)
  return {
    configured: configured || blobConfigured,
    durable: blobConfigured || (configured && !serverless),
    mode: blobConfigured ? "vercel-blob" : serverless && !configured ? "unconfigured-serverless" : configured ? "configured-append-only" : "local-append-only",
    note: blobConfigured ? "Private Vercel Blob objects provide hosted append-only history." : serverless && !configured ? "Set BLOB_READ_WRITE_TOKEN before relying on hosted history." : "Append-only JSONL records are available to server routes.",
  }
}

export async function appendRuntimeRecord(namespace: string, record: RuntimeRecord) {
  const status = runtimeStoreStatus()
  if (status.mode === "unconfigured-serverless") return { persisted: false, status }
  if (status.mode === "vercel-blob") {
    await put(`wake/${namespace}/${Date.now()}-${crypto.randomUUID()}.json`, JSON.stringify(record), { access: "private", contentType: "application/json", addRandomSuffix: false })
    return { persisted: true, status }
  }
  const directory = runtimeDirectory()
  await mkdir(directory, { recursive: true })
  await appendFile(path.join(directory, `${namespace}.jsonl`), `${JSON.stringify(record)}\n`, "utf8")
  return { persisted: true, status }
}

export async function readRuntimeRecords<T extends RuntimeRecord>(namespace: string, limit = 100) {
  if (runtimeStoreStatus().mode === "vercel-blob") {
    const listed = await list({ prefix: `wake/${namespace}/`, limit: Math.max(limit, 1000) })
    const records: T[] = []
    for (const blob of listed.blobs.slice(-limit)) {
      const fetched = await get(blob.url, { access: "private", useCache: false })
      if (fetched?.statusCode === 200) records.push(JSON.parse(await new Response(fetched.stream).text()) as T)
    }
    return records
  }
  const filePath = path.join(runtimeDirectory(), `${namespace}.jsonl`)
  try {
    const text = await readFile(filePath, "utf8")
    return text.split(/\r?\n/).filter(Boolean).slice(-limit).map((line) => JSON.parse(line) as T)
  } catch {
    return [] as T[]
  }
}
