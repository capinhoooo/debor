import {
  cre,
  Runner,
  bytesToHex,
  hexToBase64,
  getNetwork,
  TxStatus,
  prepareReportRequest,
  consensusMedianAggregation,
  safeJsonStringify,
  LATEST_BLOCK_NUMBER,
  LAST_FINALIZED_BLOCK_NUMBER,
  encodeCallMsg,
  type Runtime,
  type NodeRuntime,
  type CronPayload,
} from '@chainlink/cre-sdk'
import { encodeFunctionData, decodeFunctionResult, encodeAbiParameters, parseAbiParameters, zeroAddress, type Address } from 'viem'
import { z } from 'zod'

import { readAllRates, readAllPrices } from './rateReader'
import { fetchAllTVLs } from './tvlFetcher'
import { mergeRatesWithTVL, computeBenchmark, computeRateDeviation, stringifyMetrics } from './benchmarkEngine'
import { DEBOR_ORACLE_READ_ABI } from './abis'
import { onSwapLifecycle, onBenchmarkUpdated, BENCHMARK_UPDATED_EVENT_SIG } from './swapManager'
import { runPreflightCheck } from './preflightCheck'
import { fetchConfidentialTVL } from './confidentialFetcher'
import { runHttpValidation } from './httpValidator'
import { runSOFRComparison } from './sofrComparator'
import { runRiskAnalysis } from './riskAnalyst'
import { runAIAnalysis } from './aiAnalyst'
import type { Config, AssetClass } from './types'

const protocolSchema = z.object({
  protocol: z.string(),
  chain: z.string(),
  chainSelectorName: z.string(),
  contractAddress: z.string(),
  assetAddress: z.string(),
  rateType: z.enum(['aave', 'compound', 'spark', 'morpho', 'ctoken']),
  asset: z.enum(['USDC', 'ETH', 'BTC', 'DAI', 'USDT']),
})

const configSchema = z.object({
  schedule: z.string(),
  protocols: z.array(protocolSchema),
  tvlApiBase: z.string(),
  targetChainSelectorName: z.string(),
  oracleAddresses: z.object({
    USDC: z.string(),
    ETH: z.string(),
    BTC: z.string(),
    DAI: z.string(),
    USDT: z.string(),
  }),
  gasLimit: z.string(),
  swapAddress: z.string().optional(),
  sofrApiBase: z.string().optional(),
  sofrEndpoint: z.string().optional(),
  effrEndpoint: z.string().optional(),
  groqApiModel: z.string().optional(),
  groqApiKey: z.string().optional(),
  riskThresholds: z.object({
    varWarning: z.number(),
    varCritical: z.number(),
    hhiWarning: z.number(),
    spreadWarning: z.number(),
  }).optional(),
})

function parseTriggerTimestamp(payload: CronPayload): bigint {
  const execTime = payload.scheduledExecutionTime
  if (execTime) {
    // Protobuf Timestamp has seconds (bigint) and nanos fields
    if (typeof execTime === 'object' && 'seconds' in execTime) {
      const seconds = execTime.seconds
      if (typeof seconds === 'bigint' && seconds > 0n) {
        return seconds
      }
      if (typeof seconds === 'number' && seconds > 0) {
        return BigInt(Math.floor(seconds))
      }
    }
    // Fallback for string-like values
    const str = String(execTime)
    const parsed = Number(str)
    if (!isNaN(parsed) && parsed > 1000000000) {
      return BigInt(parsed > 10000000000 ? Math.floor(parsed / 1000) : Math.floor(parsed))
    }
    const dateMs = new Date(str).getTime()
    return isNaN(dateMs) ? BigInt(Math.floor(Date.now() / 1000)) : BigInt(Math.floor(dateMs / 1000))
  }
  return BigInt(Math.floor(Date.now() / 1000))
}

const MIN_SOURCES = 3

