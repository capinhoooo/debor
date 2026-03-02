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
  LAST_FINALIZED_BLOCK_NUMBER,
  ok,
  text,
  type Runtime,
  type HTTPSendRequester,
} from '@chainlink/cre-sdk'
import { encodeFunctionData, decodeFunctionResult, zeroAddress, type Address } from 'viem'
import { DEBOR_ORACLE_READ_ABI } from './abis'
import type { Config, AssetClass, SOFRData, EFFRData, MarketRegime, AssetComparison, SOFRComparisonResult } from './types'

const ASSETS: AssetClass[] = ['USDC', 'ETH', 'BTC', 'DAI', 'USDT']
const STABLECOINS: AssetClass[] = ['USDC', 'DAI', 'USDT']

const SOFR_API_BASE = 'https://markets.newyorkfed.org/api'
const SOFR_ENDPOINT = '/rates/secured/sofr/last/1.json'
const EFFR_ENDPOINT = '/rates/unsecured/effr/last/1.json'

// --- SOFR Fetch ---

interface SOFRFetchResult {
  rate: number
  rateBps: number
  date: string
  volumeBillions: number
  percentile1: number
  percentile99: number
  fetchedAt: number
}

function fetchSOFRCallback(
  sendRequester: HTTPSendRequester,
  apiBase: string,
  endpoint: string,
): SOFRFetchResult {
  const url = `${apiBase}${endpoint}`
  const response = sendRequester.sendRequest({ url, method: 'GET' }).result()

  if (!ok(response)) {
    return { rate: 0, rateBps: 0, date: '', volumeBillions: 0, percentile1: 0, percentile99: 0, fetchedAt: Date.now() }
  }

  const body = JSON.parse(text(response))
  const ref = body.refRates?.[0]
  if (!ref) {
    return { rate: 0, rateBps: 0, date: '', volumeBillions: 0, percentile1: 0, percentile99: 0, fetchedAt: Date.now() }
  }

  return {
    rate: ref.percentRate || 0,
    rateBps: Math.round((ref.percentRate || 0) * 100),
    date: ref.effectiveDate || '',
    volumeBillions: ref.volumeInBillions || 0,
    percentile1: ref.percentPercentile1 || 0,
    percentile99: ref.percentPercentile99 || 0,
    fetchedAt: Date.now(),
  }
}

export function fetchSOFR(runtime: Runtime<Config>): SOFRData {
  const httpClient = new cre.capabilities.HTTPClient()
  const apiBase = runtime.config.sofrApiBase || SOFR_API_BASE
  const endpoint = runtime.config.sofrEndpoint || SOFR_ENDPOINT

  const result = httpClient
    .sendRequest(
      runtime,
      fetchSOFRCallback,
      ConsensusAggregationByFields<SOFRFetchResult>({
        rate: () => identical<number>(),
        rateBps: () => identical<number>(),
        date: () => identical<string>(),
        volumeBillions: () => identical<number>(),
        percentile1: () => identical<number>(),
        percentile99: () => identical<number>(),
        fetchedAt: () => ignore<number>(),
      }).withDefault({
        rate: 0, rateBps: 0, date: '', volumeBillions: 0,
        percentile1: 0, percentile99: 0, fetchedAt: 0,
      }),
    )(apiBase, endpoint)
    .result()

  return {
    rate: result.rate,
    rateBps: result.rateBps,
    date: result.date,
    volumeBillions: result.volumeBillions,
    percentile1: result.percentile1,
    percentile99: result.percentile99,
  }
}

// --- EFFR Fetch ---

interface EFFRFetchResult {
  rate: number
  rateBps: number
  date: string
  targetFrom: number
  targetTo: number
  fetchedAt: number
}

function fetchEFFRCallback(
  sendRequester: HTTPSendRequester,
  apiBase: string,
  endpoint: string,
): EFFRFetchResult {
  const url = `${apiBase}${endpoint}`
  const response = sendRequester.sendRequest({ url, method: 'GET' }).result()

  if (!ok(response)) {
    return { rate: 0, rateBps: 0, date: '', targetFrom: 0, targetTo: 0, fetchedAt: Date.now() }
  }

  const body = JSON.parse(text(response))
  const ref = body.refRates?.[0]
  if (!ref) {
    return { rate: 0, rateBps: 0, date: '', targetFrom: 0, targetTo: 0, fetchedAt: Date.now() }
  }

  return {
    rate: ref.percentRate || 0,
    rateBps: Math.round((ref.percentRate || 0) * 100),
    date: ref.effectiveDate || '',
    targetFrom: ref.targetRateFrom || 0,
    targetTo: ref.targetRateTo || 0,
    fetchedAt: Date.now(),
  }
}

