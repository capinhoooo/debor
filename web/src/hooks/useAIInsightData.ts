import { useReadContracts } from 'wagmi'
import { sepolia } from 'wagmi/chains'
import { aiInsightAbi } from '@/lib/abi'
import { AI_INSIGHT_ADDRESS } from '@/lib/contracts'

const RISK_LEVELS = ['Low', 'Medium', 'High', 'Critical'] as const
const RATE_DIRECTIONS = ['Stable', 'Rising', 'Falling'] as const
const SPREAD_HEALTH = ['Normal', 'Compressed', 'Inverted'] as const
const MARKET_REGIMES = ['Converged', 'Normal', 'Diverged', 'Dislocated'] as const

export type RiskLevel = (typeof RISK_LEVELS)[number]
export type RateDirection = (typeof RATE_DIRECTIONS)[number]
export type SpreadHealth = (typeof SPREAD_HEALTH)[number]
export type MarketRegime = (typeof MARKET_REGIMES)[number]

export interface AIInsightData {
  riskLevel: RiskLevel
  riskLevelRaw: number
  rateDirection: RateDirection
  spreadHealth: SpreadHealth
  marketRegime: MarketRegime
  riskScore: number
  anomalyDetected: boolean
  lastAnalyzedAt: number
  isHighRisk: boolean
  insightIndex: number
}

export function useAIInsightData() {
  const { data, isLoading, error } = useReadContracts({
    contracts: [
      {
        address: AI_INSIGHT_ADDRESS,
        abi: aiInsightAbi,
        functionName: 'getInsight',
        chainId: sepolia.id,
      },
      {
        address: AI_INSIGHT_ADDRESS,
        abi: aiInsightAbi,
        functionName: 'isHighRisk',
        chainId: sepolia.id,
      },
      {
        address: AI_INSIGHT_ADDRESS,
        abi: aiInsightAbi,
        functionName: 'insightIndex',
        chainId: sepolia.id,
      },
    ],
    query: { refetchInterval: 30_000 },
  })

  let insight: AIInsightData | null = null

  if (data) {
    const insightResult = data[0]
    const highRisk = data[1]
    const index = data[2]

    const allSuccess =
      insightResult?.status === 'success' &&
      highRisk?.status === 'success' &&
      index?.status === 'success'

    if (allSuccess) {
      const [rl, rd, sh, mr, score, anomaly, timestamp] = insightResult.result as [
        number,
        number,
        number,
        number,
        bigint,
        boolean,
        bigint,
      ]

      insight = {
        riskLevel: RISK_LEVELS[rl] ?? 'Low',
        riskLevelRaw: rl,
        rateDirection: RATE_DIRECTIONS[rd] ?? 'Stable',
        spreadHealth: SPREAD_HEALTH[sh] ?? 'Normal',
        marketRegime: MARKET_REGIMES[mr] ?? 'Normal',
        riskScore: Number(score),
        anomalyDetected: anomaly,
        lastAnalyzedAt: Number(timestamp),
        isHighRisk: highRisk.result as boolean,
        insightIndex: Number(index.result as bigint),
      }
    }
  }

  return { insight, isLoading, error }
}
