import { safeJsonStringify, UInt64 } from '@chainlink/cre-sdk'
import type { NormalizedRate, TVLWeight, WeightedRate, DeBORMetrics } from './types'

export function mergeRatesWithTVL(
  rates: NormalizedRate[],
  tvls: TVLWeight[],
): WeightedRate[] {
  const tvlMap = new Map<string, bigint>()
  for (const t of tvls) {
    tvlMap.set(t.protocol, t.tvlUsd)
  }
  
  return rates.map((r) => ({
    ...r,
    tvlUsd: tvlMap.get(r.protocol) || 0n,
  }))
}

export function computeRateDeviation(newRate: bigint, currentRate: bigint): { deviationBps: bigint; safe: boolean } {
  if (currentRate === 0n) return { deviationBps: 0n, safe: true }

  const newVal = new UInt64(newRate)
  const curVal = new UInt64(currentRate)
  const diff = newRate > currentRate
    ? newVal.sub(curVal).value
    : curVal.sub(newVal).value

  return {
    deviationBps: diff,
    safe: diff <= 500n,
  }
}

export function stringifyMetrics(metrics: DeBORMetrics): string {
  return safeJsonStringify(metrics)
}

export function computeBenchmark(
  weightedRates: WeightedRate[],
  previousRates: bigint[],
  sourcesConfigured = 0n,
): DeBORMetrics {
  const n = BigInt(weightedRates.length)
  if (n === 0n) throw new Error('No rate data')

  let totalTvl = 0n
  let weightedBorrow = 0n
  let weightedSupply = 0n

  for (const r of weightedRates) {
    weightedBorrow += r.borrowBps * r.tvlUsd
    weightedSupply += r.supplyBps * r.tvlUsd
    totalTvl += r.tvlUsd
  }

  let deborRate: bigint
  let deborSupply: bigint
  if (totalTvl > 0n) {
    deborRate = weightedBorrow / totalTvl
    deborSupply = weightedSupply / totalTvl
  } else {
    deborRate = weightedRates.reduce((s, r) => s + r.borrowBps, 0n) / n
    deborSupply = weightedRates.reduce((s, r) => s + r.supplyBps, 0n) / n
  }

  const deborSpread = deborRate > deborSupply ? deborRate - deborSupply : 0n

  const meanBorrow = weightedRates.reduce((s, r) => s + r.borrowBps, 0n) / n
  let sumSquaredDiffs = 0n
  for (const r of weightedRates) {
    const diff = r.borrowBps > meanBorrow ? r.borrowBps - meanBorrow : meanBorrow - r.borrowBps
    sumSquaredDiffs += diff * diff
  }
  const deborVol = (sumSquaredDiffs * 1000n) / n

  const termPeriods = 336
  let termSum = deborRate
  let termCount = 1n
  const relevantHistory = previousRates.slice(-termPeriods)
  for (const hr of relevantHistory) {
    termSum += hr
    termCount += 1n
  }
  const deborTerm7d = termSum / termCount

  return {
    deborRate,
    deborSupply,
    deborSpread,
    deborVol,
    deborTerm7d,
    timestamp: 0n,
    numSources: n,
    sourcesConfigured: sourcesConfigured > 0n ? sourcesConfigured : n,
  }
}