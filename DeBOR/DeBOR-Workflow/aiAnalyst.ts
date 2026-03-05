import {
  cre,
  encodeCallMsg,
  getNetwork,
  bytesToHex,
  hexToBase64,
  bigintToProtoBigInt,
  protoBigIntToBigint,
  safeJsonStringify,
  ok,
  text,
  LAST_FINALIZED_BLOCK_NUMBER,
  LATEST_BLOCK_NUMBER,
  type Runtime,
} from '@chainlink/cre-sdk'
import { encodeFunctionData, decodeFunctionResult, decodeAbiParameters, parseAbiParameters, zeroAddress } from 'viem'
import { DEBOR_ORACLE_READ_ABI } from './abis'
import { BENCHMARK_UPDATED_EVENT_SIG } from './swapManager'
import { fetchSOFR } from './sofrComparator'
import type { Config, AssetClass, AIAnalysis } from './types'

const ASSETS: AssetClass[] = ['USDC', 'ETH', 'BTC', 'DAI', 'USDT']

// Groq API defaults — llama-3.3-70b-versatile supports json_object mode
const DEFAULT_GROQ_MODEL = 'llama-3.3-70b-versatile'
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions'

const SYSTEM_PROMPT = `You are a DeFi interest rate risk analyst for the DeBOR benchmark oracle.
DeBOR aggregates lending/borrowing rates from multiple DeFi protocols across chains into benchmark rates.
Classify the current market conditions from the provided data.
You MUST respond with a JSON object containing EXACTLY these 7 fields:
{"riskLevel":"MEDIUM","riskScore":50,"anomalyDetected":false,"rateDirection":"STABLE","spreadHealth":"NORMAL","explanation":"brief reason","analyzedAt":0}
Field constraints:
- riskLevel: one of "LOW", "MEDIUM", "HIGH", "CRITICAL"
- riskScore: integer 0-100
- anomalyDetected: boolean true or false
- rateDirection: one of "RISING", "FALLING", "STABLE"
- spreadHealth: one of "NORMAL", "COMPRESSED", "INVERTED"
- explanation: string under 150 characters
- analyzedAt: always 0
Do not include any other fields. Do not wrap in markdown.`

// ------------------------------------------------------------------
// Oracle Read Helpers
// ------------------------------------------------------------------

interface AssetSnapshot {
  asset: AssetClass
  rate: number
  supply: number
  spread: number
  vol: number
  term7d: number
  sources: number
  configured: number
}

function readAllBenchmarks(runtime: Runtime<Config>): AssetSnapshot[] {
  const snapshots: AssetSnapshot[] = []

  for (const asset of ASSETS) {
    const oracleAddress = runtime.config.oracleAddresses[asset]
    const network = getNetwork({
      chainFamily: 'evm',
      chainSelectorName: runtime.config.targetChainSelectorName,
    })
    const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)

    try {
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

      snapshots.push({
        asset,
        rate: Number(decoded[0]),
        supply: Number(decoded[1]),
        spread: Number(decoded[2]),
        vol: Number(decoded[3]),
        term7d: Number(decoded[4]),
        sources: Number(decoded[6]),
        configured: Number(decoded[7]),
      })
    } catch (e) {
      runtime.log(`  ${asset}: oracle read failed (${e})`)
    }
  }

  return snapshots
}

// ------------------------------------------------------------------
// Historical Rate Reader (filterLogs)
// ------------------------------------------------------------------

interface HistoricalRatePoint {
  rate: number
  supply: number
  spread: number
  vol: number
  sources: number
}

function readHistoricalRatesFromLogs(
  runtime: Runtime<Config>,
  asset: AssetClass,
): HistoricalRatePoint[] {
  const oracleAddress = runtime.config.oracleAddresses[asset]
  if (!oracleAddress) return []

  const network = getNetwork({
    chainFamily: 'evm',
    chainSelectorName: runtime.config.targetChainSelectorName,
    isTestnet: true,
  })
  if (!network) return []

  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)

  try {
    // Get latest block for range calculation
    const headerResult = evmClient
      .headerByNumber(runtime, { blockNumber: LATEST_BLOCK_NUMBER })
      .result()

    let toBlock = 0n
    if (headerResult.header?.blockNumber) {
      toBlock = protoBigIntToBigint(headerResult.header.blockNumber)
    }
    if (toBlock === 0n) return []

    // ~2000 blocks lookback (~6.6 hours on Sepolia at 12s blocks)
    const fromBlock = toBlock > 2000n ? toBlock - 2000n : 0n

    const logs = evmClient
      .filterLogs(runtime, {
        filterQuery: {
          addresses: [hexToBase64(oracleAddress)],
          topics: [
            { topic: [hexToBase64(BENCHMARK_UPDATED_EVENT_SIG)] },
          ],
          fromBlock: bigintToProtoBigInt(fromBlock),
          toBlock: bigintToProtoBigInt(toBlock),
        },
      })
      .result()

    if (!logs.logs || logs.logs.length === 0) return []

    const points: HistoricalRatePoint[] = []
    // BenchmarkUpdated event: (deborRate, deborSupply, deborSpread, deborVol, deborTerm7d, numSources)
    for (const log of logs.logs.slice(-10)) { // last 10 events max
      try {
        const eventData = bytesToHex(log.data)
        const decoded = decodeAbiParameters(
          parseAbiParameters('uint256, uint256, uint256, uint256, uint256, uint256'),
          eventData as `0x${string}`,
        )
        points.push({
          rate: Number(decoded[0]),
          supply: Number(decoded[1]),
          spread: Number(decoded[2]),
          vol: Number(decoded[3]),
          sources: Number(decoded[5]),
        })
      } catch {
        // skip malformed events
      }
    }

    return points
  } catch (e) {
    runtime.log(`  filterLogs historical rates failed for ${asset}: ${e}`)
    return []
  }
}