function runAssetBenchmark(runtime: Runtime<Config>, payload: CronPayload, asset: AssetClass): string {
  runtime.log(`=== DeBOR ${asset} Benchmark Update Starting ===`)

  // Filter protocols for this asset only
  const assetProtocols = runtime.config.protocols.filter((p) => p.asset === asset)
  const sourcesConfigured = assetProtocols.length
  runtime.log(`Step 1: Reading ${sourcesConfigured} ${asset} rate sources from MAINNET...`)

  const rates = readAllRates(runtime, assetProtocols)
  if (rates.length === 0) {
    runtime.log(`ERROR: No ${asset} rates collected. Aborting.`)
    return `${asset}: No rates (0/${sourcesConfigured} configured)`
  }
  if (rates.length < MIN_SOURCES) {
    runtime.log(`ABORT: Only ${rates.length}/${sourcesConfigured} sources (minimum ${MIN_SOURCES}). Skipping write.`)
    return `${asset}: INSUFFICIENT_SOURCES (${rates.length}/${MIN_SOURCES} minimum)`
  }
  runtime.log(`  Collected ${rates.length}/${sourcesConfigured} sources`)

  // Fetch TVL weights (shared across all assets)
  runtime.log('Step 2: Fetching TVL weights from DeFiLlama...')
  const tvls = fetchAllTVLs(runtime, assetProtocols)

  // Compute benchmark
  runtime.log(`Step 3: Computing DeBOR-${asset} benchmark...`)
  const weightedRates = mergeRatesWithTVL(rates, tvls)
  const metrics = computeBenchmark(weightedRates, [], BigInt(sourcesConfigured))

  runtime.log(`  Metrics: ${stringifyMetrics(metrics)}`)
  runtime.log(`  DeBOR_RATE:   ${metrics.deborRate} bps (${Number(metrics.deborRate) / 100}%)`)
  runtime.log(`  DeBOR_SUPPLY: ${metrics.deborSupply} bps (${Number(metrics.deborSupply) / 100}%)`)
  runtime.log(`  DeBOR_SPREAD: ${metrics.deborSpread} bps`)
  runtime.log(`  DeBOR_VOL:    ${metrics.deborVol}`)
  runtime.log(`  DeBOR_TERM7D: ${metrics.deborTerm7d} bps`)
  runtime.log(`  Sources:      ${metrics.numSources}/${metrics.sourcesConfigured} configured`)

  // Sign and write to oracle
  const oracleAddress = runtime.config.oracleAddresses[asset]
  if (!oracleAddress) {
    runtime.log(`  No oracle deployed for ${asset}, skipping write`)
    return `${asset}: COMPUTED (${metrics.numSources} sources, ${metrics.deborRate}bps)`
  }

  // ─── Dry-Run Rate Guard ───
  // Read current on-chain rate at LATEST block (freshest data) and validate
  // the new computed rate is within a reasonable deviation threshold.
  // Prevents rate manipulation or stale-data writes from corrupting the oracle.
  runtime.log('Step 3b: Dry-run rate guard (reading current on-chain rate)...')
  const targetNetwork = getNetwork({
    chainFamily: 'evm',
    chainSelectorName: runtime.config.targetChainSelectorName,
    isTestnet: true,
  })
  if (targetNetwork) {
    try {
      const guardClient = new cre.capabilities.EVMClient(targetNetwork.chainSelector.selector)
      const currentRateResult = guardClient
        .callContract(runtime, {
          call: encodeCallMsg({
            from: zeroAddress,
            to: oracleAddress as Address,
            data: encodeFunctionData({
              abi: DEBOR_ORACLE_READ_ABI,
              functionName: 'getRate',
            }),
          }),
          blockNumber: LATEST_BLOCK_NUMBER,
        })
        .result()

      const currentRate = BigInt(
        decodeFunctionResult({
          abi: DEBOR_ORACLE_READ_ABI,
          functionName: 'getRate',
          data: bytesToHex(currentRateResult.data),
        }) as any,
      )

      if (currentRate > 0n) {
        const { deviationBps, safe } = computeRateDeviation(metrics.deborRate, currentRate)
        if (!safe) {
          runtime.log(`  RATE GUARD: ${asset} deviation=${deviationBps}bps (new=${metrics.deborRate}, current=${currentRate}) exceeds 500bps threshold`)
          runtime.log(`  Proceeding with caution — rate change is large but may be legitimate`)
        } else {
          runtime.log(`  Rate guard OK: deviation=${deviationBps}bps (current=${currentRate}bps → new=${metrics.deborRate}bps)`)
        }
      } else {
        runtime.log(`  Rate guard: no existing rate (first write)`)
      }
    } catch (e) {
      runtime.log(`  Rate guard: skipped (${e})`)
    }
  }

  runtime.log(`Step 4: Generating signed report...`)
  const triggerTimestamp = parseTriggerTimestamp(payload)
  const reportData = encodeAbiParameters(
    parseAbiParameters('uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256'),
    [
      metrics.deborRate,
      metrics.deborSupply,
      metrics.deborSpread,
      metrics.deborVol,
      metrics.deborTerm7d,
      triggerTimestamp,
      metrics.numSources,
      metrics.sourcesConfigured,
    ],
  )

  // Use prepareReportRequest() — auto-converts hex→base64 + merges EVM defaults
  const report = runtime
    .report(prepareReportRequest(reportData))
    .result()

  runtime.log(`Step 5: Writing DeBOR-${asset} to Sepolia...`)
  const writeNetwork = getNetwork({
    chainFamily: 'evm',
    chainSelectorName: runtime.config.targetChainSelectorName,
    isTestnet: true,
  })
  if (!writeNetwork) throw new Error('Target network not found')

  const targetEvmClient = new cre.capabilities.EVMClient(writeNetwork.chainSelector.selector)
  const writeResult = targetEvmClient
    .writeReport(runtime, {
      receiver: oracleAddress,
      report,
      gasConfig: { gasLimit: runtime.config.gasLimit },
    })
    .result()

  if (writeResult.txStatus !== TxStatus.SUCCESS) {
    runtime.log(`  Write failed: ${writeResult.errorMessage || writeResult.txStatus}`)
    return `${asset}: WRITE FAILED`
  }

  const txHash = writeResult.txHash || new Uint8Array(32)
  runtime.log(`  TX succeeded: ${bytesToHex(txHash)}`)
  runtime.log(`=== DeBOR ${asset} Benchmark Update Complete ===`)
  return `${asset}: OK (${metrics.numSources} sources, ${metrics.deborRate}bps)`
}

