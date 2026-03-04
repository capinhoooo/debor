import { useMemo } from 'react'
import { useReadContracts } from 'wagmi'
import { sepolia } from 'wagmi/chains'
import { oracleAbi } from '@/lib/abi'
import { ORACLE_ADDRESSES } from '@/lib/contracts'
import { useOracleData } from '@/hooks/useOracleData'
import { useProtocolTVL } from '@/hooks/useProtocolTVL'
import { useSOFRData, percentToBps } from '@/hooks/useSOFRData'
import {
  computeVaR,
  computeHHI,
  computeRiskBreakdown,
  runStressTests,
  type VaRMetrics,
  type HHIMetrics,
  type RiskBreakdown,
  type StressResult,
} from '@/utils/risk'

export interface RiskMetricsData {
  var: VaRMetrics
  hhi: HHIMetrics
  breakdown: RiskBreakdown
  stressResults: StressResult[]
  sofrSpreadBps: number
}

export function useRiskMetrics() {
  const { benchmarks, isLoading: oracleLoading } = useOracleData()
  const { tvls, isLoading: tvlLoading } = useProtocolTVL()
  const { sofr, isLoading: sofrLoading } = useSOFRData()

  // Fetch previous rate (1 period ago) for USDC oracle for VaR calculation
  const { data: prevRateData, isLoading: prevLoading } = useReadContracts({
    contracts: [
      {
        address: ORACLE_ADDRESSES.USDC,
        abi: oracleAbi,
        functionName: 'getHistoricalRate',
        args: [1n],
        chainId: sepolia.id,
      },
    ],
    query: { refetchInterval: 60_000 },
  })

  const metrics = useMemo<RiskMetricsData | null>(() => {
    const usdc = benchmarks.find((b) => b.asset === 'USDC')
    if (!usdc?.data) return null

    const currentRate = Number(usdc.data.rate)
    const vol = Number(usdc.data.vol)
    const sources = Number(usdc.data.sources)
    const configured = Number(usdc.data.configured)
    const uptimeRatio = configured > 0 ? sources / configured : 1

    const previousRate =
      prevRateData?.[0]?.status === 'success'
        ? Number(prevRateData[0].result as bigint)
        : currentRate

    const varMetrics = computeVaR(currentRate, previousRate, vol)
    const hhiMetrics = computeHHI(tvls)

    const sofrBps = sofr ? percentToBps(sofr.percentRate) : 0
    const sofrSpreadBps = currentRate - sofrBps

    const breakdown = computeRiskBreakdown(
      varMetrics.var99,
      hhiMetrics.hhi,
      uptimeRatio,
      sofrSpreadBps,
      vol,
    )

    const stressResults = runStressTests(
      currentRate,
      varMetrics.var99,
      hhiMetrics.maxWeight,
    )

    return { var: varMetrics, hhi: hhiMetrics, breakdown, stressResults, sofrSpreadBps }
  }, [benchmarks, tvls, sofr, prevRateData])

  return {
    metrics,
    isLoading: oracleLoading || tvlLoading || sofrLoading || prevLoading,
  }
}
