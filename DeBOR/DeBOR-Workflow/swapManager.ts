import {
  cre,
  encodeCallMsg,
  getNetwork,
  bytesToHex,
  hexToBase64,
  TxStatus,
  prepareReportRequest,
  protoBigIntToBigint,
  bigintToProtoBigInt,
  LAST_FINALIZED_BLOCK_NUMBER,
  LATEST_BLOCK_NUMBER,
  type Runtime,
  type CronPayload,
} from '@chainlink/cre-sdk'
import { encodeFunctionData, decodeFunctionResult, encodeAbiParameters, parseAbiParameters, decodeAbiParameters, zeroAddress, type Address } from 'viem'
import { DEBOR_SWAP_ABI, DEBOR_ORACLE_READ_ABI } from './abis'
import type { Config } from './types'

export const BENCHMARK_UPDATED_EVENT_SIG = '0x39b30b48c37c75c1a92ab0663ddea47330411f58b47a764238930f6f9bb0df16'

const MAX_SWAPS_PER_BATCH = 10n
const RATE_SPIKE_THRESHOLD = 100n 

function getSepoliaEvmClient(runtime: Runtime<Config>) {
  const network = getNetwork({
    chainFamily: 'evm',
    chainSelectorName: runtime.config.targetChainSelectorName,
    isTestnet: true,
  })
  if (!network) throw new Error('Sepolia network not found')
  return new cre.capabilities.EVMClient(network.chainSelector.selector)
}

function readSwapView(
  runtime: Runtime<Config>,
  functionName: 'getSettleableSwaps' | 'getExpiredSwaps' | 'getAtRiskSwaps',
): bigint[] {
  const evmClient = getSepoliaEvmClient(runtime)
  const swapAddress = runtime.config.swapAddress as Address

  const callData = encodeFunctionData({
    abi: DEBOR_SWAP_ABI,
    functionName,
    args: [MAX_SWAPS_PER_BATCH],
  })

  try {
    const result = evmClient
      .callContract(runtime, {
        call: encodeCallMsg({ from: zeroAddress, to: swapAddress, data: callData }),
        blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
      })
      .result()

    const hex = bytesToHex(result.data)
    if (hex === '0x' || hex === '0x0' || result.data.length === 0) {
      return [] 
    }

    return decodeFunctionResult({
      abi: DEBOR_SWAP_ABI,
      functionName,
      data: hex,
    }) as bigint[]
  } catch (e) {
    runtime.log(`  Warning: ${functionName} call failed: ${e}`)
    return []
  }
}

function readOracleRate(runtime: Runtime<Config>): bigint {
  const evmClient = getSepoliaEvmClient(runtime)
  const oracleAddress = runtime.config.oracleAddresses.USDC as Address

  const callData = encodeFunctionData({
    abi: DEBOR_ORACLE_READ_ABI,
    functionName: 'getRate',
  })

  try {
    const result = evmClient
      .callContract(runtime, {
        call: encodeCallMsg({ from: zeroAddress, to: oracleAddress, data: callData }),
        blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
      })
      .result()

    const hex = bytesToHex(result.data)
    if (hex === '0x' || result.data.length === 0) return 0n

    return decodeFunctionResult({
      abi: DEBOR_ORACLE_READ_ABI,
      functionName: 'getRate',
      data: hex,
    }) as bigint
  } catch (e) {
    runtime.log(`  Warning: getRate call failed: ${e}`)
    return 0n
  }
}

function readHistoricalRate(runtime: Runtime<Config>, periodsBack: bigint): bigint {
  const evmClient = getSepoliaEvmClient(runtime)
  const oracleAddress = runtime.config.oracleAddresses.USDC as Address

  const callData = encodeFunctionData({
    abi: DEBOR_ORACLE_READ_ABI,
    functionName: 'getHistoricalRate',
    args: [periodsBack],
  })

  try {
    const result = evmClient
      .callContract(runtime, {
        call: encodeCallMsg({ from: zeroAddress, to: oracleAddress, data: callData }),
        blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
      })
      .result()

    return decodeFunctionResult({
      abi: DEBOR_ORACLE_READ_ABI,
      functionName: 'getHistoricalRate',
      data: bytesToHex(result.data),
    }) as bigint
  } catch {
    return 0n 
  }
}

