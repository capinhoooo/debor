import {
  cre,
  ConsensusAggregationByFields,
  identical,
  median,
  ignore,
  encodeCallMsg,
  getNetwork,
  bytesToHex,
  safeJsonStringify,
  ok,
  text,
  LAST_FINALIZED_BLOCK_NUMBER,
  type Runtime,
  type HTTPSendRequester,
} from '@chainlink/cre-sdk'
import { encodeFunctionData, decodeFunctionResult, zeroAddress } from 'viem'
import { DEBOR_ORACLE_READ_ABI } from './abis'
import { fetchSOFR } from './sofrComparator'
import type { Config, AssetClass, RiskMetrics, RiskLevel, MarketRegime, StressResult } from './types'

const ASSETS: AssetClass[] = ['USDC', 'ETH', 'BTC', 'DAI', 'USDT']

// Z-scores for parametric VaR/CVaR under normal distribution
const Z_95 = 1.645
const Z_99 = 2.326
// CVaR multipliers: E[Z | Z > z_alpha] = phi(z_alpha) / (1 - alpha)
// phi(1.645)/0.05 ≈ 2.063, phi(2.326)/0.01 ≈ 2.665
const CVAR_95_MULT = 2.063
const CVAR_99_MULT = 2.665

// HHI thresholds (adapted from DOJ merger guidelines, 0-1 scale)
const HHI_LOW = 0.15
const HHI_MODERATE = 0.25

// DeFiLlama slug mapping for TVL
const PROTOCOL_TVL_SLUGS: Record<string, string> = {
  aave_v3: 'aave-v3',
  spark: 'spark',
  compound_v3: 'compound-v3',
  morpho_blue: 'morpho',
  moonwell: 'moonwell',
  benqi: 'benqi-lending',
}

// Basel IRRBB stress scenarios (BCBS 368)
const STRESS_SCENARIOS: { name: string; shockBps: number }[] = [
  { name: 'Parallel Up (+200bps)', shockBps: 200 },
  { name: 'Parallel Down (-200bps)', shockBps: -200 },
  { name: 'Short Rate Up (+300bps)', shockBps: 300 },
  { name: 'Short Rate Down (-300bps)', shockBps: -300 },
]

// ------------------------------------------------------------------
// Oracle Read Helpers
// ------------------------------------------------------------------

interface BenchmarkData {
  asset: AssetClass
  rate: number
  supply: number
  spread: number
  vol: number
  term7d: number
  sources: number
  configured: number
}

