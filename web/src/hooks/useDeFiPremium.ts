import { useMemo } from 'react'
import { useOracleData } from '@/hooks/useOracleData'
import { useSOFRData, percentToBps } from '@/hooks/useSOFRData'
import { classifyRegime, type MarketRegime } from '@/utils/risk'

export interface AssetPremium {
  asset: string
  deborRateBps: number
  sofrBps: number
  premiumBps: number
  regime: MarketRegime
}

export interface PremiumSummary {
  assets: AssetPremium[]
  stablecoinAvgPremium: number
  sofrBps: number
}

export function useDeFiPremium() {
  const { benchmarks, isLoading: oracleLoading } = useOracleData()
  const { sofr, isLoading: sofrLoading } = useSOFRData()

  const summary = useMemo<PremiumSummary | null>(() => {
    if (!sofr || benchmarks.every((b) => b.data === null)) return null

    const sofrBps = percentToBps(sofr.percentRate)
    const stablecoins = ['USDC', 'DAI', 'USDT']

    const assets: AssetPremium[] = benchmarks
      .filter((b) => b.data !== null)
      .map((b) => {
        const deborRateBps = Number(b.data!.rate)
        const premiumBps = deborRateBps - sofrBps
        return {
          asset: b.asset,
          deborRateBps,
          sofrBps,
          premiumBps,
          regime: classifyRegime(premiumBps),
        }
      })

    const stablePremiums = assets
      .filter((a) => stablecoins.includes(a.asset))
      .map((a) => a.premiumBps)

    const stablecoinAvgPremium =
      stablePremiums.length > 0
        ? Math.round(stablePremiums.reduce((a, b) => a + b, 0) / stablePremiums.length)
        : 0

    return { assets, stablecoinAvgPremium, sofrBps }
  }, [benchmarks, sofr])

  return {
    summary,
    isLoading: oracleLoading || sofrLoading,
  }
}
