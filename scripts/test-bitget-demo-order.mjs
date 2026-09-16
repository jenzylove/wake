import { createHmac } from "node:crypto"
import https from "node:https"

if (!process.argv.includes("--confirm-demo-order")) {
  throw new Error("This smoke test can place and close one minimum-size Demo order. Re-run with --confirm-demo-order to authorize it.")
}
if (process.env.WAKE_EXECUTION_MODE !== "bitget-demo") {
  throw new Error("Set WAKE_EXECUTION_MODE=bitget-demo for this one-time Demo smoke test; paper remains the default.")
}

const apiKey = process.env.BITGET_API_KEY
const secretKey = process.env.BITGET_SECRET_KEY
const passphrase = process.env.BITGET_PASSPHRASE
if (!apiKey || !secretKey || !passphrase) throw new Error("Missing Bitget Demo credentials")

const symbol = "BTCUSDT"
const contract = await request("GET", `/api/v2/mix/market/contracts?productType=USDT-FUTURES&symbol=${symbol}`)
const metadata = contract.data?.[0]
if (!metadata?.minTradeNum || !metadata?.minTradeUSDT) throw new Error("Bitget returned incomplete BTCUSDT contract metadata")
const size = metadata.minTradeNum
const minimumNotional = Number(metadata.minTradeUSDT)
if (!Number.isFinite(minimumNotional) || minimumNotional <= 0) throw new Error("Bitget returned an invalid minimum notional")

const account = await request("GET", "/api/v2/mix/account/account?marginCoin=USDT&productType=USDT-FUTURES&symbol=BTCUSDT", "", true)
const posSide = account.data?.posMode === "hedge_mode" ? "long" : undefined
const openOid = `wake-smoke-open-${Date.now()}`
const opened = await request("POST", "/api/v2/mix/order/place-order", JSON.stringify({ symbol, productType: "USDT-FUTURES", marginMode: "isolated", marginCoin: "USDT", size, side: "buy", tradeSide: "open", ...(posSide ? { posSide } : {}), orderType: "market", force: "gtc", clientOid: openOid }), true)
const openOrderId = opened.data?.orderId || opened.data?.clientOid || openOid

await new Promise((resolve) => setTimeout(resolve, 1500))
let closeError = null
let closed = null
try {
  const closeOid = `wake-smoke-close-${Date.now()}`
  closed = await request("POST", "/api/v2/mix/order/place-order", JSON.stringify({ symbol, productType: "USDT-FUTURES", marginMode: "isolated", marginCoin: "USDT", size, side: posSide === "long" ? "buy" : "sell", tradeSide: "close", ...(posSide ? { posSide } : {}), orderType: "market", force: "gtc", clientOid: closeOid }), true)
} catch (error) {
  closeError = error instanceof Error ? error.message : "Close order failed"
}

console.log(JSON.stringify({
  ok: !closeError,
  demo: true,
  symbol,
  minimumSize: size,
  minimumNotional,
  accountRead: account.code === "00000",
  openOrderId,
  closeOrderId: closed?.data?.orderId || closed?.data?.clientOid || null,
  closeError,
  paptrading: "1",
  note: closeError ? "The Demo open was accepted but the automatic close failed; inspect the Demo position before retrying." : "Minimum-size Demo order opened and immediately closed.",
}, null, 2))
if (closeError) process.exit(1)

async function request(method, requestPath, body = "", signed = false) {
  const timestamp = String(Date.now())
  const signature = signed ? createHmac("sha256", secretKey).update(`${timestamp}${method}${requestPath}${body}`).digest("base64") : null
  const headers = {
    Host: "api.bitget.com",
    "Content-Type": "application/json",
    locale: "en-US",
    ...(signed ? { "ACCESS-KEY": apiKey, "ACCESS-SIGN": signature, "ACCESS-TIMESTAMP": timestamp, "ACCESS-PASSPHRASE": passphrase, paptrading: "1" } : {}),
  }
  const hostname = process.env.BITGET_API_IP || "api.bitget.com"
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, port: 443, servername: "api.bitget.com", path: requestPath, method, headers }, (response) => {
      let bodyText = ""
      response.on("data", (chunk) => { bodyText += chunk })
      response.on("end", () => {
        try {
          const payload = JSON.parse(bodyText)
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
