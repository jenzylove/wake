// Screenshot helper: real browser, real scrolling, WebGL on.
// usage: node shot.mjs <url> <outDir> [width] [height]
import { chromium } from "playwright"

const url = process.argv[2]
const out = process.argv[3]
const width = Number(process.argv[4] || 1440)
const height = Number(process.argv[5] || 900)

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
})
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
// The hero runs a rAF loop, which keeps the page from going idle and makes the
// screenshot stability check time out. Reduced motion renders one frame and
// stops, which the orb component already honours.
await page.emulateMedia({ reducedMotion: "reduce" })
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 })
// Let fonts settle and the render loop produce a few frames.
await page.waitForTimeout(4000)

await page.screenshot({ path: `${out}/hero.png`, timeout: 20000, animations: "disabled" })

const shots = [
  ["workspace", 1.0],
  ["workspace2", 2.0],
  ["workspace3", 3.0],
]
for (const [name, mult] of shots) {
  await page.evaluate((m) => {
    const hero = document.querySelector(".wake-hero")
    const top = hero ? hero.getBoundingClientRect().height + window.innerHeight * (m - 1) : window.innerHeight * m
    window.scrollTo(0, top)
  }, mult)
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 20000, animations: "disabled" })
}

const doc = await page.evaluate(() => ({
  scrollHeight: document.documentElement.scrollHeight,
  heroHeight: document.querySelector(".wake-hero")?.getBoundingClientRect().height ?? null,
  headers: document.querySelectorAll("header").length,
  canvas: !!document.querySelector(".orb-canvas"),
  fallback: !!document.querySelector(".orb-fallback"),
}))
console.log(JSON.stringify(doc, null, 2))

await browser.close()
