import {
  cre,
  encodeCallMsg,
  getNetwork,
  isChainSelectorSupported,
  bytesToHex,
  LAST_FINALIZED_BLOCK_NUMBER,
  type Runtime,
} from '@chainlink/cre-sdk'
import { encodeFunctionData, decodeFunctionResult, zeroAddress, type Address } from 'viem'
import { AAVE_POOL_ABI, COMPOUND_COMET_ABI, MORPHO_BLUE_ABI, MORPHO_IRM_ABI, CTOKEN_ABI, CHAINLINK_PRICE_FEED_ABI } from './abis'
import type { Config, NormalizedRate, ProtocolRateConfig, PriceContext } from './types'

const PRICE_FEEDS: Record<string, Address> = {
  'ETH/USD': '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
  'BTC/USD': '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c',
  'USDC/USD': '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6',
}

const RAY = 10n ** 27n
const WAD = 10n ** 18n
const SECONDS_PER_YEAR = 31536000n

function rayToBps(rayRate: bigint): bigint {
  return (rayRate * 10000n) / RAY
}

function compoundPerSecToBps(perSecRate: bigint): bigint {
  return (perSecRate * SECONDS_PER_YEAR * 10000n) / WAD
}

function readAaveRates(
  runtime: Runtime<Config>,
  protocolConfig: ProtocolRateConfig,
): NormalizedRate {
  const network = getNetwork({
    chainFamily: 'evm',
    chainSelectorName: protocolConfig.chainSelectorName,
    isTestnet: false,
  })
  if (!network) throw new Error(`Network not found: ${protocolConfig.chainSelectorName}`)

  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)

  const callData = encodeFunctionData({
    abi: AAVE_POOL_ABI,
    functionName: 'getReserveData',
    args: [protocolConfig.assetAddress as Address],
  })

  const result = evmClient
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: protocolConfig.contractAddress as Address,
        data: callData,
      }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result()

  const decoded = decodeFunctionResult({
    abi: AAVE_POOL_ABI,
    functionName: 'getReserveData',
    data: bytesToHex(result.data),
  })

  return {
    protocol: protocolConfig.protocol,
    chain: protocolConfig.chain,
    asset: protocolConfig.asset,
    supplyBps: rayToBps(BigInt(decoded.currentLiquidityRate)),
    borrowBps: rayToBps(BigInt(decoded.currentVariableBorrowRate)),
  }
}

function readCompoundRates(
  runtime: Runtime<Config>,
  protocolConfig: ProtocolRateConfig,
): NormalizedRate {
  const network = getNetwork({
    chainFamily: 'evm',
    chainSelectorName: protocolConfig.chainSelectorName,
    isTestnet: false,
  })
  if (!network) throw new Error(`Network not found: ${protocolConfig.chainSelectorName}`)

  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)

  const utilCallData = encodeFunctionData({
    abi: COMPOUND_COMET_ABI,
    functionName: 'getUtilization',
  })

  const utilResult = evmClient
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: protocolConfig.contractAddress as Address,
        data: utilCallData,
      }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result()

  const utilization = decodeFunctionResult({
    abi: COMPOUND_COMET_ABI,
    functionName: 'getUtilization',
    data: bytesToHex(utilResult.data),
  })

  const supplyCallData = encodeFunctionData({
    abi: COMPOUND_COMET_ABI,
    functionName: 'getSupplyRate',
    args: [utilization],
  })

  const supplyResult = evmClient
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: protocolConfig.contractAddress as Address,
        data: supplyCallData,
      }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result()

  const supplyRate = decodeFunctionResult({
    abi: COMPOUND_COMET_ABI,
    functionName: 'getSupplyRate',
    data: bytesToHex(supplyResult.data),
  })

  const borrowCallData = encodeFunctionData({
    abi: COMPOUND_COMET_ABI,
    functionName: 'getBorrowRate',
    args: [utilization],
  })

  const borrowResult = evmClient
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: protocolConfig.contractAddress as Address,
        data: borrowCallData,
      }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result()

  const borrowRate = decodeFunctionResult({
    abi: COMPOUND_COMET_ABI,
    functionName: 'getBorrowRate',
    data: bytesToHex(borrowResult.data),
  })

  return {
    protocol: protocolConfig.protocol,
    chain: protocolConfig.chain,
    asset: protocolConfig.asset,
    supplyBps: compoundPerSecToBps(BigInt(supplyRate)),
    borrowBps: compoundPerSecToBps(BigInt(borrowRate)),
  }
}

