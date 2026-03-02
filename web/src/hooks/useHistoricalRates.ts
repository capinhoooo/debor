import { useReadContracts } from 'wagmi'
import { sepolia } from 'wagmi/chains'
import { oracleAbi } from '@/lib/abi'
import { ORACLE_ADDRESSES, type AssetKey } from '@/lib/contracts'

const HISTORY_SIZE = 336

export interface HistoricalRateData {
  rates: number[]
  min: number
  max: number
  avg: number
}

export function useHistoricalRates(asset: AssetKey) {
  const address = ORACLE_ADDRESSES[asset]

  const contracts = Array.from({ length: HISTORY_SIZE }, (_, i) => ({
    address,
    abi: oracleAbi,
    functionName: 'getHistoricalRate' as const,
    args: [BigInt(i)] as const,
    chainId: sepolia.id,
  }))

  const { data, isLoading } = useReadContracts({
    contracts,
    query: {
      refetchInterval: 60_000,
      staleTime: 30_000,
    },
  })

  let historical: HistoricalRateData | null = null

  if (data) {
    const rates: number[] = []
    for (let i = 0; i < data.length; i++) {
      const result = data[i]
      if (result?.status === 'success') {
        rates.push(Number(result.result as bigint))
      } else {
        rates.push(0)
      }
    }

    const nonZero = rates.filter((r) => r > 0)
    if (nonZero.length > 0) {
      historical = {
        rates,
        min: Math.min(...nonZero),
        max: Math.max(...nonZero),
        avg: Math.round(nonZero.reduce((a, b) => a + b, 0) / nonZero.length),
      }
    }
  }

  return { historical, isLoading }
}