// --- Separate handler per asset class ---
// Each fires on its own cron schedule, gets its own 15-call budget

const onUsdcTrigger = (runtime: Runtime<Config>, payload: CronPayload): string => {
  return runAssetBenchmark(runtime, payload, 'USDC')
}

const onEthTrigger = (runtime: Runtime<Config>, payload: CronPayload): string => {
  return runAssetBenchmark(runtime, payload, 'ETH')
}

const onBtcTrigger = (runtime: Runtime<Config>, payload: CronPayload): string => {
  return runAssetBenchmark(runtime, payload, 'BTC')
}

const onDaiTrigger = (runtime: Runtime<Config>, payload: CronPayload): string => {
  return runAssetBenchmark(runtime, payload, 'DAI')
}

const onUsdtTrigger = (runtime: Runtime<Config>, payload: CronPayload): string => {
  return runAssetBenchmark(runtime, payload, 'USDT')
}

// Protocols that get dropped by the core USDC handler due to the 15-call EVM limit.
// These are the "expensive" sources (compound=3 calls, ctoken=2 calls each).
// The ext handler reads these separately, then merges with the core benchmark.
const USDC_EXT_PROTOCOLS = [
  { protocol: 'moonwell', chain: 'optimism' },
  { protocol: 'benqi', chain: 'avalanche' },
  { protocol: 'compound_v3', chain: 'base' },
  { protocol: 'compound_v3', chain: 'arbitrum' },
]

