const ETHERSCAN_API = "https://api.etherscan.io/v2/api"

export type ChainReceipt = {
  transactionHash: string
  blockNumber: string
  blockHash: string
  from: string
  to: string | null
  status: string
  gasUsed: string
  logs: unknown[]
}

async function rpcReceipt(rpcUrl: string, txHash: string) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [txHash] }),
  })
  const payload = await response.json() as { result?: ChainReceipt; error?: { message?: string } }
  if (!response.ok || payload.error) throw new Error(payload.error?.message || "RPC receipt request failed")
  if (!payload.result) throw new Error("Transaction receipt was not found")
  return payload.result
}

async function etherscanReceipt(apiKey: string, chainId: string, txHash: string) {
  const url = new URL(ETHERSCAN_API)
  url.search = new URLSearchParams({
    chainid: chainId,
    module: "proxy",
    action: "eth_getTransactionReceipt",
    txhash: txHash,
    apikey: apiKey,
  }).toString()
  const response = await fetch(url)
  const payload = await response.json() as { result?: ChainReceipt; message?: string }
  if (!response.ok || !payload.result) throw new Error(payload.message || "Etherscan receipt request failed")
  return payload.result
}

export async function getChainReceipt({ chainId, txHash }: { chainId: string; txHash: string }) {
  const rpcUrl = process.env.CHAIN_RPC_URL
  const etherscanKey = process.env.ETHERSCAN_API_KEY
  if (rpcUrl) return rpcReceipt(rpcUrl, txHash)
  if (etherscanKey) return etherscanReceipt(etherscanKey, chainId, txHash)
  throw new Error("Configure CHAIN_RPC_URL or ETHERSCAN_API_KEY for chain evidence")
}

export function chainEvidenceConfigStatus() {
  return {
    rpcConfigured: Boolean(process.env.CHAIN_RPC_URL),
    etherscanConfigured: Boolean(process.env.ETHERSCAN_API_KEY),
    configured: Boolean(process.env.CHAIN_RPC_URL || process.env.ETHERSCAN_API_KEY),
  }
}
