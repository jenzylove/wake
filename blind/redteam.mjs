// Red team for the blind exploit challenge (PRD section 16A).
//
// Runs after WAKE is already watching the chain. Deploys a fresh, randomized protocol set:
// random names, random balances, random vault classes (one safe, the rest possibly vulnerable),
// lending markets that accept some vault shares as collateral, and borrowers. Publishes only the
// public registry a real system would have (names, Bitget instrument map, market caps) plus a
// SHA-256 commitment to the answer. Then, at a random moment, it runs an authorised decoy
// treasury sweep and the real exploit. The answer is revealed only after WAKE has decided.

import { createHash, randomBytes, randomInt } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { createPublicClient, createWalletClient, http, parseEther } from "viem"
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts"
import { foundry } from "viem/chains"

const RPC = process.env.BLIND_RPC || "http://127.0.0.1:8545"
const RUN_DIR = process.env.BLIND_RUN_DIR
if (!RUN_DIR) throw new Error("BLIND_RUN_DIR is required")
const art = (name) => JSON.parse(readFileSync(path.join(import.meta.dirname, "out", "Blind.sol", `${name}.json`), "utf8"))
const A = Object.fromEntries(["Token", "SafeVault", "VaultA", "VaultB", "VaultC", "LendingMarket", "VaultBAttack"].map((n) => [n, art(n)]))

// Anvil's well known development keys. Local chain only.
const DEV_KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
]
const pub = createPublicClient({ chain: foundry, transport: http(RPC) })
const wallet = (key) => createWalletClient({ account: privateKeyToAccount(key), chain: foundry, transport: http(RPC) })
const [deployer, ...users] = DEV_KEYS.map(wallet)
const attackerKey = generatePrivateKey()
const attacker = wallet(attackerKey)

const WORDS = ["Amber", "Basalt", "Cobalt", "Drift", "Ember", "Fjord", "Garnet", "Halo", "Iris", "Juniper", "Kestrel", "Lumen", "Mistral", "Nimbus", "Onyx", "Pollen", "Quartz", "Rune", "Sable", "Tundra", "Umber", "Vesper", "Willow", "Xenon", "Yarrow", "Zephyr"]
const SUFFIX = ["Vault", "Yield", "Earn", "Reserve", "Pool"]
// Perpetuals that exist on Bitget Demo Trading (probed 19 Sep 2026), so a cleared trade can execute.
const INSTRUMENTS = ["SOLUSDT", "AVAXUSDT", "LINKUSDT", "UNIUSDT", "NEARUSDT", "CRVUSDT", "DOTUSDT", "ADAUSDT", "XRPUSDT", "DOGEUSDT", "LTCUSDT", "BCHUSDT"]
const pick = (arr) => arr.splice(randomInt(arr.length), 1)[0]
const words = [...WORDS]
const instruments = [...INSTRUMENTS]
const shuffle = (arr) => { for (let i = arr.length - 1; i > 0; i -= 1) { const j = randomInt(i + 1); [arr[i], arr[j]] = [arr[j], arr[i]] } return arr }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function deploy(w, name, args) {
  const hash = await w.deployContract({ abi: A[name].abi, bytecode: A[name].bytecode.object, args })
  return (await pub.waitForTransactionReceipt({ hash })).contractAddress
}
async function send(w, address, name, functionName, args = []) {
  const hash = await w.writeContract({ address, abi: A[name].abi, functionName, args })
  const receipt = await pub.waitForTransactionReceipt({ hash })
  if (receipt.status !== "success") throw new Error(`${functionName} reverted`)
  return receipt
}
const units = (n) => parseEther(String(n))