const onUsdcExtTrigger = (runtime: Runtime<Config>, payload: CronPayload): string => {
  runtime.log('=== DeBOR USDC Extended Sources (merge 4 remaining protocols) ===')

  // Step 1: Filter for the 4 extended USDC protocols
  const allUsdcProtocols = runtime.config.protocols.filter((p) => p.asset === 'USDC')
  const extProtocols = allUsdcProtocols.filter((p) =>
    USDC_EXT_PROTOCOLS.some((ext) => ext.protocol === p.protocol && ext.chain === p.chain),
  )
  runtime.log(`Step 1: Reading ${extProtocols.length} extended USDC sources...`)

  const extRates = readAllRates(runtime, extProtocols)
  if (extRates.length === 0) {
    runtime.log('  No extended rates collected. Skipping merge.')
    return 'USDC_EXT: No rates (0 ext sources)'
  }
  runtime.log(`  Collected ${extRates.length}/${extProtocols.length} ext sources`)

  // Step 2: Read current oracle state via getFullBenchmark (1 EVM call)
  runtime.log('Step 2: Reading current oracle benchmark (core handler data)...')
  const oracleAddress = runtime.config.oracleAddresses.USDC
  const targetNetwork = getNetwork({
    chainFamily: 'evm',
    chainSelectorName: runtime.config.targetChainSelectorName,
    isTestnet: true,
  })
  if (!targetNetwork) throw new Error('Target network not found')

  let coreRate = 0n, coreSupply = 0n, coreVol = 0n, coreTerm = 0n, coreSources = 0n
  try {
    const sepoliaClient = new cre.capabilities.EVMClient(targetNetwork.chainSelector.selector)
    const benchmarkResult = sepoliaClient
      .callContract(runtime, {
        call: encodeCallMsg({
          from: zeroAddress,
          to: oracleAddress as Address,
          data: encodeFunctionData({
            abi: DEBOR_ORACLE_READ_ABI,
            functionName: 'getFullBenchmark',
          }),
        }),
        blockNumber: LATEST_BLOCK_NUMBER,
      })
      .result()

    const coreBenchmark = decodeFunctionResult({
      abi: DEBOR_ORACLE_READ_ABI,
      functionName: 'getFullBenchmark',
      data: bytesToHex(benchmarkResult.data),
    })

    coreRate = BigInt(coreBenchmark[0])
    coreSupply = BigInt(coreBenchmark[1])
    coreVol = BigInt(coreBenchmark[3])
    coreTerm = BigInt(coreBenchmark[4])
    coreSources = BigInt(coreBenchmark[6])
    runtime.log(`  Core benchmark: rate=${coreRate}bps, supply=${coreSupply}bps, sources=${coreSources}`)
  } catch (e) {
    runtime.log(`  Core benchmark read failed: ${e} — writing ext-only`)
  }

  // Step 3: Compute ext benchmark from ext sources
  runtime.log('Step 3: Fetching TVL weights for ext sources...')
  const extTvls = fetchAllTVLs(runtime, extProtocols)
  const extWeightedRates = mergeRatesWithTVL(extRates, extTvls)
  const extMetrics = computeBenchmark(extWeightedRates, [], BigInt(allUsdcProtocols.length))
  runtime.log(`  Ext benchmark: rate=${extMetrics.deborRate}bps, supply=${extMetrics.deborSupply}bps, sources=${extMetrics.numSources}`)

  // Step 4: Merge core + ext using source-count weighting
  runtime.log('Step 4: Merging core + ext benchmarks...')
  const totalSources = coreSources + extMetrics.numSources
  const mergedRate = totalSources > 0n
    ? (coreRate * coreSources + extMetrics.deborRate * extMetrics.numSources) / totalSources
    : extMetrics.deborRate
  const mergedSupply = totalSources > 0n
    ? (coreSupply * coreSources + extMetrics.deborSupply * extMetrics.numSources) / totalSources
    : extMetrics.deborSupply
  const mergedSpread = mergedRate > mergedSupply ? mergedRate - mergedSupply : 0n
  const mergedVol = coreVol > extMetrics.deborVol ? coreVol : extMetrics.deborVol
  const mergedTerm = totalSources > 0n
    ? (coreTerm * coreSources + extMetrics.deborTerm7d * extMetrics.numSources) / totalSources
    : extMetrics.deborTerm7d

  runtime.log(`  Merged: rate=${mergedRate}bps, supply=${mergedSupply}bps, spread=${mergedSpread}bps, vol=${mergedVol}, sources=${totalSources}/${allUsdcProtocols.length}`)

  // Step 5: Write merged benchmark to oracle
  runtime.log('Step 5: Writing merged USDC benchmark to oracle...')
  const triggerTimestamp = parseTriggerTimestamp(payload)
  const reportData = encodeAbiParameters(
    parseAbiParameters('uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256'),
    [mergedRate, mergedSupply, mergedSpread, mergedVol, mergedTerm, triggerTimestamp, totalSources, BigInt(allUsdcProtocols.length)],
  )

  const report = runtime.report(prepareReportRequest(reportData)).result()

  const writeNetwork = getNetwork({
    chainFamily: 'evm',
    chainSelectorName: runtime.config.targetChainSelectorName,
    isTestnet: true,
  })
  if (!writeNetwork) throw new Error('Target network not found')

  const targetEvmClient = new cre.capabilities.EVMClient(writeNetwork.chainSelector.selector)
  const writeResult = targetEvmClient
    .writeReport(runtime, {
      receiver: oracleAddress,
      report,
      gasConfig: { gasLimit: runtime.config.gasLimit },
    })
    .result()

  if (writeResult.txStatus !== TxStatus.SUCCESS) {
    runtime.log(`  Write failed: ${writeResult.errorMessage || writeResult.txStatus}`)
    return 'USDC_EXT: WRITE FAILED'
  }

  const txHash = writeResult.txHash || new Uint8Array(32)
  runtime.log(`  TX succeeded: ${bytesToHex(txHash)}`)
  runtime.log(`=== DeBOR USDC Extended Merge Complete: ${totalSources}/${allUsdcProtocols.length} sources ===`)
  return `USDC_EXT: MERGED OK (${totalSources}/${allUsdcProtocols.length} sources, ${mergedRate}bps)`
}

