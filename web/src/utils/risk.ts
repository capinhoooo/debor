// Risk math utilities — replicates CRE riskAnalyst.ts formulas client-side

// VaR/CVaR z-scores
const Z_95 = 1.645
const Z_99 = 2.326
const CVAR_95_MULT = 2.063
const CVAR_99_MULT = 2.665

// Annualization: 48 periods/day × 365 days
const PERIODS_PER_YEAR = 17520

export interface VaRMetrics {
  var95: number
  var99: number
  cvar95: number
  cvar99: number
  annualizedVol: number
  periodVol: number
}

export function computeVaR(currentRate: number, previousRate: number, deborVol: number): VaRMetrics {
  const crossProtocolStdDev = Math.sqrt(deborVol / 1000)
  const rateDelta = Math.abs(currentRate - previousRate)
  const periodVol = Math.max(rateDelta || 1, crossProtocolStdDev)
  const annualizedVol = Math.round(periodVol * Math.sqrt(PERIODS_PER_YEAR))

  return {
    var95: Math.round(periodVol * Z_95),
    var99: Math.round(periodVol * Z_99),
    cvar95: Math.round(periodVol * CVAR_95_MULT),
    cvar99: Math.round(periodVol * CVAR_99_MULT),
    annualizedVol,
    periodVol,
  }
}

// HHI concentration
export interface HHIMetrics {
  hhi: number
  effectiveSources: number
  maxWeight: number
  maxProtocol: string
  level: 'LOW' | 'MODERATE' | 'HIGH'
}

export function computeHHI(tvls: { protocol: string; tvl: number }[]): HHIMetrics {
  const total = tvls.reduce((s, t) => s + t.tvl, 0)
  if (total === 0) return { hhi: 0, effectiveSources: 0, maxWeight: 0, maxProtocol: '-', level: 'HIGH' }

  let hhi = 0
  let maxWeight = 0
  let maxProtocol = ''

  for (const { protocol, tvl } of tvls) {
    const share = tvl / total
    hhi += share * share
    if (share > maxWeight) {
      maxWeight = share
      maxProtocol = protocol
    }
  }

  const effectiveSources = Math.round((1 / hhi) * 100) / 100
  const level = hhi < 0.15 ? 'LOW' : hhi < 0.25 ? 'MODERATE' : 'HIGH'

  return { hhi: Math.round(hhi * 10000) / 10000, effectiveSources, maxWeight, maxProtocol, level }
}

// Composite risk score breakdown
export interface RiskBreakdown {
  varScore: number
  hhiScore: number
  uptimeScore: number
  sofrScore: number
  volScore: number
  total: number
  classification: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
}

export function computeRiskBreakdown(
  var99: number,
  hhi: number,
  uptimeRatio: number,
  sofrSpreadBps: number,
  vol: number,
): RiskBreakdown {
  let varScore = 0
  if (var99 > 200) varScore = 30
  else if (var99 > 100) varScore = 20
  else if (var99 > 50) varScore = 10

  let hhiScore = 0
  if (hhi > 0.25) hhiScore = 25
  else if (hhi > 0.15) hhiScore = 15

  let uptimeScore = 0
  if (uptimeRatio < 0.5) uptimeScore = 20
  else if (uptimeRatio < 0.7) uptimeScore = 10

  let sofrScore = 0
  const absSpread = Math.abs(sofrSpreadBps)
  if (absSpread > 200) sofrScore = 15
  else if (absSpread > 50) sofrScore = 8

  let volScore = 0
  if (vol > 5000) volScore = 10
  else if (vol > 2000) volScore = 5

  const total = varScore + hhiScore + uptimeScore + sofrScore + volScore
  const classification = total >= 60 ? 'CRITICAL' : total >= 40 ? 'HIGH' : total >= 20 ? 'MEDIUM' : 'LOW'

  return { varScore, hhiScore, uptimeScore, sofrScore, volScore, total, classification }
}

// Basel IRRBB stress scenarios
export interface StressScenario {
  name: string
  shockBps: number
  special?: 'sourceFailure' | 'tvlCollapse'
}

export const STRESS_SCENARIOS: StressScenario[] = [
  { name: 'Parallel Up (+200bps)', shockBps: 200 },
  { name: 'Parallel Down (-200bps)', shockBps: -200 },
  { name: 'Short Rate Up (+300bps)', shockBps: 300 },
  { name: 'Short Rate Down (-300bps)', shockBps: -300 },
  { name: 'Source Failure', shockBps: 0, special: 'sourceFailure' },
  { name: 'TVL Collapse (80%)', shockBps: 0, special: 'tvlCollapse' },
]

export interface StressResult {
  name: string
  shockedRate: number
  impactBps: number
  breachesVaR: boolean
}

export function runStressTests(
  currentRate: number,
  var99: number,
  maxProtocolWeight: number,
): StressResult[] {
  return STRESS_SCENARIOS.map((scenario) => {
    let impactBps: number
    let shockedRate: number

    if (scenario.special === 'sourceFailure') {
      impactBps = -Math.round(maxProtocolWeight * currentRate * 0.1)
      shockedRate = currentRate + impactBps
    } else if (scenario.special === 'tvlCollapse') {
      impactBps = 0
      shockedRate = currentRate
    } else {
      impactBps = scenario.shockBps
      shockedRate = currentRate + scenario.shockBps
    }

    return {
      name: scenario.name,
      shockedRate: Math.max(0, shockedRate),
      impactBps,
      breachesVaR: Math.abs(impactBps) > var99,
    }
  })
}

// Market regime from SOFR spread
export type MarketRegime = 'CONVERGED' | 'NORMAL' | 'DIVERGED' | 'DISLOCATED'

export function classifyRegime(defiPremiumBps: number): MarketRegime {
  const abs = Math.abs(defiPremiumBps)
  if (abs < 10) return 'CONVERGED'
  if (abs < 50) return 'NORMAL'
  if (abs < 200) return 'DIVERGED'
  return 'DISLOCATED'
}
