import {
  cre,
  encodeCallMsg,
  getNetwork,
  bytesToHex,
  safeJsonStringify,
  ok,
  text,
  LAST_FINALIZED_BLOCK_NUMBER,
  type Runtime,
} from '@chainlink/cre-sdk'
import { encodeFunctionData, decodeFunctionResult, zeroAddress } from 'viem'
import { DEBOR_ORACLE_READ_ABI } from './abis'
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
// Prompt Builder
// ------------------------------------------------------------------

function buildPrompt(
  snapshots: AssetSnapshot[],
  sofrRateBps: number,
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

Classify risk level, direction, spread health, and anomaly status.`
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

const LLM_DEFAULTS: LLMCallResult = {
  riskLevel: 'MEDIUM',
  riskScore: 50,
  anomalyDetected: false,
  rateDirection: 'STABLE',
  spreadHealth: 'NORMAL',
  explanation: 'LLM unavailable, returning defaults',
  analyzedAt: 0,
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

  // Step 3: Build prompt from all data
  runtime.log('Step 3: Building analysis prompt...')
  const prompt = buildPrompt(snapshots, sofrRateBps)

  // Step 4: Call LLM via HTTPClient (1 HTTP call)
  // Uses deprecated headers map (multiHeaders doesn't serialize correctly via fromJson)
  // In production DON: use ConfidentialHTTPClient with VaultDON for secret injection
  runtime.log('Step 4: Calling LLM via HTTPClient...')
  const model = runtime.config.groqApiModel || DEFAULT_GROQ_MODEL
  const apiKey = runtime.config.groqApiKey || ''

  let result: LLMCallResult = { ...LLM_DEFAULTS }

  if (!apiKey) {
    runtime.log('  GROQ_API_KEY not configured — returning defaults')
  } else {
    try {
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

      const httpClient = new cre.capabilities.HTTPClient()
      const response = httpClient
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

      if (ok(response)) {
        const body = JSON.parse(text(response))
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
        runtime.log(`  LLM call returned status ${response.statusCode}`)
      }
    } catch (e) {
      runtime.log(`  LLM call failed: ${e}`)
    }
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