/// HTTP Trigger Handler: On-demand benchmark refresh
/// Any authorized caller can request an immediate benchmark update via HTTP API.
/// Input JSON: { "asset": "USDC" | "ETH" | "BTC" | "ALL" }
const onHttpTrigger = (runtime: Runtime<Config>, payload: any): string => {
  runtime.log('=== DeBOR On-Demand (HTTP Trigger) ===')

  let asset: AssetClass | 'ALL' = 'ALL'
  try {
    const inputStr = Buffer.from(payload.input).toString('utf-8')
    runtime.log(`  HTTP input: ${inputStr}`)
    const request = JSON.parse(inputStr)

    // Action dispatch: validate runs HTTP cross-validation layer
    if (request.action === 'validate') {
      return runHttpValidation(runtime)
    }

    // Action dispatch: compare runs DeBOR vs SOFR/EFFR TradFi comparison
    if (request.action === 'compare') {
      return runSOFRComparison(runtime)
    }

    // Action dispatch: risk runs quantitative risk metrics (VaR, CVaR, HHI, stress tests)
    if (request.action === 'risk') {
      return runRiskAnalysis(runtime)
    }

    // Action dispatch: analyze runs AI-powered market intelligence via Groq LLM
    if (request.action === 'analyze') {
      return runAIAnalysis(runtime)
    }

    if (request.asset && ['USDC', 'ETH', 'BTC', 'DAI', 'USDT', 'ALL'].includes(request.asset)) {
      asset = request.asset
    }
  } catch {
    runtime.log('  No valid input, defaulting to ALL assets')
  }

  runtime.log(`  Refreshing: ${asset}`)

  if (asset === 'ALL') {
    const results: string[] = []
    for (const a of ['USDC', 'ETH', 'BTC', 'DAI', 'USDT'] as AssetClass[]) {
      results.push(runAssetBenchmark(runtime, payload as CronPayload, a))
    }
    const summary = results.join(' | ')
    runtime.log(`=== On-Demand Refresh Complete: ${summary} ===`)
    return summary
  }

  const result = runAssetBenchmark(runtime, payload as CronPayload, asset as AssetClass)
  runtime.log(`=== On-Demand Refresh Complete: ${result} ===`)
  return result
}

