import { useReadContracts } from 'wagmi'
import { sepolia } from 'wagmi/chains'
import { oracleAbi } from '@/lib/abi'
import { ORACLE_ADDRESSES, ASSETS, type AssetKey } from '@/lib/contracts'

export interface BenchmarkData {
  rate: bigint
  supply: bigint
  spread: bigint
  vol: bigint
  term7d: bigint
  updated: bigint
  sources: bigint
  configured: bigint
}

export interface AssetBenchmark {
  asset: AssetKey
  data: BenchmarkData | null
  isLoading: boolean
}

export function useOracleData() {
  const contracts = ASSETS.map((asset) => ({
    address: ORACLE_ADDRESSES[asset],
    abi: oracleAbi,
    functionName: 'getFullBenchmark' as const,
    chainId: sepolia.id,
  }))

  const { data, isLoading, refetch, error } = useReadContracts({
    contracts,
    query: {
      refetchInterval: 30_000,
    },
  })

  const benchmarks: AssetBenchmark[] = ASSETS.map((asset, i) => {
    const result = data?.[i]
    if (result?.status === 'success' && result.result) {
      const [rate, supply, spread, vol, term7d, updated, sources, configured] =
        result.result as [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint]
      return {
        asset,
        data: { rate, supply, spread, vol, term7d, updated, sources, configured },
        isLoading: false,
      }
    }
    return { asset, data: null, isLoading }
  })

  return { benchmarks, isLoading, refetch, error }
}

export function useSingleOracle(asset: AssetKey) {
  const { data, isLoading } = useReadContracts({
    contracts: [
      {
        address: ORACLE_ADDRESSES[asset],
        abi: oracleAbi,
        functionName: 'getFullBenchmark',
        chainId: sepolia.id,
      },
      {
        address: ORACLE_ADDRESSES[asset],
        abi: oracleAbi,
        functionName: 'historyIndex',
        chainId: sepolia.id,
      },
    ],
    query: { refetchInterval: 30_000 },
  })

  const benchmarkResult = data?.[0]
  const historyResult = data?.[1]

  let benchmark: BenchmarkData | null = null
  if (benchmarkResult?.status === 'success' && benchmarkResult.result) {
    const [rate, supply, spread, vol, term7d, updated, sources, configured] =
      benchmarkResult.result as [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint]
    benchmark = { rate, supply, spread, vol, term7d, updated, sources, configured }
  }

  const historyIndex =
    historyResult?.status === 'success' ? (historyResult.result as bigint) : 0n

  return { benchmark, historyIndex, isLoading }
}