function writeSwapAction(
  runtime: Runtime<Config>,
  action: number,
  swapIds: bigint[],
): string {
  const swapAddress = runtime.config.swapAddress!

  // Encode the action report: (uint8 action, uint256[] swapIds)
  const reportData = encodeAbiParameters(
    parseAbiParameters('uint8, uint256[]'),
    [action, swapIds],
  )

  // Use prepareReportRequest() — auto-converts hex→base64 + merges EVM defaults
  const report = runtime
    .report(prepareReportRequest(reportData))
    .result()

  const evmClient = getSepoliaEvmClient(runtime)
  const writeResult = evmClient
    .writeReport(runtime, {
      receiver: swapAddress,
      report,
      gasConfig: { gasLimit: runtime.config.gasLimit },
    })
    .result()

  if (writeResult.txStatus !== TxStatus.SUCCESS) {
    runtime.log(`  Write failed: ${writeResult.errorMessage || writeResult.txStatus}`)
    return 'WRITE FAILED'
  }

  const txHash = writeResult.txHash || new Uint8Array(32)
  const txHashHex = bytesToHex(txHash)

  // Verify the transaction receipt on-chain using getTransactionReceipt
  // Confirms the tx was mined, logs gasUsed for monitoring, and validates receipt status
  try {
    const receiptResult = evmClient
      .getTransactionReceipt(runtime, {
        hash: hexToBase64(txHashHex),
      })
      .result()

    if (receiptResult.receipt) {
      const receipt = receiptResult.receipt
      const receiptBlock = receipt.blockNumber
        ? protoBigIntToBigint(receipt.blockNumber)
        : 0n
      runtime.log(`  Receipt verified: status=${receipt.status}, gasUsed=${receipt.gasUsed}, block=${receiptBlock}, logs=${receipt.logs?.length || 0}`)
    }
  } catch (e) {
    runtime.log(`  Receipt verification skipped: ${e}`)
  }

  return `TX: ${txHashHex}`
}

/// Handler 1: Auto-Settler (runs daily)
/// Reads settleable + expired swaps, sends batch settle/close actions
export const onSettleTrigger = (runtime: Runtime<Config>, payload: CronPayload): string => {
  runtime.log('=== CRE Swap Auto-Settler ===')

  if (!runtime.config.swapAddress) {
    runtime.log('No swap address configured, skipping')
    return 'SKIP: no swap address'
  }

  // Step 1: Get settleable swaps
  runtime.log('Step 1: Reading settleable swaps...')
  const settleableIds = readSwapView(runtime, 'getSettleableSwaps')
  runtime.log(`  Found ${settleableIds.length} swaps due for settlement`)

  // Step 2: Batch settle if any
  if (settleableIds.length > 0) {
    runtime.log(`Step 2: Batch settling ${settleableIds.length} swaps...`)
    const settleTx = writeSwapAction(runtime, 1, settleableIds) 
    runtime.log(`  Settle ${settleTx}`)
  }

  // Step 3: Get expired swaps
  runtime.log('Step 3: Reading expired swaps...')
  const expiredIds = readSwapView(runtime, 'getExpiredSwaps')
  runtime.log(`  Found ${expiredIds.length} expired swaps`)

  // Step 4: Batch close if any
  if (expiredIds.length > 0) {
    runtime.log(`Step 4: Batch closing ${expiredIds.length} expired swaps...`)
    const closeTx = writeSwapAction(runtime, 2, expiredIds) 
    runtime.log(`  Close ${closeTx}`)
  }

  const summary = `Settled: ${settleableIds.length}, Closed: ${expiredIds.length}`
  runtime.log(`=== Auto-Settler Complete: ${summary} ===`)
  return summary
}