async function main() {
  mkdirSync(RUN_DIR, { recursive: true })
  await deployer.sendTransaction({ to: attacker.account.address, value: parseEther("10") }).then((hash) => pub.waitForTransactionReceipt({ hash }))

  // Random number of throwaway transactions, so contract addresses differ run to run.
  for (let i = randomInt(1, 12); i > 0; i -= 1) await deployer.sendTransaction({ to: deployer.account.address, value: 1n }).then((hash) => pub.waitForTransactionReceipt({ hash }))

  // Stablecoin that lending markets lend out, and the underlying each vault holds.
  const usd = await deploy(deployer, "Token", [`${pick(words)} Dollar`, "xUSD"])
  const vaults = []
  const classes = ["SafeVault", ...Array.from({ length: 3 }, () => ["VaultA", "VaultB", "VaultC", "SafeVault"][randomInt(4)])]
  if (!classes.slice(1).some((c) => c !== "SafeVault")) classes[1] = ["VaultA", "VaultB", "VaultC"][randomInt(3)]
  for (const cls of shuffle(classes)) {
    const name = `${pick(words)} ${SUFFIX[randomInt(SUFFIX.length)]}`
    const underlying = await deploy(deployer, "Token", [`${name} Underlying`, `u${name.slice(0, 3).toUpperCase()}`])
    const vault = await deploy(deployer, cls, [underlying, name, `v${name.slice(0, 3).toUpperCase()}`])
    for (const u of users) {
      const amount = units(randomInt(20_000, 400_000))
      await send(deployer, underlying, "Token", "mint", [u.account.address, amount])
      await send(u, underlying, "Token", "approve", [vault, amount])
      await send(u, vault, cls, "deposit", [amount])
    }
    vaults.push({ name, class: cls, address: vault, underlying, instrument: pick(instruments), marketCapUsd: randomInt(2, 60) * 1_000_000 })
  }

  // One or two lending markets, each accepting a random vault's shares as collateral.
  const markets = []
  const nMarkets = 1 + randomInt(2)
  for (let i = 0; i < nMarkets; i += 1) {
    const collateral = vaults[randomInt(vaults.length)]
    const name = `${pick(words)} Lend`
    const market = await deploy(deployer, "LendingMarket", [collateral.address, usd])
    await send(deployer, usd, "Token", "mint", [market, units(5_000_000)])
    for (const u of users.slice(0, 2 + randomInt(3))) {
      const shares = await pub.readContract({ address: collateral.address, abi: A.Token.abi, functionName: "balanceOf", args: [u.account.address] })
      const supply = shares * BigInt(randomInt(40, 90)) / 100n
      await send(u, collateral.address, collateral.class, "approve", [market, supply])
      await send(u, market, "LendingMarket", "supply", [supply])
      const pps = await pub.readContract({ address: collateral.address, abi: A.SafeVault.abi, functionName: "pricePerShare" })
      const borrow = supply * pps / 10n ** 18n * BigInt(randomInt(50, 74)) / 100n
      await send(u, market, "LendingMarket", "borrow", [borrow])
    }
    markets.push({ name, address: market, collateralVault: collateral.address, instrument: pick(instruments), marketCapUsd: randomInt(3, 120) * 1_000_000 })
  }

  const vulnerable = vaults.filter((v) => v.class !== "SafeVault")
  const target = vulnerable[randomInt(vulnerable.length)]
  const decoy = vaults.find((v) => v.class === "SafeVault")
  const answer = {
    target: target.address, targetName: target.name, exploitClass: target.class,
    decoy: decoy.address, decoyName: decoy.name,
    contagionMarkets: markets.filter((m) => m.collateralVault === target.address).map((m) => m.address),
    salt: randomBytes(16).toString("hex"),
  }
  const commitment = createHash("sha256").update(JSON.stringify(answer)).digest("hex")

  // Public registry: what a curated exposure registry would hold. No relationships, no classes.
  const registry = {
    schema: "wake.blind.registry.v1",
    publishedAt: new Date().toISOString(),
    chainId: foundry.id,
    stablecoins: [usd],
    protocols: [
      ...vaults.map((v) => ({ name: v.name, address: v.address, instrument: v.instrument, marketCapUsd: v.marketCapUsd })),
      ...markets.map((m) => ({ name: m.name, address: m.address, instrument: m.instrument, marketCapUsd: m.marketCapUsd })),
    ],
    tokenPricesUsd: Object.fromEntries([[usd, 1], ...vaults.map((v) => [v.underlying, 1])]),
    answerCommitment: commitment,
  }
  writeFileSync(path.join(RUN_DIR, "registry.json"), JSON.stringify(registry, null, 2) + "\n")
  console.log(JSON.stringify({ phase: "deployed", vaults: vaults.length, markets: markets.length, commitment }))

  // Random quiet period, then the decoy and the exploit in random order.
  await sleep(randomInt(5_000, 20_000))
  const decoyFirst = randomInt(2) === 0
  const doDecoy = async () => {
    const bal = await pub.readContract({ address: decoy.underlying, abi: A.Token.abi, functionName: "balanceOf", args: [decoy.address] })
    await send(deployer, decoy.address, "SafeVault", "sweep", [deployer.account.address, bal * 6n / 10n])
  }
  const doAttack = async () => {
    if (target.class === "VaultA") return send(attacker, target.address, "VaultA", "emergencyExit", [attacker.account.address])
    if (target.class === "VaultB") {
      const helper = await deploy(attacker, "VaultBAttack", [])
      return send(attacker, helper, "VaultBAttack", "run", [target.address, attacker.account.address])
    }
    // VaultC: redeem every large holder's shares to the attacker.
    for (const holder of [...users.map((u) => u.account.address), ...markets.map((m) => m.address)]) {
      const shares = await pub.readContract({ address: target.address, abi: A.Token.abi, functionName: "balanceOf", args: [holder] })
      if (shares > 0n) await send(attacker, target.address, "VaultC", "redeemFor", [holder, shares, attacker.account.address])
    }
  }
  if (decoyFirst) { await doDecoy(); await sleep(randomInt(2_000, 8_000)); await doAttack() }
  else { await doAttack(); await sleep(randomInt(2_000, 8_000)); await doDecoy() }
  const attackedAt = new Date().toISOString()
  writeFileSync(path.join(RUN_DIR, "answer.sealed.json"), JSON.stringify({ ...answer, attackedAt, attacker: attacker.account.address }, null, 2) + "\n")
  console.log(JSON.stringify({ phase: "attacked", attackedAt }))
}

main().catch((error) => { console.error(error); process.exit(1) })