function readOracleBenchmark(
  runtime: Runtime<Config>,
  asset: AssetClass,
): BenchmarkData {
  const oracleAddress = runtime.config.oracleAddresses[asset]
  const network = getNetwork({
    chainFamily: 'evm',
    chainSelectorName: runtime.config.targetChainSelectorName,
  })
  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)

  const callData = encodeFunctionData({
    abi: DEBOR_ORACLE_READ_ABI,
    functionName: 'getFullBenchmark',
  })
  const result = evmClient
    .callContract(runtime, {
      call: encodeCallMsg({ from: zeroAddress, to: oracleAddress, data: callData }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result()

  const decoded = decodeFunctionResult({
    abi: DEBOR_ORACLE_READ_ABI,
    functionName: 'getFullBenchmark',
    data: bytesToHex(result.data),
  }) as readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint]

  return {
    asset,
    rate: Number(decoded[0]),
    supply: Number(decoded[1]),
    spread: Number(decoded[2]),
    vol: Number(decoded[3]),
    term7d: Number(decoded[4]),
    sources: Number(decoded[6]),
    configured: Number(decoded[7]),
  }
}

function readHistoricalRate(
  runtime: Runtime<Config>,
  asset: AssetClass,
  periodsBack: number,
): number {
  const oracleAddress = runtime.config.oracleAddresses[asset]
  const network = getNetwork({
    chainFamily: 'evm',
    chainSelectorName: runtime.config.targetChainSelectorName,
  })
  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)

  const callData = encodeFunctionData({
    abi: DEBOR_ORACLE_READ_ABI,
    functionName: 'getHistoricalRate',
    args: [BigInt(periodsBack)],
  })
  const result = evmClient
    .callContract(runtime, {
      call: encodeCallMsg({ from: zeroAddress, to: oracleAddress, data: callData }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result()

  const decoded = decodeFunctionResult({
    abi: DEBOR_ORACLE_READ_ABI,
    functionName: 'getHistoricalRate',
    data: bytesToHex(result.data),
  }) as bigint

  return Number(decoded)
}

// ------------------------------------------------------------------
// VaR / CVaR (Parametric)
// ------------------------------------------------------------------

interface VaRResult {
  var95: number
  var99: number
  cvar95: number
  cvar99: number
  realizedVol: number
}

function computeParametricVaR(
  currentRate: number,
  previousRate: number,
  crossProtocolVol: number,
): VaRResult {
  // crossProtocolVol is variance*1000 from benchmarkEngine: (sum((bps_i - mean)^2) * 1000) / n
  // Convert to standard deviation in bps: sqrt(vol / 1000)
  const crossProtocolStdDev = Math.sqrt(crossProtocolVol / 1000)

  // Compute period-over-period rate change as a volatility signal
  const rateDelta = Math.abs(currentRate - previousRate)

  // Use the larger of: single-period absolute delta, or cross-protocol std dev
  // This ensures vol isn't zero when the rate hasn't moved recently
  const periodVol = Math.max(rateDelta || 1, crossProtocolStdDev)

  // Annualize: 48 periods/day * 365 days = 17520 periods/year
  const annualizedVol = periodVol * Math.sqrt(17520)

  return {
    var95: Math.round(periodVol * Z_95),
    var99: Math.round(periodVol * Z_99),
    cvar95: Math.round(periodVol * CVAR_95_MULT),
    cvar99: Math.round(periodVol * CVAR_99_MULT),
    realizedVol: Math.round(annualizedVol),
  }
}

// ------------------------------------------------------------------
// HHI (Herfindahl-Hirschman Index)
// ------------------------------------------------------------------

interface HHIResult {
  hhi: number
  effectiveSources: number
  maxWeight: number
}

function computeHHI(protocolTVLs: Map<string, number>): HHIResult {
  const tvlValues = Array.from(protocolTVLs.values())
  const totalTVL = tvlValues.reduce((sum, v) => sum + v, 0)

  if (totalTVL === 0) {
    return { hhi: 1, effectiveSources: 1, maxWeight: 1 }
  }

  let hhi = 0
  let maxWeight = 0

  for (const tvl of tvlValues) {
    const share = tvl / totalTVL
    hhi += share * share
    if (share > maxWeight) maxWeight = share
  }

  return {
    hhi: Math.round(hhi * 10000) / 10000,
    effectiveSources: Math.round((1 / hhi) * 100) / 100,
    maxWeight: Math.round(maxWeight * 10000) / 10000,
  }
}

// ------------------------------------------------------------------
// Stress Tests (Basel IRRBB BCBS 368)
// ------------------------------------------------------------------

function runStressTests(
  currentRate: number,
  var99: number,
  topProtocolShare: number,
): StressResult[] {
  const results: StressResult[] = []

  // Standard rate shock scenarios
  for (const scenario of STRESS_SCENARIOS) {
    const shockedRate = Math.max(0, currentRate + scenario.shockBps)
    results.push({
      scenario: scenario.name,
      shockedRate,
      impact: scenario.shockBps,
      breachesVaR: Math.abs(scenario.shockBps) > var99,
    })
  }

  // Source Failure scenario: remove top protocol
  // Impact: if top protocol has share S, removal shifts rate by ~S * rate_deviation
  const sourceFailureImpact = Math.round(topProtocolShare * currentRate * 0.1)
  results.push({
    scenario: 'Source Failure (top protocol removed)',
    shockedRate: Math.max(0, currentRate - sourceFailureImpact),
    impact: -sourceFailureImpact,
    breachesVaR: sourceFailureImpact > var99,
  })

  // TVL Collapse scenario: 80% TVL drop concentrates sources
  results.push({
    scenario: 'TVL Collapse (80% drop)',
    shockedRate: currentRate, // Rate may not change but quality degrades
    impact: 0,
    breachesVaR: false,
  })

  return results
}

// ------------------------------------------------------------------
// Composite Risk Level
// ------------------------------------------------------------------

function computeRiskLevel(
  var99: number,
  hhi: number,
  sourceUptime: number,
  sofrSpreadAbs: number,
  crossProtocolVol: number,
): RiskLevel {
  let score = 0

  // VaR component (0-30 points)
  if (var99 > 200) score += 30
  else if (var99 > 100) score += 20
  else if (var99 > 50) score += 10

  // HHI component (0-25 points)
  if (hhi > HHI_MODERATE) score += 25
  else if (hhi > HHI_LOW) score += 15

  // Source uptime component (0-20 points)
  if (sourceUptime < 0.5) score += 20
  else if (sourceUptime < 0.7) score += 10

  // SOFR spread component (0-15 points)
  if (sofrSpreadAbs > 200) score += 15
  else if (sofrSpreadAbs > 50) score += 8

  // Cross-protocol vol component (0-10 points)
  if (crossProtocolVol > 5000) score += 10
  else if (crossProtocolVol > 2000) score += 5

  if (score >= 60) return 'CRITICAL'
  if (score >= 40) return 'HIGH'
  if (score >= 20) return 'MEDIUM'
  return 'LOW'
}

function classifyRegime(sofrSpread: number): MarketRegime {
  const abs = Math.abs(sofrSpread)
  if (abs < 10) return 'CONVERGED'
  if (abs < 50) return 'NORMAL'
  if (abs < 200) return 'DIVERGED'
  return 'DISLOCATED'
}

// ------------------------------------------------------------------
// TVL Fetch for HHI (uses same /tvl/{slug} pattern as tvlFetcher.ts)
// ------------------------------------------------------------------

interface TVLFetchResult {
  slug: string
  tvl: number
  fetchedAt: number
}

function fetchSingleTVLForHHI(
  sendRequester: HTTPSendRequester,
  tvlApiBase: string,
  slug: string,
): TVLFetchResult {
  const url = `${tvlApiBase}/tvl/${slug}`
  const response = sendRequester.sendRequest({ url, method: 'GET' }).result()

  if (!ok(response)) {
    return { slug, tvl: 0, fetchedAt: Date.now() }
  }

  const tvlValue = Number(text(response))
  if (isNaN(tvlValue) || tvlValue <= 0) {
    return { slug, tvl: 0, fetchedAt: Date.now() }
  }

  return { slug, tvl: tvlValue, fetchedAt: Date.now() }
}

function fetchProtocolTVLs(
  runtime: Runtime<Config>,
): Map<string, number> {
  const tvlMap = new Map<string, number>()
  const httpClient = new cre.capabilities.HTTPClient()
  const seen = new Set<string>()

  for (const p of runtime.config.protocols) {
    const protocolBase = p.protocol
    if (seen.has(protocolBase)) continue
    seen.add(protocolBase)

    const slug = PROTOCOL_TVL_SLUGS[protocolBase]
    if (!slug) continue

    try {
      const result = httpClient
        .sendRequest(
          runtime,
          fetchSingleTVLForHHI,
          ConsensusAggregationByFields<TVLFetchResult>({
            slug: () => identical<string>(),
            tvl: () => median<number>(),
            fetchedAt: () => ignore<number>(),
          }).withDefault({ slug, tvl: 0, fetchedAt: 0 }),
        )(runtime.config.tvlApiBase, slug)
        .result()

      if (result.tvl > 0) {
        tvlMap.set(protocolBase, result.tvl)
        runtime.log(`  ${protocolBase}: TVL=$${Math.floor(result.tvl).toLocaleString()}`)
      }
    } catch (e) {
      runtime.log(`  ${protocolBase}: TVL fetch failed (${e})`)
    }
  }

  return tvlMap
}

// ------------------------------------------------------------------
// Main Exported Function
// ------------------------------------------------------------------

export function runRiskAnalysis(runtime: Runtime<Config>): string {
  runtime.log('=== DeBOR Risk & Compliance Analysis ===')

  // Step 1: Read all 5 oracle benchmarks (5 EVM calls)
  runtime.log('Step 1: Reading oracle benchmarks...')
  const benchmarks: BenchmarkData[] = []
  for (const asset of ASSETS) {
    try {
      const bm = readOracleBenchmark(runtime, asset)
      benchmarks.push(bm)
      runtime.log(`  ${asset}: rate=${bm.rate}bps, spread=${bm.spread}bps, vol=${bm.vol}, sources=${bm.sources}/${bm.configured}`)
    } catch (e) {
      runtime.log(`  ${asset}: FAILED (${e})`)
    }
  }

  if (benchmarks.length === 0) {
    return safeJsonStringify({ error: 'No oracle data available' })
  }

  // Step 2: Read historical rates for VaR (5 EVM calls)
  runtime.log('Step 2: Reading historical rates for VaR...')
  const previousRates: Map<AssetClass, number> = new Map()
  for (const bm of benchmarks) {
    try {
      const prev = readHistoricalRate(runtime, bm.asset, 1)
      previousRates.set(bm.asset, prev)
      runtime.log(`  ${bm.asset}: previous=${prev}bps, delta=${bm.rate - prev}bps`)
    } catch (e) {
      runtime.log(`  ${bm.asset}: historical read failed (${e})`)
      previousRates.set(bm.asset, bm.rate) // fallback: no change
    }
  }

  // Step 3: Fetch SOFR for TradFi comparison (1 HTTP call)
  runtime.log('Step 3: Fetching SOFR...')
  let sofrRateBps = 0
  try {
    const sofr = fetchSOFR(runtime)
    sofrRateBps = sofr.rateBps
    runtime.log(`  SOFR: ${sofr.rateBps}bps (${sofr.date})`)
  } catch (e) {
    runtime.log(`  SOFR fetch failed: ${e}`)
  }

  // Step 4: Compute VaR/CVaR for primary asset (USDC)
  runtime.log('Step 4: Computing VaR/CVaR...')
  const primaryBm = benchmarks.find(b => b.asset === 'USDC') || benchmarks[0]
  const prevRate = previousRates.get(primaryBm.asset) || primaryBm.rate
  const varResult = computeParametricVaR(primaryBm.rate, prevRate, primaryBm.vol)

  runtime.log(`  VaR_95: ${varResult.var95}bps`)
  runtime.log(`  VaR_99: ${varResult.var99}bps`)
  runtime.log(`  CVaR_95: ${varResult.cvar95}bps`)
  runtime.log(`  CVaR_99: ${varResult.cvar99}bps`)
  runtime.log(`  Realized Vol (annualized): ${varResult.realizedVol}bps`)

  // Step 5: Compute HHI from TVL weights (uses protocol data from config)
  runtime.log('Step 5: Computing source concentration (HHI)...')
  const protocolTVLs = fetchProtocolTVLs(runtime)
  const hhiResult = computeHHI(protocolTVLs)

  runtime.log(`  HHI: ${hhiResult.hhi} (${hhiResult.hhi < HHI_LOW ? 'LOW' : hhiResult.hhi < HHI_MODERATE ? 'MODERATE' : 'HIGH'} concentration)`)
  runtime.log(`  Effective Sources: ${hhiResult.effectiveSources}`)
  runtime.log(`  Max Source Weight: ${(hhiResult.maxWeight * 100).toFixed(1)}%`)

  // Step 6: Run stress tests
  runtime.log('Step 6: Running Basel IRRBB stress tests...')
  const stressResults = runStressTests(primaryBm.rate, varResult.var99, hhiResult.maxWeight)
  for (const sr of stressResults) {
    runtime.log(`  ${sr.scenario}: rate=${sr.shockedRate}bps, impact=${sr.impact}bps${sr.breachesVaR ? ' [BREACHES VaR]' : ''}`)
  }

  // Step 7: Compute composite risk
  const sofrSpread = primaryBm.rate - sofrRateBps
  const regime = classifyRegime(sofrSpread)
  const totalSources = benchmarks.reduce((s, b) => s + b.sources, 0)
  const totalConfigured = benchmarks.reduce((s, b) => s + b.configured, 0)
  const sourceUptime = totalConfigured > 0 ? totalSources / totalConfigured : 0

  const riskLevel = computeRiskLevel(
    varResult.var99,
    hhiResult.hhi,
    sourceUptime,
    Math.abs(sofrSpread),
    primaryBm.vol,
  )

  runtime.log(`Step 7: Composite Risk Assessment`)
  runtime.log(`  SOFR Spread: ${sofrSpread}bps (${regime})`)
  runtime.log(`  Source Uptime: ${(sourceUptime * 100).toFixed(0)}% (${totalSources}/${totalConfigured})`)
  runtime.log(`  Risk Level: ${riskLevel}`)

  const metrics: RiskMetrics = {
    var95: varResult.var95,
    var99: varResult.var99,
    cvar95: varResult.cvar95,
    cvar99: varResult.cvar99,
    realizedVol: varResult.realizedVol,
    crossProtocolVol: primaryBm.vol,
    protocolHHI: hhiResult.hhi,
    effectiveSources: hhiResult.effectiveSources,
    maxSourceWeight: hhiResult.maxWeight,
    stressResults,
    sofrSpread,
    regime,
    sourceUptime,
    riskLevel,
    summary: `DeBOR Risk: ${riskLevel} | VaR99=${varResult.var99}bps | HHI=${hhiResult.hhi} (${hhiResult.effectiveSources} eff.) | SOFR+${sofrSpread}bps (${regime}) | Sources=${totalSources}/${totalConfigured}`,
  }

  runtime.log(`=== Risk Analysis Complete: ${metrics.summary} ===`)
  return safeJsonStringify(metrics)
}