function readMorphoRates(
  runtime: Runtime<Config>,
  protocolConfig: ProtocolRateConfig,
): NormalizedRate {
  const network = getNetwork({
    chainFamily: 'evm',
    chainSelectorName: protocolConfig.chainSelectorName,
    isTestnet: false,
  })
  if (!network) throw new Error(`Network not found: ${protocolConfig.chainSelectorName}`)

  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)
  const morphoCore = protocolConfig.contractAddress as Address
  const marketId = protocolConfig.assetAddress as `0x${string}`

  const paramsCallData = encodeFunctionData({
    abi: MORPHO_BLUE_ABI,
    functionName: 'idToMarketParams',
    args: [marketId],
  })

  const paramsResult = evmClient
    .callContract(runtime, {
      call: encodeCallMsg({ from: zeroAddress, to: morphoCore, data: paramsCallData }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result()

  const params = decodeFunctionResult({
    abi: MORPHO_BLUE_ABI,
    functionName: 'idToMarketParams',
    data: bytesToHex(paramsResult.data),
  })

  const marketCallData = encodeFunctionData({
    abi: MORPHO_BLUE_ABI,
    functionName: 'market',
    args: [marketId],
  })

  const marketResult = evmClient
    .callContract(runtime, {
      call: encodeCallMsg({ from: zeroAddress, to: morphoCore, data: marketCallData }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result()

  const marketState = decodeFunctionResult({
    abi: MORPHO_BLUE_ABI,
    functionName: 'market',
    data: bytesToHex(marketResult.data),
  })

  const irmAddress = params[3] as Address
  const borrowRateCallData = encodeFunctionData({
    abi: MORPHO_IRM_ABI,
    functionName: 'borrowRateView',
    args: [
      {
        loanToken: params[0] as Address,
        collateralToken: params[1] as Address,
        oracle: params[2] as Address,
        irm: params[3] as Address,
        lltv: BigInt(params[4]),
      },
      {
        totalSupplyAssets: BigInt(marketState[0]),
        totalSupplyShares: BigInt(marketState[1]),
        totalBorrowAssets: BigInt(marketState[2]),
        totalBorrowShares: BigInt(marketState[3]),
        lastUpdate: BigInt(marketState[4]),
        fee: BigInt(marketState[5]),
      },
    ],
  })

  const borrowRateResult = evmClient
    .callContract(runtime, {
      call: encodeCallMsg({ from: zeroAddress, to: irmAddress, data: borrowRateCallData }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result()

  const borrowRatePerSec = decodeFunctionResult({
    abi: MORPHO_IRM_ABI,
    functionName: 'borrowRateView',
    data: bytesToHex(borrowRateResult.data),
  })

  const borrowBps = compoundPerSecToBps(BigInt(borrowRatePerSec))

  const totalSupply = BigInt(marketState[0])
  const totalBorrow = BigInt(marketState[2])
  const fee = BigInt(marketState[5])

  let supplyBps = 0n
  if (totalSupply > 0n) {
    const utilization = (totalBorrow * WAD) / totalSupply
    const feeAdjust = WAD - fee 
    const supplyPerSec = (BigInt(borrowRatePerSec) * utilization * feeAdjust) / (WAD * WAD)
    supplyBps = compoundPerSecToBps(supplyPerSec)
  }

  return {
    protocol: protocolConfig.protocol,
    chain: protocolConfig.chain,
    asset: protocolConfig.asset,
    supplyBps,
    borrowBps,
  }
}

function readCTokenRates(
  runtime: Runtime<Config>,
  protocolConfig: ProtocolRateConfig,
): NormalizedRate {
  const network = getNetwork({
    chainFamily: 'evm',
    chainSelectorName: protocolConfig.chainSelectorName,
    isTestnet: false,
  })
  if (!network) throw new Error(`Network not found: ${protocolConfig.chainSelectorName}`)

  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)

  const supplyResult = evmClient
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: protocolConfig.contractAddress as Address,
        data: encodeFunctionData({ abi: CTOKEN_ABI, functionName: 'supplyRatePerTimestamp' }),
      }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result()

  const supplyPerSec = decodeFunctionResult({
    abi: CTOKEN_ABI,
    functionName: 'supplyRatePerTimestamp',
    data: bytesToHex(supplyResult.data),
  })

  const borrowResult = evmClient
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: protocolConfig.contractAddress as Address,
        data: encodeFunctionData({ abi: CTOKEN_ABI, functionName: 'borrowRatePerTimestamp' }),
      }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result()

  const borrowPerSec = decodeFunctionResult({
    abi: CTOKEN_ABI,
    functionName: 'borrowRatePerTimestamp',
    data: bytesToHex(borrowResult.data),
  })

  return {
    protocol: protocolConfig.protocol,
    chain: protocolConfig.chain,
    asset: protocolConfig.asset,
    supplyBps: compoundPerSecToBps(BigInt(supplyPerSec)),
    borrowBps: compoundPerSecToBps(BigInt(borrowPerSec)),
  }
}

export function readAllRates(
  runtime: Runtime<Config>,
  protocols: ProtocolRateConfig[],
): NormalizedRate[] {
  const rates: NormalizedRate[] = []

  for (const p of protocols) {
    if (!isChainSelectorSupported(p.chainSelectorName)) {
      runtime.log(`  SKIP: ${p.protocol}/${p.chain} — chain ${p.chainSelectorName} not supported by CRE SDK`)
      continue
    }

    runtime.log(`  Reading ${p.protocol} on ${p.chain} [${p.asset}]...`)

    try {
      if (p.rateType === 'aave' || p.rateType === 'spark') {
        const rate = readAaveRates(runtime, p)
        rates.push(rate)
        runtime.log(`    supply=${rate.supplyBps}bps, borrow=${rate.borrowBps}bps`)
      } else if (p.rateType === 'compound') {
        const rate = readCompoundRates(runtime, p)
        rates.push(rate)
        runtime.log(`    supply=${rate.supplyBps}bps, borrow=${rate.borrowBps}bps`)
      } else if (p.rateType === 'morpho') {
        const rate = readMorphoRates(runtime, p)
        rates.push(rate)
        runtime.log(`    supply=${rate.supplyBps}bps, borrow=${rate.borrowBps}bps`)
      } else if (p.rateType === 'ctoken') {
        const rate = readCTokenRates(runtime, p)
        rates.push(rate)
        runtime.log(`    supply=${rate.supplyBps}bps, borrow=${rate.borrowBps}bps`)
      }
    } catch (e) {
      runtime.log(`    DROPPED ${p.protocol}/${p.chain}: ${e}`)
    }
  }

  const dropped = protocols.length - rates.length
  if (dropped > 0) {
    runtime.log(`  Collected ${rates.length}/${protocols.length} sources (${dropped} dropped — likely hit 15-call EVM limit)`)
  } else {
    runtime.log(`  Collected ${rates.length}/${protocols.length} sources (all succeeded)`)
  }
  return rates
}

function readChainlinkPrice(
  runtime: Runtime<Config>,
  feedName: string,
): bigint {
  const feedAddress = PRICE_FEEDS[feedName]
  if (!feedAddress) return 0n

  const network = getNetwork({
    chainFamily: 'evm',
    chainSelectorName: 'ethereum-mainnet',
    isTestnet: false,
  })
  if (!network) return 0n

  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)

  const callData = encodeFunctionData({
    abi: CHAINLINK_PRICE_FEED_ABI,
    functionName: 'latestRoundData',
  })

  try {
    const result = evmClient
      .callContract(runtime, {
        call: encodeCallMsg({ from: zeroAddress, to: feedAddress, data: callData }),
        blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
      })
      .result()

    const decoded = decodeFunctionResult({
      abi: CHAINLINK_PRICE_FEED_ABI,
      functionName: 'latestRoundData',
      data: bytesToHex(result.data),
    })

    return BigInt(decoded[1])
  } catch (e) {
    runtime.log(`    Warning: ${feedName} price feed failed: ${e}`)
    return 0n
  }
}

export function readAllPrices(runtime: Runtime<Config>): PriceContext {
  runtime.log('  Reading Chainlink price feeds...')

  const ethUsd = readChainlinkPrice(runtime, 'ETH/USD')
  runtime.log(`    ETH/USD: $${Number(ethUsd) / 1e8}`)

  const btcUsd = readChainlinkPrice(runtime, 'BTC/USD')
  runtime.log(`    BTC/USD: $${Number(btcUsd) / 1e8}`)

  const usdcUsd = readChainlinkPrice(runtime, 'USDC/USD')
  runtime.log(`    USDC/USD: $${Number(usdcUsd) / 1e8}`)

  return {
    ethUsd,
    btcUsd,
    usdcUsd,
    timestamp: BigInt(Math.floor(Date.now() / 1000)),
  }
}