import { createHmac } from "node:crypto"
import https from "node:https"

const orderId = process.argv[2]
if (!orderId) throw new Error("Pass the Bitget Demo order ID to inspect")
const apiKey = process.env.BITGET_API_KEY
const secretKey = process.env.BITGET_SECRET_KEY
const passphrase = process.env.BITGET_PASSPHRASE
if (!apiKey || !secretKey || !passphrase) throw new Error("Missing Bitget Demo credentials")

const detail = await request("GET", `/api/v2/mix/order/detail?symbol=BTCUSDT&productType=USDT-FUTURES&orderId=${encodeURIComponent(orderId)}`)
const positions = await request("GET", "/api/v2/mix/position/all-position?productType=USDT-FUTURES&marginCoin=USDT")
const account = await request("GET", "/api/v2/mix/account/account?marginCoin=USDT&productType=USDT-FUTURES&symbol=BTCUSDT")
console.log(JSON.stringify({ demo: true, paptrading: "1", order: detail.data, positions: positions.data, account: { posMode: account.data?.posMode, marginMode: account.data?.marginMode } }, null, 2))

async function request(method, requestPath) {
  const timestamp = String(Date.now())
  const signature = createHmac("sha256", secretKey).update(`${timestamp}${method}${requestPath}`).digest("base64")
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: process.env.BITGET_API_IP || "api.bitget.com", port: 443, servername: "api.bitget.com", path: requestPath, method, headers: { Host: "api.bitget.com", "Content-Type": "application/json", locale: "en-US", "ACCESS-KEY": apiKey, "ACCESS-SIGN": signature, "ACCESS-TIMESTAMP": timestamp, "ACCESS-PASSPHRASE": passphrase, paptrading: "1" } }, (response) => {
      let text = ""
      response.on("data", (chunk) => { text += chunk })
      response.on("end", () => {
        try {
          const payload = JSON.parse(text)
          if (payload.code !== "00000") throw new Error(payload.msg || `Bitget returned HTTP ${response.statusCode}`)
          resolve(payload)
        } catch (error) {
          reject(error)
        }
      })
    })
    req.on("error", reject)
    req.end()
  })
}
