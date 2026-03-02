import { useReadContracts } from 'wagmi'
import { sepolia } from 'wagmi/chains'
import { oracleAbi } from '@/lib/abi'
import { ORACLE_ADDRESSES, ASSETS, type AssetKey } from '@/lib/contracts'

const SPARKLINE_PERIODS = 48 // 24 hours of data at 30-min intervals

export function useSparklineData() {
  const contracts = ASSETS.flatMap((asset) =>
    Array.from({ length: SPARKLINE_PERIODS }, (_, i) => ({
      address: ORACLE_ADDRESSES[asset],
      abi: oracleAbi,
      functionName: 'getHistoricalRate' as const,
      args: [BigInt(i)] as const,
      chainId: sepolia.id,
    })),
  )

  const { data, isLoading } = useReadContracts({
    contracts,
    query: {
      refetchInterval: 120_000,
      staleTime: 60_000,
    },
  })

  const sparklines: Record<AssetKey, number[]> = {
    USDC: [],
    ETH: [],
    BTC: [],
    DAI: [],
    USDT: [],
  }

  if (data) {
    ASSETS.forEach((asset, assetIdx) => {
      const rates: number[] = []
      for (let i = 0; i < SPARKLINE_PERIODS; i++) {
        const result = data[assetIdx * SPARKLINE_PERIODS + i]
        if (result?.status === 'success') {
          rates.push(Number(result.result as bigint))
        } else {
          rates.push(0)
        }
      }
      // Reverse so oldest is first (index 47 = oldest, index 0 = newest)
      sparklines[asset] = rates.reverse()
    })
  }

  return { sparklines, isLoading }
}