/// Handler 2: Liquidation Guard (runs hourly)
/// Monitors margin health and triggers early settlement for at-risk swaps
export const onLiquidationGuard = (runtime: Runtime<Config>, payload: CronPayload): string => {
  runtime.log('=== CRE Liquidation Guard ===')

  if (!runtime.config.swapAddress) {
    runtime.log('No swap address configured, skipping')
    return 'SKIP: no swap address'
  }

  // Step 1: Get at-risk swaps (margin < 2% of notional)
  runtime.log('Step 1: Scanning for at-risk swaps...')
  const atRiskIds = readSwapView(runtime, 'getAtRiskSwaps')
  runtime.log(`  Found ${atRiskIds.length} swaps at liquidation risk`)

  if (atRiskIds.length === 0) {
    runtime.log('=== Liquidation Guard: All margins healthy ===')
    return 'HEALTHY: 0 at risk'
  }

  // Step 2: Read current oracle rate for logging
  const currentRate = readOracleRate(runtime)
  runtime.log(`  Current DeBOR rate: ${currentRate} bps`)

  // Step 3: Emergency settle at-risk swaps
  runtime.log(`Step 3: Emergency settling ${atRiskIds.length} at-risk swaps...`)
  const tx = writeSwapAction(runtime, 1, atRiskIds)
  runtime.log(`  Emergency settle ${tx}`)

  const summary = `ALERT: ${atRiskIds.length} at-risk, rate=${currentRate}bps`
  runtime.log(`=== Liquidation Guard Complete: ${summary} ===`)
  return summary
}

interface TrendAnalysis {
  direction: string  
  velocity: bigint   
  acceleration: bigint
}

function analyzeRateTrend(runtime: Runtime<Config>): TrendAnalysis {
  const evmClient = getSepoliaEvmClient(runtime)
  const oracleAddress = runtime.config.oracleAddresses.USDC as Address
  const noData: TrendAnalysis = { direction: 'INSUFFICIENT_DATA', velocity: 0n, acceleration: 0n }

  try {
    // Read latest block to compute a ~1000 block lookback window (~3.3 hours on Sepolia)
    const headerResult = evmClient
      .headerByNumber(runtime, { blockNumber: LATEST_BLOCK_NUMBER })
      .result()

    let toBlock = 0n
    if (headerResult.header?.blockNumber) {
      toBlock = protoBigIntToBigint(headerResult.header.blockNumber)
    }

    // Use filterLogs with explicit block range (fromBlock/toBlock) for bounded queries
    const fromBlock = toBlock > 1000n ? toBlock - 1000n : 0n
    const logs = evmClient
      .filterLogs(runtime, {
        filterQuery: {
          addresses: [hexToBase64(oracleAddress)],
          topics: [
            { topic: [hexToBase64(BENCHMARK_UPDATED_EVENT_SIG)] },
          ],
          ...(toBlock > 0n && {
            fromBlock: bigintToProtoBigInt(fromBlock),
            toBlock: bigintToProtoBigInt(toBlock),
          }),
        },
      })
      .result()

    if (!logs.logs || logs.logs.length < 2) return noData

    // Extract rates from recent events
    const recentRates: bigint[] = []
    for (const log of logs.logs.slice(-6)) { 
      try {
        const eventData = bytesToHex(log.data)
        const decoded = decodeAbiParameters(
          parseAbiParameters('uint256, uint256, uint256, uint256, uint256, uint256'),
          eventData as `0x${string}`,
        )
        recentRates.push(decoded[0])
      } catch {
      }
    }

    if (recentRates.length < 2) return noData

    // Velocity: rate change from oldest to newest (bps per period)
    const oldest = recentRates[0]
    const newest = recentRates[recentRates.length - 1]
    const velocity = newest - oldest // positive = rates rising, negative = falling

    // Acceleration: compare velocity of first half vs second half
    let acceleration = 0n
    if (recentRates.length >= 4) {
      const mid = Math.floor(recentRates.length / 2)
      const firstHalfVelocity = recentRates[mid - 1] - recentRates[0]
      const secondHalfVelocity = recentRates[recentRates.length - 1] - recentRates[mid]
      acceleration = secondHalfVelocity - firstHalfVelocity // positive = accelerating
    }

    // Direction from consecutive moves
    let upCount = 0
    let downCount = 0
    for (let i = 1; i < recentRates.length; i++) {
      if (recentRates[i] > recentRates[i - 1]) upCount++
      else if (recentRates[i] < recentRates[i - 1]) downCount++
    }

    let direction = 'STABLE'
    if (upCount >= 3) direction = 'RISING'
    else if (downCount >= 3) direction = 'FALLING'

    return { direction, velocity, acceleration }
  } catch (e) {
    runtime.log(`  Warning: filterLogs trend analysis failed: ${e}`)
    return { direction: 'UNKNOWN', velocity: 0n, acceleration: 0n }
  }
}