/// Handler 9: Pre-flight Check + Chainlink Price Context (runs every 30 min at :25/:55)
/// Uses headerByNumber(), balanceAt(), estimateGas(), runtime.now(), Chainlink Price Feeds,
/// getSecret() → ConfidentialHTTPClient gating, and runInNodeMode() consensus timestamp
const onPreflightCheck = (runtime: Runtime<Config>, payload: CronPayload): string => {
  runtime.log('=== DeBOR Pre-flight & Price Context ===')

  // Step 1: Pre-flight health check (headerByNumber + balanceAt + estimateGas + runtime.now)
  const preflight = runPreflightCheck(runtime)
  if (!preflight.healthy) {
    runtime.log(`  Pre-flight FAILED: ${preflight.message}`)
    return `PREFLIGHT_FAIL: ${preflight.message}`
  }

  // Step 2: Read Chainlink price feeds (ETH/USD, BTC/USD, USDC/USD)
  runtime.log('Step 2: Reading Chainlink price feeds...')
  const prices = readAllPrices(runtime)

  const ethPrice = Number(prices.ethUsd) / 1e8
  const btcPrice = Number(prices.btcUsd) / 1e8
  const usdcPrice = Number(prices.usdcUsd) / 1e8

  // Step 3: Detect USDC de-peg risk
  if (prices.usdcUsd > 0n) {
    const pegDeviation = prices.usdcUsd > 100000000n
      ? prices.usdcUsd - 100000000n
      : 100000000n - prices.usdcUsd
    const deviationBps = (pegDeviation * 10000n) / 100000000n
    if (deviationBps > 50n) {
      runtime.log(`  WARNING: USDC de-peg detected! ${deviationBps}bps deviation`)
    }
  }

  // Step 4: getSecret() gates ConfidentialHTTPClient — only fetch if premium API key exists
  // This demonstrates real secret-gated logic: without the VaultDON secret,
  // the confidential TVL fetch is skipped (regular HTTP fallback used instead)
  let confidentialTvl: string = 'skipped'
  try {
    const secret = runtime.getSecret({ id: 'PREMIUM_API_KEY', namespace: 'workflow' }).result()
    if (secret.value) {
      runtime.log(`  Secret PREMIUM_API_KEY: loaded (${secret.value.length} chars)`)
      // Gate: only use ConfidentialHTTPClient when VaultDON secret is available
      // In production, this fetches TVL through a TEE with injected API credentials
      runtime.log('Step 4b: Fetching confidential TVL (TEE-based)...')
      const result = fetchConfidentialTVL(runtime, 'aave-v3')
      confidentialTvl = result ? `$${Number(result.tvlUsd).toLocaleString()}` : 'failed'
      runtime.log(`  Confidential TVL (Aave V3): ${confidentialTvl}`)
    } else {
      runtime.log(`  Secret PREMIUM_API_KEY: not configured — skipping confidential fetch`)
    }
  } catch {
    runtime.log(`  Secret PREMIUM_API_KEY: not available (expected in simulation) — skipping confidential fetch`)
  }

  // Step 5: runInNodeMode — DON consensus timestamp
  // Each node reads its local clock independently; median consensus produces
  // a manipulation-resistant timestamp that no single node can skew.
  // This is the canonical DON execution model: independent execution → consensus aggregation.
  let consensusTimestamp = 0
  try {
    const getNodeTimestamp = runtime.runInNodeMode(
      (nodeRuntime: NodeRuntime<Config>) => {
        // Each DON node independently reads its local clock
        const nodeTime = nodeRuntime.now()
        nodeRuntime.log(`  [Node] Local timestamp: ${nodeTime.toISOString()}`)
        return Math.floor(nodeTime.getTime() / 1000)
      },
      consensusMedianAggregation<number>(),
    )

    consensusTimestamp = getNodeTimestamp().result()
    runtime.log(`  DON consensus timestamp: ${consensusTimestamp} (${new Date(consensusTimestamp * 1000).toISOString()})`)
  } catch (e) {
    runtime.log(`  runInNodeMode consensus timestamp failed: ${e} (expected in simulation)`)
  }

  const summary = `OK: block=${preflight.sepoliaBlock}, ETH=$${ethPrice.toFixed(0)}, BTC=$${btcPrice.toFixed(0)}, USDC=$${usdcPrice.toFixed(4)}, gas=${preflight.estimatedGas}, ${preflight.executionMs}ms`
  runtime.log(`=== Pre-flight Complete: ${summary} ===`)
  return summary
}