export function fetchEFFR(runtime: Runtime<Config>): EFFRData {
  const httpClient = new cre.capabilities.HTTPClient()
  const apiBase = runtime.config.sofrApiBase || SOFR_API_BASE
  const endpoint = runtime.config.effrEndpoint || EFFR_ENDPOINT

  const result = httpClient
    .sendRequest(
      runtime,
      fetchEFFRCallback,
      ConsensusAggregationByFields<EFFRFetchResult>({
        rate: () => identical<number>(),
        rateBps: () => identical<number>(),
        date: () => identical<string>(),
        targetFrom: () => identical<number>(),
        targetTo: () => identical<number>(),
        fetchedAt: () => ignore<number>(),
      }).withDefault({
        rate: 0, rateBps: 0, date: '', targetFrom: 0, targetTo: 0, fetchedAt: 0,
      }),
    )(apiBase, endpoint)
    .result()

  return {
    rate: result.rate,
    rateBps: result.rateBps,
    date: result.date,
    targetFrom: result.targetFrom,
    targetTo: result.targetTo,
  }
}

// --- Market Regime Classification ---

export function classifyRegime(defiPremiumBps: number): MarketRegime {
  const abs = Math.abs(defiPremiumBps)
  if (abs < 10) return 'CONVERGED'
  if (abs < 50) return 'NORMAL'
  if (abs < 200) return 'DIVERGED'
  return 'DISLOCATED'
}

// --- Full DeBOR vs SOFR Comparison ---

export function runSOFRComparison(runtime: Runtime<Config>): string {
  runtime.log('=== DeBOR vs SOFR/EFFR Comparison ===')

  // Step 1: Read all 5 DeBOR oracle rates from Sepolia
  runtime.log('Step 1: Reading DeBOR oracle rates from Sepolia...')
  const targetNetwork = getNetwork({
    chainFamily: 'evm',
    chainSelectorName: runtime.config.targetChainSelectorName,
    isTestnet: true,
  })
  if (!targetNetwork) {
    return 'COMPARE: Target network unavailable'
  }

  const evmClient = new cre.capabilities.EVMClient(targetNetwork.chainSelector.selector)
  const oracleRates: Record<string, number> = {}

  for (const asset of ASSETS) {
    const oracleAddr = runtime.config.oracleAddresses[asset]
    if (!oracleAddr) continue

    try {
      const result = evmClient
        .callContract(runtime, {
          call: encodeCallMsg({
            from: zeroAddress,
            to: oracleAddr as Address,
            data: encodeFunctionData({
              abi: DEBOR_ORACLE_READ_ABI,
              functionName: 'getRate',
            }),
          }),
          blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
        })
        .result()

      const rate = decodeFunctionResult({
        abi: DEBOR_ORACLE_READ_ABI,
        functionName: 'getRate',
        data: bytesToHex(result.data),
      })

      oracleRates[asset] = Number(BigInt(rate as any))
      runtime.log(`  ${asset}: ${oracleRates[asset]}bps`)
    } catch (e) {
      runtime.log(`  ${asset}: read failed: ${e}`)
      oracleRates[asset] = 0
    }
  }

  // Step 2: Fetch SOFR from NY Fed API
  runtime.log('Step 2: Fetching SOFR from NY Fed API...')
  let sofr: SOFRData = { rate: 0, rateBps: 0, date: '', volumeBillions: 0, percentile1: 0, percentile99: 0 }
  try {
    sofr = fetchSOFR(runtime)
    runtime.log(`  SOFR: ${sofr.rate}% (${sofr.rateBps}bps) as of ${sofr.date}, volume=$${sofr.volumeBillions}B`)
  } catch (e) {
    runtime.log(`  SOFR fetch failed: ${e}`)
  }

  // Step 3: Fetch EFFR from NY Fed API
  runtime.log('Step 3: Fetching EFFR (Fed Funds Rate) from NY Fed API...')
  let effr: EFFRData = { rate: 0, rateBps: 0, date: '', targetFrom: 0, targetTo: 0 }
  try {
    effr = fetchEFFR(runtime)
    runtime.log(`  EFFR: ${effr.rate}% (${effr.rateBps}bps), target range: ${effr.targetFrom}%-${effr.targetTo}%`)
  } catch (e) {
    runtime.log(`  EFFR fetch failed: ${e}`)
  }

  // Step 4: Compute per-asset comparisons
  runtime.log('Step 4: Computing DeFi vs TradFi comparison...')
  const comparisons: AssetComparison[] = []

  for (const asset of ASSETS) {
    const deborRate = oracleRates[asset] || 0
    if (deborRate === 0) continue

    const defiPremium = deborRate - sofr.rateBps
    const regime = classifyRegime(defiPremium)

    comparisons.push({
      asset,
      deborRate,
      sofrRate: sofr.rateBps,
      effrRate: effr.rateBps,
      defiPremium,
      regime,
    })

    const sign = defiPremium >= 0 ? '+' : ''
    runtime.log(`  ${asset}: DeBOR=${deborRate}bps, SOFR=${sofr.rateBps}bps, premium=${sign}${defiPremium}bps → ${regime}`)
  }

  // Step 5: Stablecoin average premium
  const stableComps = comparisons.filter((c) => STABLECOINS.includes(c.asset as AssetClass))
  const avgStablePremium = stableComps.length > 0
    ? Math.round(stableComps.reduce((sum, c) => sum + c.defiPremium, 0) / stableComps.length)
    : 0

  runtime.log(`  Avg stablecoin DeFi premium: ${avgStablePremium >= 0 ? '+' : ''}${avgStablePremium}bps`)

  // Step 6: Generate summary
  const stableNames = stableComps.map((c) => `${c.asset}=${c.deborRate}`).join(', ')
  const nonStable = comparisons.filter((c) => !STABLECOINS.includes(c.asset as AssetClass))
  const nonStableNames = nonStable.map((c) => `${c.asset}=${c.deborRate}`).join(', ')

  let summaryText = `Stablecoin DeFi rates (${stableNames}) `
  if (Math.abs(avgStablePremium) < 50) {
    summaryText += `converged within ${Math.abs(avgStablePremium)}bps of SOFR (${sofr.rateBps}bps).`
  } else {
    summaryText += `diverged ${avgStablePremium >= 0 ? '+' : ''}${avgStablePremium}bps from SOFR (${sofr.rateBps}bps).`
  }
  if (nonStable.length > 0) {
    summaryText += ` Non-stablecoin assets (${nonStableNames}) reflect different borrow demand dynamics.`
  }

  runtime.log(`  Summary: ${summaryText}`)

  const result: SOFRComparisonResult = {
    sofr,
    effr,
    comparisons,
    avgStablePremium,
    summary: summaryText,
  }

  runtime.log(`=== SOFR Comparison Complete ===`)
  runtime.log(safeJsonStringify(result))

  const regimeCounts = comparisons.reduce(
    (acc, c) => { acc[c.regime] = (acc[c.regime] || 0) + 1; return acc },
    {} as Record<string, number>,
  )
  const regimeStr = Object.entries(regimeCounts).map(([r, n]) => `${r}:${n}`).join(', ')

  return `COMPARE: SOFR=${sofr.rateBps}bps, EFFR=${effr.rateBps}bps, avgStablePremium=${avgStablePremium >= 0 ? '+' : ''}${avgStablePremium}bps [${regimeStr}]`
}

