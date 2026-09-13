import { createHmac } from "node:crypto"
import https from "node:https"

if (!process.argv.includes("--confirm-demo-close")) throw new Error("Re-run with --confirm-demo-close to authorize closing the identified Demo position")
const expectedSize = process.argv[process.argv.indexOf("--size") + 1] || "0.0001"
if (process.env.WAKE_EXECUTION_MODE !== "bitget-demo") throw new Error("Set WAKE_EXECUTION_MODE=bitget-demo for this one-time Demo close")
const apiKey = process.env.BITGET_API_KEY
const secretKey = process.env.BITGET_SECRET_KEY
const passphrase = process.env.BITGET_PASSPHRASE
if (!apiKey || !secretKey || !passphrase) throw new Error("Missing Bitget Demo credentials")

const positions = await request("GET", "/api/v2/mix/position/all-position?productType=USDT-FUTURES&marginCoin=USDT", "", true)
const position = positions.data?.find((item) => item.symbol === "BTCUSDT" && item.holdSide === "long" && item.total === expectedSize)
if (!position) throw new Error(`No exact BTCUSDT long position with size ${expectedSize} was found; no close was sent`)

const clientOid = `wake-smoke-close-${Date.now()}`
const closed = await request("POST", "/api/v2/mix/order/place-order", JSON.stringify({ symbol: "BTCUSDT", productType: "USDT-FUTURES", marginMode: "isolated", marginCoin: "USDT", size: expectedSize, side: "buy", tradeSide: "close", posSide: "long", orderType: "market", force: "gtc", clientOid }), true)
await new Promise((resolve) => setTimeout(resolve, 1500))
const remaining = await request("GET", "/api/v2/mix/position/all-position?productType=USDT-FUTURES&marginCoin=USDT", "", true)
const stillOpen = remaining.data?.filter((item) => item.symbol === "BTCUSDT" && item.holdSide === "long" && Number(item.total) > 0) || []
console.log(JSON.stringify({ demo: true, paptrading: "1", closedOrderId: closed.data?.orderId || closed.data?.clientOid || clientOid, closedSize: expectedSize, remainingLongPositions: stillOpen, ok: stillOpen.length === 0 }, null, 2))
if (stillOpen.length > 0) process.exit(1)

async function request(method, requestPath, body = "", signed = false) {
  const timestamp = String(Date.now())
  const signature = signed ? createHmac("sha256", secretKey).update(`${timestamp}${method}${requestPath}${body}`).digest("base64") : null
  const headers = { Host: "api.bitget.com", "Content-Type": "application/json", locale: "en-US", ...(signed ? { "ACCESS-KEY": apiKey, "ACCESS-SIGN": signature, "ACCESS-TIMESTAMP": timestamp, "ACCESS-PASSPHRASE": passphrase, paptrading: "1" } : {}) }
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: process.env.BITGET_API_IP || "104.18.14.166", port: 443, servername: "api.bitget.com", path: requestPath, method, headers }, (response) => {
      let text = ""
      response.on("data", (chunk) => { text += chunk })
      response.on("end", () => {
        try {
          const payload = JSON.parse(text)
          if (response.statusCode < 200 || response.statusCode >= 300 || payload.code !== "00000") throw new Error(payload.msg || `Bitget returned HTTP ${response.statusCode}`)
          resolve(payload)
        } catch (error) {
          reject(error)
        }
      })
    })
    req.on("error", reject)
    if (body) req.write(body)
    req.end()
  })
}