// ------------------------------------------------------------------
// Prompt Builder
// ------------------------------------------------------------------

function buildPrompt(
  snapshots: AssetSnapshot[],
  sofrRateBps: number,
  historicalRates: Map<AssetClass, HistoricalRatePoint[]>,
): string {
  const rateLines = snapshots
    .map(s => `  ${s.asset}: ${s.rate}bps`)
    .join('\n')

  const spreadLines = snapshots
    .map(s => `  ${s.asset}: ${s.spread}bps`)
    .join('\n')

  const volLines = snapshots
    .map(s => `  ${s.asset}: ${s.vol}`)
    .join('\n')

  const totalSources = snapshots.reduce((s, b) => s + b.sources, 0)
  const totalConfigured = snapshots.reduce((s, b) => s + b.configured, 0)

  // Compute stablecoin average for DeFi premium
  const stablecoins = snapshots.filter(s => ['USDC', 'DAI', 'USDT'].includes(s.asset))
  const avgStableRate = stablecoins.length > 0
    ? Math.round(stablecoins.reduce((s, b) => s + b.rate, 0) / stablecoins.length)
    : 0
  const defiPremium = avgStableRate - sofrRateBps

  // Rate direction from 7-day term vs current
  const primary = snapshots.find(s => s.asset === 'USDC') || snapshots[0]
  const direction = primary
    ? (primary.rate > primary.term7d + 10 ? 'RISING'
      : primary.rate < primary.term7d - 10 ? 'FALLING'
      : 'STABLE')
    : 'STABLE'

  return `Analyze DeBOR benchmark data:

BENCHMARK RATES (basis points):
${rateLines}

SPREADS borrow-supply (basis points):
${spreadLines}

CROSS-PROTOCOL VOLATILITY (scaled x1000):
${volLines}

SOURCE HEALTH: ${totalSources}/${totalConfigured} sources active

TRADFI COMPARISON:
  SOFR: ${sofrRateBps}bps
  Stablecoin DeFi premium: ${defiPremium}bps

7-DAY TREND: Current=${primary?.rate || 0}bps, 7d avg=${primary?.term7d || 0}bps, direction=${direction}

${buildHistoricalSection(historicalRates)}
Classify risk level, direction, spread health, and anomaly status.`
}

function buildHistoricalSection(historicalRates: Map<AssetClass, HistoricalRatePoint[]>): string {
  const lines: string[] = []
  for (const [asset, points] of historicalRates) {
    if (points.length === 0) continue
    const rates = points.map(p => `${p.rate}`).join(' -> ')
    const oldest = points[0]
    const newest = points[points.length - 1]
    const delta = newest.rate - oldest.rate
    const sign = delta >= 0 ? '+' : ''
    lines.push(`  ${asset}: [${rates}] (${sign}${delta}bps over ${points.length} updates)`)
  }
  if (lines.length === 0) return 'ON-CHAIN HISTORY: No recent BenchmarkUpdated events found'
  return `ON-CHAIN RATE HISTORY (last ~6h from filterLogs):\n${lines.join('\n')}`
}

// ------------------------------------------------------------------
// LLM Call Result
// ------------------------------------------------------------------

interface LLMCallResult {
  riskLevel: string
  riskScore: number
  anomalyDetected: boolean
  rateDirection: string
  spreadHealth: string
  explanation: string
  analyzedAt: number
}

