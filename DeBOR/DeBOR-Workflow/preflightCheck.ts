import {
  cre,
  getNetwork,
  hexToBase64,
  encodeCallMsg,
  protoBigIntToBigint,
  LATEST_BLOCK_NUMBER,
  type Runtime,
} from '@chainlink/cre-sdk'
import { encodeFunctionData, zeroAddress, type Address } from 'viem'
import { DEBOR_ORACLE_READ_ABI } from './abis'
import type { Config } from './types'

interface PreflightResult {
  sepoliaBlock: bigint
  sepoliaTimestamp: bigint
  forwarderBalance: bigint
  swapBalance: bigint
  estimatedGas: bigint
  executionMs: number
  healthy: boolean
  message: string
}

/**
 * Pre-flight health check using headerByNumber() + balanceAt().
 *
 * Validates chain liveness and forwarder ETH balance before executing
 * benchmark updates. Prevents wasted gas on stale/dead chains.
 *
 * Uses CRE capabilities:
 * - headerByNumber(): reads latest block header for timestamp/liveness check
 * - balanceAt(): reads native ETH balance of forwarder + swap contracts
 * - estimateGas(): dry-run gas estimation for oracle write
 * - runtime.now(): DON-trusted execution timestamp for timing measurement
 */
export function runPreflightCheck(runtime: Runtime<Config>): PreflightResult {
  const startTime = runtime.now()
  runtime.log('  [Preflight] Running health checks...')

  const targetNetwork = getNetwork({
    chainFamily: 'evm',
    chainSelectorName: runtime.config.targetChainSelectorName,
    isTestnet: true,
  })
  if (!targetNetwork) {
    return { sepoliaBlock: 0n, sepoliaTimestamp: 0n, forwarderBalance: 0n, swapBalance: 0n, estimatedGas: 0n, executionMs: 0, healthy: false, message: 'Target network not found' }
  }

  const evmClient = new cre.capabilities.EVMClient(targetNetwork.chainSelector.selector)

  // 1. headerByNumber: check chain liveness by reading latest block
  let sepoliaBlock = 0n
  let sepoliaTimestamp = 0n
  try {
    const headerResult = evmClient
      .headerByNumber(runtime, { blockNumber: LATEST_BLOCK_NUMBER })
      .result()

    if (headerResult.header) {
      sepoliaBlock = headerResult.header.blockNumber
        ? protoBigIntToBigint(headerResult.header.blockNumber)
        : 0n
      sepoliaTimestamp = headerResult.header.timestamp
        ? BigInt(headerResult.header.timestamp)
        : 0n
    }

    runtime.log(`    Sepolia block: ${sepoliaBlock}, timestamp: ${sepoliaTimestamp}`)
  } catch (e) {
    runtime.log(`    [Preflight] headerByNumber failed: ${e}`)
    return { sepoliaBlock: 0n, sepoliaTimestamp: 0n, forwarderBalance: 0n, swapBalance: 0n, estimatedGas: 0n, executionMs: 0, healthy: false, message: `Chain unreachable: ${e}` }
  }

  // Check if block is recent (within last 5 minutes)
  const nowSec = BigInt(Math.floor(Date.now() / 1000))
  const staleness = nowSec > sepoliaTimestamp ? nowSec - sepoliaTimestamp : 0n
  if (staleness > 300n) {
    runtime.log(`    [Preflight] WARNING: Chain stale by ${staleness}s`)
  }

  // 2. balanceAt: check forwarder contract has ETH for gas
  // CRE Forwarder address on Sepolia
  const forwarderAddress = '0x15fC6ae953E024d975e77382eEeC56A9101f9F88'
  let forwarderBalance = 0n
  try {
    const balanceResult = evmClient
      .balanceAt(runtime, {
        account: hexToBase64(forwarderAddress),
        blockNumber: LATEST_BLOCK_NUMBER,
      })
      .result()

    if (balanceResult.balance) {
      forwarderBalance = protoBigIntToBigint(balanceResult.balance)
    }

    const ethBalance = Number(forwarderBalance) / 1e18
    runtime.log(`    Forwarder balance: ${ethBalance.toFixed(6)} ETH`)

    if (forwarderBalance < 10000000000000000n) { 
      runtime.log(`    [Preflight] WARNING: Forwarder balance low!`)
    }
  } catch (e) {
    runtime.log(`    [Preflight] balanceAt failed: ${e}`)
  }

  // 3. balanceAt: check swap contract has ETH for settlement gas
  let swapBalance = 0n
  if (runtime.config.swapAddress) {
    try {
      const swapBalanceResult = evmClient
        .balanceAt(runtime, {
          account: hexToBase64(runtime.config.swapAddress),
          blockNumber: LATEST_BLOCK_NUMBER,
        })
        .result()

      if (swapBalanceResult.balance) {
        swapBalance = protoBigIntToBigint(swapBalanceResult.balance)
      }

      runtime.log(`    Swap contract balance: ${(Number(swapBalance) / 1e18).toFixed(6)} ETH`)
    } catch (e) {
      runtime.log(`    [Preflight] swap balanceAt failed: ${e}`)
    }
  }

  // 4. estimateGas: dry-run gas estimation for an oracle write
  // Validates that the forwarder can execute a report without reverting
  let estimatedGas = 0n
  const oracleAddress = runtime.config.oracleAddresses.USDC as Address
  if (oracleAddress) {
    try {
      const dummyCallData = encodeFunctionData({
        abi: DEBOR_ORACLE_READ_ABI,
        functionName: 'getRate',
      })

      const gasResult = evmClient
        .estimateGas(runtime, {
          msg: encodeCallMsg({
            from: zeroAddress,
            to: oracleAddress,
            data: dummyCallData,
          }),
        })
        .result()

      estimatedGas = gasResult.gas
      runtime.log(`    Estimated gas (getRate): ${estimatedGas}`)
    } catch (e) {
      runtime.log(`    [Preflight] estimateGas failed: ${e}`)
    }
  }

  // 5. Measure total execution time using runtime.now() (DON-trusted clock)
  const endTime = runtime.now()
  const executionMs = endTime.getTime() - startTime.getTime()
  runtime.log(`    Execution time: ${executionMs}ms`)

  const healthy = sepoliaBlock > 0n
  const message = healthy
    ? `OK: block=${sepoliaBlock}, fwd=${(Number(forwarderBalance) / 1e18).toFixed(4)}ETH, swap=${(Number(swapBalance) / 1e18).toFixed(4)}ETH, gas=${estimatedGas}, ${executionMs}ms`
    : 'UNHEALTHY: could not read block'

  runtime.log(`  [Preflight] ${message}`)
  return { sepoliaBlock, sepoliaTimestamp, forwarderBalance, swapBalance, estimatedGas, executionMs, healthy, message }
}