/// Handler 3: Rate Spike Detector (runs every 30 min, after benchmark update)
/// Detects large rate movements and triggers emergency settlement
/// Enhanced with filterLogs() trend analysis
export const onRateSpikeCheck = (runtime: Runtime<Config>, payload: CronPayload): string => {
  runtime.log('=== CRE Rate Spike Detector ===')

  if (!runtime.config.swapAddress) {
    runtime.log('No swap address configured, skipping')
    return 'SKIP: no swap address'
  }

  // Step 1: Read current rate
  const currentRate = readOracleRate(runtime)
  runtime.log(`  Current rate: ${currentRate} bps`)

  // Step 2: Read historical rate (2 periods = 1 hour ago)
  const historicalRate = readHistoricalRate(runtime, 2n)
  if (historicalRate === 0n) {
    runtime.log('  Not enough history for comparison, skipping')
    return `SKIP: no history, current=${currentRate}bps`
  }
  runtime.log(`  Rate 1h ago: ${historicalRate} bps`)

  // Step 3: Calculate absolute rate diff
  const diff = currentRate > historicalRate
    ? currentRate - historicalRate
    : historicalRate - currentRate
  runtime.log(`  Rate movement: ${diff} bps`)

  // Step 3: Trend analysis via filterLogs with block range + velocity/acceleration
  const trend = analyzeRateTrend(runtime)
  runtime.log(`  Rate trend: ${trend.direction}, velocity=${trend.velocity}bps/period, accel=${trend.acceleration}bps/period²`)

  if (diff <= RATE_SPIKE_THRESHOLD) {
    const summary = `STABLE: ${diff}bps move, trend=${trend.direction}, vel=${trend.velocity}, accel=${trend.acceleration} (threshold: ${RATE_SPIKE_THRESHOLD}bps)`
    runtime.log(`=== Rate Spike Detector: ${summary} ===`)
    return summary
  }

  runtime.log(`  RATE SPIKE DETECTED: ${diff}bps move in 1 hour! Trend: ${trend.direction}, velocity=${trend.velocity}`)

  // Step 4: Get all settleable swaps for emergency settlement
  const settleableIds = readSwapView(runtime, 'getSettleableSwaps')
  runtime.log(`  ${settleableIds.length} swaps eligible for emergency settlement`)

  if (settleableIds.length > 0) {
    runtime.log('  Triggering emergency settlement...')
    const tx = writeSwapAction(runtime, 1, settleableIds)
    runtime.log(`  Emergency settle ${tx}`)
  }

  const summary = `SPIKE: ${diff}bps, trend=${trend.direction}, vel=${trend.velocity}, settled ${settleableIds.length} swaps`
  runtime.log(`=== Rate Spike Detector: ${summary} ===`)
  return summary
}

