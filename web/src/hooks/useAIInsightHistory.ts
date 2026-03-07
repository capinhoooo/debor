import { useReadContract, useReadContracts } from 'wagmi'
import { sepolia } from 'wagmi/chains'
import { aiInsightAbi } from '@/lib/abi'
import { AI_INSIGHT_ADDRESS } from '@/lib/contracts'

export interface HistoricalRiskEntry {
  periodsBack: number
  riskScore: number
}

export function useAIInsightHistory() {
  const { data: indexData } = useReadContract({
    address: AI_INSIGHT_ADDRESS,
    abi: aiInsightAbi,
    functionName: 'insightIndex',
    chainId: sepolia.id,
    query: { refetchInterval: 60_000 },
  })

  const totalEntries = indexData !== undefined ? Math.min(Number(indexData as bigint), 48) : 0

  const contracts = Array.from({ length: totalEntries }, (_, i) => ({
    address: AI_INSIGHT_ADDRESS as `0x${string}`,
    abi: aiInsightAbi,
    functionName: 'getHistoricalRiskScore' as const,
    args: [BigInt(i)] as const,
    chainId: sepolia.id,
  }))

  const { data, isLoading } = useReadContracts({
    contracts,
    query: { refetchInterval: 60_000, enabled: totalEntries > 0 },
  })

  const history: HistoricalRiskEntry[] = []
  if (data) {
    for (let i = 0; i < totalEntries; i++) {
      const result = data[i]
      if (result?.status === 'success') {
        history.push({
          periodsBack: i,
          riskScore: Number(result.result as bigint),
        })
      }
    }
  }

  return { history, totalEntries, isLoading }
}
