import { useQuery } from '@tanstack/react-query'

const DEFILLAMA_BASE = 'https://api.llama.fi'

export const PROTOCOL_SLUGS = [
  { protocol: 'Aave V3', slug: 'aave-v3' },
  { protocol: 'Compound', slug: 'compound-finance' },
  { protocol: 'Morpho', slug: 'morpho' },
  { protocol: 'Spark', slug: 'spark' },
  { protocol: 'Moonwell', slug: 'moonwell' },
  { protocol: 'Benqi', slug: 'benqi-lending' },
] as const

export interface ProtocolTVL {
  protocol: string
  tvl: number
}

async function fetchAllTVLs(): Promise<ProtocolTVL[]> {
  const results = await Promise.allSettled(
    PROTOCOL_SLUGS.map(async ({ protocol, slug }) => {
      const res = await fetch(`${DEFILLAMA_BASE}/tvl/${slug}`)
      if (!res.ok) return { protocol, tvl: 0 }
      const tvl = await res.json()
      return { protocol, tvl: typeof tvl === 'number' ? tvl : 0 }
    }),
  )

  return results.map((r) =>
    r.status === 'fulfilled' ? r.value : { protocol: 'Unknown', tvl: 0 },
  )
}

export function useProtocolTVL() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['protocol-tvl'],
    queryFn: fetchAllTVLs,
    staleTime: 5 * 60 * 1000, // 5 min
    refetchInterval: 5 * 60 * 1000,
    retry: 2,
  })

  return {
    tvls: data ?? [],
    isLoading,
    error,
  }
}