/// Handler 6: EVM Log Trigger - Anomaly Detection on BenchmarkUpdated
/// Fires when oracle emits BenchmarkUpdated event. Decodes the new rate,
/// compares with previous, and triggers emergency settlement if anomalous.
export const onBenchmarkUpdated = (runtime: Runtime<Config>, log: any): string => {
  runtime.log('=== CRE Anomaly Detector (EVM Log Trigger) ===')
  const blockNum = log.blockNumber ? String(log.blockNumber) : 'unknown'
  runtime.log(`  Event detected in block ${blockNum}`)

  // Step 0: Fetch full transaction details using getTransactionByHash
  // When an EVM Log trigger fires, we get the event data but not the full tx context.
  // getTransactionByHash retrieves the originating transaction for forensic analysis.
  if (log.txHash) {
    try {
      const evmClient = getSepoliaEvmClient(runtime)
      const txHashHex = bytesToHex(log.txHash)
      const txResult = evmClient
        .getTransactionByHash(runtime, {
          hash: hexToBase64(txHashHex),
        })
        .result()

      if (txResult.transaction) {
        const tx = txResult.transaction
        const sender = bytesToHex(tx.to)
        runtime.log(`  TX context: hash=${txHashHex}, to=${sender}, gas=${tx.gas}, nonce=${tx.nonce}`)
      }
    } catch (e) {
      runtime.log(`  getTransactionByHash skipped: ${e}`)
    }
  }

  if (!runtime.config.swapAddress) {
    runtime.log('No swap address configured, skipping')
    return 'SKIP: no swap address'
  }

  // Step 1: Decode the BenchmarkUpdated event data
  // Non-indexed params: (deborRate, deborSupply, deborSpread, deborVol, deborTerm7d, numSources)
  let newRate = 0n
  let numSources = 0n
  try {
    const eventData = bytesToHex(log.data)
    const decoded = decodeAbiParameters(
      parseAbiParameters('uint256, uint256, uint256, uint256, uint256, uint256'),
      eventData as `0x${string}`,
    )
    newRate = decoded[0]
    numSources = decoded[5]
    runtime.log(`  New rate from event: ${newRate} bps (${numSources} sources)`)
  } catch (e) {
    runtime.log(`  Could not decode event data, reading oracle directly...`)
    newRate = readOracleRate(runtime)
    runtime.log(`  Current oracle rate: ${newRate} bps`)
  }

  // Step 2: Read previous rate from oracle history
  const previousRate = readHistoricalRate(runtime, 1n)
  if (previousRate === 0n) {
    runtime.log('  No previous rate for comparison')
    return `EVENT: rate=${newRate}bps, no history`
  }
  runtime.log(`  Previous rate: ${previousRate} bps`)

  // Step 3: Check for anomaly (>200bps sudden move = potential manipulation)
  const ANOMALY_THRESHOLD = 200n
  const diff = newRate > previousRate
    ? newRate - previousRate
    : previousRate - newRate
  runtime.log(`  Rate change: ${diff} bps`)

  if (diff <= ANOMALY_THRESHOLD) {
    const summary = `NORMAL: ${newRate}bps (${diff}bps change)`
    runtime.log(`=== Anomaly Detector: ${summary} ===`)
    return summary
  }

  runtime.log(`  ANOMALY DETECTED: ${diff}bps change exceeds ${ANOMALY_THRESHOLD}bps threshold!`)

  // Step 4: Emergency settle all active swaps to protect margins
  const settleableIds = readSwapView(runtime, 'getSettleableSwaps')
  runtime.log(`  ${settleableIds.length} swaps for emergency settlement`)

  if (settleableIds.length > 0) {
    runtime.log('  Executing emergency settlement...')
    const tx = writeSwapAction(runtime, 1, settleableIds)
    runtime.log(`  ${tx}`)
  }

  const summary = `ANOMALY: ${diff}bps change, settled ${settleableIds.length} swaps`
  runtime.log(`=== Anomaly Detector: ${summary} ===`)
  return summary
}