// --- SOFR Cross-Reference for Validation (Step 7 in httpValidator) ---

export function sofrCrossReference(
  runtime: Runtime<Config>,
  oracleRates: Record<string, bigint>,
): string[] {
  const warnings: string[] = []

  // Only fetch SOFR (1 HTTP call) in validation mode to stay within 5 HTTP limit.
  // EFFR is available via the dedicated "compare" action which has its own HTTP budget.
  runtime.log('Step 8: SOFR cross-reference (NY Fed API)...')

  let sofr: SOFRData = { rate: 0, rateBps: 0, date: '', volumeBillions: 0, percentile1: 0, percentile99: 0 }

  try {
    sofr = fetchSOFR(runtime)
    runtime.log(`  SOFR: ${sofr.rate}% (${sofr.rateBps}bps) as of ${sofr.date}, volume=$${sofr.volumeBillions}B`)
  } catch (e) {
    runtime.log(`  SOFR fetch failed: ${e} — skipping cross-reference`)
    return warnings
  }

  if (sofr.rateBps === 0) {
    runtime.log(`  SOFR data unavailable — skipping cross-reference`)
    return warnings
  }

  // Compare stablecoin DeBOR rates against SOFR
  for (const asset of STABLECOINS) {
    const rate = Number(oracleRates[asset] || 0n)
    if (rate === 0) continue

    const premium = rate - sofr.rateBps
    const regime = classifyRegime(premium)
    const sign = premium >= 0 ? '+' : ''

    if (premium < 0 && Math.abs(premium) > 50) {
      warnings.push(`SOFR:${asset}_BELOW(${premium}bps)`)
      runtime.log(`  WARNING: ${asset} DeBOR rate (${rate}bps) significantly below SOFR (${sofr.rateBps}bps) — unusual`)
    } else if (Math.abs(premium) > 200) {
      warnings.push(`SOFR:${asset}_DISLOCATED(${sign}${premium}bps)`)
      runtime.log(`  WARNING: ${asset} DeFi-TradFi dislocation: ${sign}${premium}bps`)
    } else {
      runtime.log(`  ${asset}: DeFi premium ${sign}${premium}bps → ${regime}`)
    }
  }

  return warnings
}