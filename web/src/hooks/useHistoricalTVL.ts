import { useQuery } from '@tanstack/react-query'
import { PROTOCOL_SLUGS } from '@/hooks/useProtocolTVL'
import type { AssetKey } from '@/lib/contracts'

const DEFILLAMA_BASE = 'https://api.llama.fi'

// Map DeBOR asset keys to DefiLlama token names (including wrapped variants)
const ASSET_TOKENS: Record<AssetKey, string[]> = {
  USDC: ['USDC', 'USDC.e'],
  ETH: ['WETH', 'ETH', 'stETH', 'wstETH', 'cbETH', 'rETH'],
  BTC: ['WBTC', 'BTC', 'cbBTC', 'tBTC'],
  DAI: ['DAI', 'sDAI'],
  USDT: ['USDT'],
}

export interface DailyTVL {
  date: number // unix timestamp (seconds)
  tvl: number  // USD value
}

interface HistoricalTVLData {
  aggregate: DailyTVL[]
  byAsset: Record<string, DailyTVL[]>
}

async function fetchHistoricalTVL(): Promise<HistoricalTVLData> {
  const results = await Promise.allSettled(
    PROTOCOL_SLUGS.map(async ({ slug }) => {
      const res = await fetch(`${DEFILLAMA_BASE}/protocol/${slug}`)
      if (!res.ok) return { tvl: [], tokensInUsd: [] }
      const json = await res.json()
      const ethChain = json.chainTvls?.Ethereum
      return {
        tvl: (json.tvl ?? []) as { date: number; totalLiquidityUSD: number }[],
        tokensInUsd: (ethChain?.tokensInUsd ?? []) as { date: number; tokens: Record<string, number> }[],
      }
    }),
  )

  // Aggregate TVL by date
  const byDate = new Map<number, number>()
  // Per-token TVL by date
  const tokenByDate = new Map<string, Map<number, number>>()

  for (const r of results) {
    if (r.status !== 'fulfilled') continue

    for (const entry of r.value.tvl) {
      const day = Math.floor(entry.date / 86400) * 86400
      byDate.set(day, (byDate.get(day) ?? 0) + entry.totalLiquidityUSD)
    }

    for (const entry of r.value.tokensInUsd) {
      const day = Math.floor(entry.date / 86400) * 86400
      for (const [token, amount] of Object.entries(entry.tokens)) {
        if (!tokenByDate.has(token)) tokenByDate.set(token, new Map())
        const map = tokenByDate.get(token)!
        map.set(day, (map.get(day) ?? 0) + amount)
      }
    }
  }

  const toSorted = (m: Map<number, number>) =>
    Array.from(m.entries())
      .sort((a, b) => a[0] - b[0])
      .slice(-90)
      .map(([date, tvl]) => ({ date, tvl }))

  const aggregate = toSorted(byDate)

  // Group DefiLlama tokens into our asset keys
  const byAsset: Record<string, DailyTVL[]> = {}
  for (const [assetKey, tokenNames] of Object.entries(ASSET_TOKENS)) {
    const merged = new Map<number, number>()
    for (const name of tokenNames) {
      const data = tokenByDate.get(name)
      if (!data) continue
      for (const [day, amount] of data) {
        merged.set(day, (merged.get(day) ?? 0) + amount)
      }
    }
    if (merged.size > 0) byAsset[assetKey] = toSorted(merged)
  }

  return { aggregate, byAsset }
}

export function useHistoricalTVL(asset?: AssetKey) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['historical-tvl'],
    queryFn: fetchHistoricalTVL,
    staleTime: 30 * 60 * 1000,
    refetchInterval: 30 * 60 * 1000,
    retry: 2,
  })

  const tvlHistory = asset && data?.byAsset[asset]
    ? data.byAsset[asset]
    : data?.aggregate ?? []

  return { tvlHistory, isLoading, error }
}