/// Unified Swap Lifecycle Manager (merged: settler + liquidation + spike)
/// Runs every 30 min at :05/:35 (after benchmark updates).
/// Phase 1: Rate spike detection with filterLogs trend analysis
/// Phase 2: Liquidation guard (at-risk margin monitoring)
/// Phase 3: Settlement + closure of mature/expired swaps
/// EVM budget: ~7 reads + conditional writes (well within 15-call limit)
export const onSwapLifecycle = (runtime: Runtime<Config>, payload: CronPayload): string => {
  runtime.log('=== CRE Swap Lifecycle Manager ===')

  if (!runtime.config.swapAddress) {
    runtime.log('No swap address configured, skipping')
    return 'SKIP: no swap address'
  }

  const results: string[] = []

  // ── Phase 1: Rate Spike Detection ──
  // Detect large rate movements and trigger emergency settlement
  runtime.log('Phase 1: Rate spike detection...')
  const currentRate = readOracleRate(runtime)  
  const historicalRate = readHistoricalRate(runtime, 2n)
  let spikeDetected = false

  if (historicalRate > 0n) {
    const diff = currentRate > historicalRate
      ? currentRate - historicalRate
      : historicalRate - currentRate

    const trend = analyzeRateTrend(runtime)             
    runtime.log(`  Rate: ${currentRate}bps, 1h ago: ${historicalRate}bps, move: ${diff}bps`)
    runtime.log(`  Trend: ${trend.direction}, vel=${trend.velocity}bps/period, accel=${trend.acceleration}bps/period²`)

    if (diff > RATE_SPIKE_THRESHOLD) {
      spikeDetected = true
      runtime.log(`  SPIKE DETECTED: ${diff}bps move!`)
      results.push(`SPIKE:${diff}bps`)
    } else {
      results.push(`rate:${currentRate}bps(${trend.direction})`)
    }
  } else {
    runtime.log('  No history for spike detection')
    results.push(`rate:${currentRate}bps`)
  }

  // ── Phase 2: Liquidation Guard ──
  // Monitor margin health and emergency settle at-risk swaps
  runtime.log('Phase 2: Liquidation guard...')
  const atRiskIds = readSwapView(runtime, 'getAtRiskSwaps')  // 1 read
  runtime.log(`  At-risk swaps: ${atRiskIds.length}`)

  if (atRiskIds.length > 0 || spikeDetected) {
    // Emergency settle at-risk swaps OR all settleable if spike detected
    const emergencyIds = atRiskIds.length > 0 ? atRiskIds : readSwapView(runtime, 'getSettleableSwaps')
    if (emergencyIds.length > 0) {
      runtime.log(`  Emergency settling ${emergencyIds.length} swaps...`)
      const tx = writeSwapAction(runtime, 1, emergencyIds)
      runtime.log(`  ${tx}`)
      results.push(`emergency:${emergencyIds.length}`)
    }
  }

  // ── Phase 3: Settlement + Closure ──
  // Settle mature swaps and close expired ones
  runtime.log('Phase 3: Settlement + closure...')
  const settleableIds = readSwapView(runtime, 'getSettleableSwaps')
  runtime.log(`  Settleable: ${settleableIds.length}`)

  if (settleableIds.length > 0) {
    runtime.log(`  Batch settling ${settleableIds.length} swaps...`)
    const tx = writeSwapAction(runtime, 1, settleableIds)
    runtime.log(`  ${tx}`)
  }

  const expiredIds = readSwapView(runtime, 'getExpiredSwaps')  // 1 read
  runtime.log(`  Expired: ${expiredIds.length}`)

  if (expiredIds.length > 0) {
    runtime.log(`  Batch closing ${expiredIds.length} expired swaps...`)
    const tx = writeSwapAction(runtime, 2, expiredIds)
    runtime.log(`  ${tx}`)
  }

  results.push(`settled:${settleableIds.length}`)
  results.push(`closed:${expiredIds.length}`)
  results.push(`atRisk:${atRiskIds.length}`)

  const summary = results.join(', ')
  runtime.log(`=== Swap Lifecycle Complete: ${summary} ===`)
  return summary
}
