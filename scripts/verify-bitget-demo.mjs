import { createHmac } from "node:crypto"
import https from "node:https"

const apiKey = process.env.BITGET_API_KEY
const secretKey = process.env.BITGET_SECRET_KEY
const passphrase = process.env.BITGET_PASSPHRASE
if (!apiKey || !secretKey || !passphrase) {
  console.error("Missing BITGET_API_KEY, BITGET_SECRET_KEY, or BITGET_PASSPHRASE")
  process.exit(2)
}

const requestPath = "/api/v2/mix/account/account?marginCoin=USDT&productType=USDT-FUTURES&symbol=BTCUSDT"
const timestamp = String(Date.now())
const signature = createHmac("sha256", secretKey)
  .update(`${timestamp}GET${requestPath}`)
  .digest("base64")

const hostname = process.env.BITGET_API_IP || "api.bitget.com"
const request = https.request({
  hostname,
  port: 443,
  servername: "api.bitget.com",
  path: requestPath,
  method: "GET",
  headers: {
    Host: "api.bitget.com",
    "ACCESS-KEY": apiKey,
    "ACCESS-SIGN": signature,
    "ACCESS-TIMESTAMP": timestamp,
    "ACCESS-PASSPHRASE": passphrase,
    "Content-Type": "application/json",
    locale: "en-US",
    paptrading: "1",
  },
}, (response) => {
  let body = ""
  response.on("data", (chunk) => { body += chunk })
  response.on("end", () => {
    try {
      const payload = JSON.parse(body)
      const ok = payload.code === "00000"
      console.log(JSON.stringify({
        ok,
        demo: true,
        httpStatus: response.statusCode,
        code: payload.code,
        msg: payload.msg,
        paptrading: "1",
        accountDataPresent: payload.data !== undefined,
      }, null, 2))
      process.exit(ok ? 0 : 1)
    } catch {
      console.error(`Bitget returned a non-JSON response (HTTP ${response.statusCode})`)
      process.exit(1)
    }
  })
})

request.on("error", (error) => {
  console.error(`Bitget Demo Trading connection failed: ${error.message}`)
  process.exit(1)
})
request.end()