function computeFallbackAnalysis(snapshots: AssetSnapshot[], sofrRateBps: number): LLMCallResult {
  // Rule-based analysis when LLM is unavailable
  const primary = snapshots.find(s => s.asset === 'USDC') || snapshots[0]
  if (!primary) {
    return { riskLevel: 'MEDIUM', riskScore: 50, anomalyDetected: false, rateDirection: 'STABLE', spreadHealth: 'NORMAL', explanation: 'No oracle data for analysis', analyzedAt: 0 }
  }

  // Rate direction from 7d term
  const rateDirection = primary.rate > primary.term7d + 15 ? 'RISING'
    : primary.rate < primary.term7d - 15 ? 'FALLING' : 'STABLE'

  // Spread health from average spread
  const avgSpread = snapshots.reduce((s, b) => s + b.spread, 0) / snapshots.length
  const spreadHealth = avgSpread > 300 ? 'INVERTED' : avgSpread > 150 ? 'COMPRESSED' : 'NORMAL'

  // Volatility-based risk scoring
  const avgVol = snapshots.reduce((s, b) => s + b.vol, 0) / snapshots.length
  const volScore = Math.min(avgVol / 500000, 40) // up to 40 pts from vol

  // DeFi premium risk
  const stables = snapshots.filter(s => ['USDC', 'DAI', 'USDT'].includes(s.asset))
  const avgStableRate = stables.length > 0
    ? stables.reduce((s, b) => s + b.rate, 0) / stables.length : 0
  const premiumBps = Math.abs(avgStableRate - sofrRateBps)
  const premiumScore = Math.min(premiumBps / 10, 30) // up to 30 pts from premium

  // Source health
  const totalSources = snapshots.reduce((s, b) => s + b.sources, 0)
  const totalConfigured = snapshots.reduce((s, b) => s + b.configured, 0)
  const sourceRatio = totalConfigured > 0 ? totalSources / totalConfigured : 1
  const sourceScore = (1 - sourceRatio) * 30 // up to 30 pts from missing sources

  const riskScore = Math.round(Math.min(volScore + premiumScore + sourceScore, 100))
  const riskLevel = riskScore <= 25 ? 'LOW' : riskScore <= 50 ? 'MEDIUM' : riskScore <= 75 ? 'HIGH' : 'CRITICAL'
  const anomalyDetected = riskScore > 75 || avgVol > 50000000

  const parts: string[] = []
  if (rateDirection !== 'STABLE') parts.push(`rates ${rateDirection.toLowerCase()}`)
  if (spreadHealth !== 'NORMAL') parts.push(`spreads ${spreadHealth.toLowerCase()}`)
  if (premiumBps > 50) parts.push(`DeFi premium ${premiumBps}bps`)
  const explanation = parts.length > 0
    ? `Rule-based: ${parts.join(', ')}`
    : `Rule-based: stable market, vol=${Math.round(avgVol)}`

  return { riskLevel, riskScore, anomalyDetected, rateDirection, spreadHealth, explanation, analyzedAt: 0 }
}

// ------------------------------------------------------------------
// Main Exported Function
// ------------------------------------------------------------------