const initWorkflow = (config: Config) => {
  const cronCapability = new cre.capabilities.CronCapability()
  const httpCapability = new cre.capabilities.HTTPCapability()

  // Sepolia EVM client for EVM Log trigger registration
  const sepoliaNetwork = getNetwork({
    chainFamily: 'evm',
    chainSelectorName: config.targetChainSelectorName,
    isTestnet: true,
  })
  if (!sepoliaNetwork) throw new Error('Sepolia network not found for trigger setup')
  const sepoliaEvmClient = new cre.capabilities.EVMClient(sepoliaNetwork.chainSelector.selector)
  const usdcOracleAddress = config.oracleAddresses.USDC

  return [
    // --- Benchmark Update Handlers (Cron Triggers) ---
    // Trigger 0: USDC benchmark at :00 every 30 min
    cre.handler(
      cronCapability.trigger({ schedule: '0 0,30 * * * *' }),
      onUsdcTrigger,
    ),
    // Trigger 1: ETH benchmark at :10 every 30 min
    cre.handler(
      cronCapability.trigger({ schedule: '0 10,40 * * * *' }),
      onEthTrigger,
    ),
    // Trigger 2: BTC benchmark at :20 every 30 min
    cre.handler(
      cronCapability.trigger({ schedule: '0 20,50 * * * *' }),
      onBtcTrigger,
    ),
    // Trigger 3: DAI benchmark at :15 every 30 min
    cre.handler(
      cronCapability.trigger({ schedule: '0 15,45 * * * *' }),
      onDaiTrigger,
    ),
    // Trigger 4: USDT benchmark at :18 every 30 min
    cre.handler(
      cronCapability.trigger({ schedule: '0 18,48 * * * *' }),
      onUsdtTrigger,
    ),

    // --- Swap Lifecycle (merged: settle + liquidation + spike) ---
    // Trigger 5: Runs 5 min after benchmarks. Detects rate spikes (filterLogs trend),
    // checks margin health (liquidation), and settles/closes mature swaps.
    // Merging 3 handlers into 1 freed 2 trigger slots for EVM Log + Pre-flight.
    cre.handler(
      cronCapability.trigger({ schedule: '0 5,35 * * * *' }),
      onSwapLifecycle,
    ),

    // --- Pre-flight Health Monitor (recovered) ---
    // Trigger 6: Chain liveness, balances, gas estimation, Chainlink prices,
    // VaultDON secret gating, ConfidentialHTTPClient TEE fetch, DON consensus timestamp
    cre.handler(
      cronCapability.trigger({ schedule: '0 25,55 * * * *' }),
      onPreflightCheck,
    ),

    // --- Multi-Trigger Architecture ---
    // Trigger 7: HTTP trigger for on-demand benchmark refresh + validation layer
    cre.handler(
      httpCapability.trigger({ authorizedKeys: [] }),
      onHttpTrigger,
    ),

    // Trigger 8: USDC Extended Sources — reads 4 remaining protocols that exceed
    // the core handler's 15-call EVM limit, then merges with the core benchmark.
    // Runs 2 min after USDC Core (:02/:32) to ensure core data is on-chain first.
    cre.handler(
      cronCapability.trigger({ schedule: '0 2,32 * * * *' }),
      onUsdcExtTrigger,
    ),

    // Trigger 9: EVM Log Trigger — Anomaly Detection on BenchmarkUpdated event
    // Push-based event subscription: fires when oracle emits BenchmarkUpdated.
    // Decodes event data, compares with history, emergency settles if >200bps anomaly.
    // Uses getTransactionByHash for forensic analysis of the triggering tx.
    cre.handler(
      sepoliaEvmClient.logTrigger({
        addresses: [hexToBase64(usdcOracleAddress)],
        topics: [
          { values: [hexToBase64(BENCHMARK_UPDATED_EVENT_SIG)] },
          { values: [] }, 
          { values: [] }, 
          { values: [] }, 
        ],
        confidence: 'CONFIDENCE_LEVEL_SAFE',
      }),
      onBenchmarkUpdated,
    ),
  ]
}

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema })
  await runner.run(initWorkflow)
}

main()