export function runAIAnalysis(runtime: Runtime<Config>): string {
  runtime.log('=== DeBOR AI Market Intelligence ===')

  // Step 1: Read all 5 oracle benchmarks (5 EVM calls)
  runtime.log('Step 1: Reading oracle benchmarks...')
  const snapshots = readAllBenchmarks(runtime)
  for (const s of snapshots) {
    runtime.log(`  ${s.asset}: rate=${s.rate}bps, spread=${s.spread}bps, vol=${s.vol}`)
  }

  if (snapshots.length === 0) {
    return safeJsonStringify({ error: 'No oracle data available' })
  }

  // Step 2: Fetch SOFR for TradFi context (1 HTTP call)
  runtime.log('Step 2: Fetching SOFR...')
  let sofrRateBps = 0
  try {
    const sofr = fetchSOFR(runtime)
    sofrRateBps = sofr.rateBps
    runtime.log(`  SOFR: ${sofr.rateBps}bps`)
  } catch (e) {
    runtime.log(`  SOFR fetch failed: ${e}`)
  }

  // Step 3: Read on-chain historical rates via filterLogs (BenchmarkUpdated events)
  // Uses USDC oracle only to conserve EVM call budget (1 headerByNumber + 1 filterLogs)
  runtime.log('Step 3: Reading on-chain rate history via filterLogs...')
  const historicalRates = new Map<AssetClass, HistoricalRatePoint[]>()
  const usdcHistory = readHistoricalRatesFromLogs(runtime, 'USDC')
  if (usdcHistory.length > 0) {
    historicalRates.set('USDC', usdcHistory)
    runtime.log(`  USDC: ${usdcHistory.length} historical events (${usdcHistory[0].rate} -> ${usdcHistory[usdcHistory.length - 1].rate}bps)`)
  } else {
    runtime.log('  No historical events found')
  }

  // Step 4: Build prompt from all data
  runtime.log('Step 4: Building analysis prompt...')
  const prompt = buildPrompt(snapshots, sofrRateBps, historicalRates)

  // Step 5: Call LLM via ConfidentialHTTPClient (TEE-based, API key stays in VaultDON)
  // Falls back to regular HTTPClient (config key) then to rule-based analysis
  runtime.log('Step 5: Calling LLM...')
  const model = runtime.config.groqApiModel || DEFAULT_GROQ_MODEL
  const apiKey = runtime.config.groqApiKey || ''

  let result: LLMCallResult = computeFallbackAnalysis(snapshots, sofrRateBps)

  const requestBody = JSON.stringify({
    model,
    temperature: 0,
    seed: 42,
    max_tokens: 500,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
  })

  let llmResponse: any = null

  // Strategy 1: ConfidentialHTTPClient with VaultDON secret (preferred)
  // API key and prompt content never leave the TEE
  try {
    runtime.log('  Attempting ConfidentialHTTPClient (TEE + VaultDON)...')
    const confidentialClient = new cre.capabilities.ConfidentialHTTPClient()
    llmResponse = confidentialClient
      .sendRequest(runtime, {
        vaultDonSecrets: [
          { key: 'GROQ_API_KEY', namespace: 'workflow' },
        ],
        request: {
          url: GROQ_API_URL,
          method: 'POST',
          bodyString: requestBody,
          multiHeaders: {
            'Authorization': { values: ['Bearer {{GROQ_API_KEY}}'] },
            'Content-Type': { values: ['application/json'] },
          },
        },
      })
      .result()
    runtime.log('  ConfidentialHTTPClient succeeded')
  } catch (e) {
    runtime.log(`  ConfidentialHTTPClient unavailable: ${e}`)
  }

  // Strategy 2: Regular HTTPClient with config key (simulation fallback)
  if (!llmResponse && apiKey && apiKey !== 'YOUR_GROQ_API_KEY') {
    try {
      runtime.log('  Falling back to HTTPClient (config key)...')
      const httpClient = new cre.capabilities.HTTPClient()
      llmResponse = httpClient
        .sendRequest(runtime, {
          url: GROQ_API_URL,
          method: 'POST',
          body: Buffer.from(requestBody).toString('base64'),
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
        })
        .result()
    } catch (e) {
      runtime.log(`  HTTPClient fallback failed: ${e}`)
    }
  }

  // Parse LLM response (from either client)
  if (llmResponse) {
    try {
      if (ok(llmResponse)) {
        const body = JSON.parse(text(llmResponse))
        const content = body.choices?.[0]?.message?.content
        if (content) {
          const parsed = JSON.parse(content)
          result = {
            riskLevel: parsed.riskLevel || parsed.risk_level || 'MEDIUM',
            riskScore: parsed.riskScore ?? parsed.risk_score ?? 50,
            anomalyDetected: parsed.anomalyDetected ?? parsed.anomaly_detected ?? false,
            rateDirection: parsed.rateDirection || parsed.rate_direction || 'STABLE',
            spreadHealth: parsed.spreadHealth || parsed.spread_health || 'NORMAL',
            explanation: parsed.explanation || '',
            analyzedAt: parsed.analyzedAt ?? parsed.analyzed_at ?? 0,
          }
        } else {
          runtime.log('  LLM returned no content')
        }
      } else {
        runtime.log(`  LLM call returned status ${llmResponse.statusCode} — using rule-based analysis`)
      }
    } catch (e) {
      runtime.log(`  LLM parse failed: ${e} — using rule-based analysis`)
    }
  } else if (!apiKey || apiKey === 'YOUR_GROQ_API_KEY') {
    runtime.log('  No LLM available (no VaultDON secret, no config key) — using rule-based analysis')
  }

  runtime.log(`  Risk Level: ${result.riskLevel} (${result.riskScore}/100)`)
  runtime.log(`  Anomaly: ${result.anomalyDetected} | Direction: ${result.rateDirection} | Spreads: ${result.spreadHealth}`)
  runtime.log(`  Explanation: ${result.explanation}`)

  const analysis: AIAnalysis = {
    riskLevel: result.riskLevel,
    riskScore: result.riskScore,
    anomalyDetected: result.anomalyDetected,
    rateDirection: result.rateDirection,
    spreadHealth: result.spreadHealth,
    explanation: result.explanation,
    analyzedAt: result.analyzedAt,
  }

  runtime.log(`=== AI Analysis Complete: ${result.riskLevel} (${result.riskScore}/100) | ${result.rateDirection} | ${result.spreadHealth} ===`)
  return safeJsonStringify(analysis)
}
