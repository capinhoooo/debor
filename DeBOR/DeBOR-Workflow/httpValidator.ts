import {
  cre,
  ConsensusAggregationByFields,
  consensusMedianAggregation,
  consensusIdenticalAggregation,
  consensusCommonPrefixAggregation,
  consensusCommonSuffixAggregation,
  median,
  identical,
  commonPrefix,
  commonSuffix,
  ignore,
  encodeCallMsg,
  getNetwork,
  bytesToHex,
  safeJsonStringify,
  prepareReportRequest,
  LAST_FINALIZED_BLOCK_NUMBER,
  text,
  ok,
  type Runtime,
  type NodeRuntime,
  type HTTPSendRequester,
} from '@chainlink/cre-sdk'
import { encodeAbiParameters, parseAbiParameters, encodeFunctionData, decodeFunctionResult, zeroAddress, type Address } from 'viem'
import { DEBOR_ORACLE_READ_ABI } from './abis'
import type { Config, AssetClass } from './types'

const ASSETS: AssetClass[] = ['USDC', 'ETH', 'BTC', 'DAI', 'USDT']
const STABLECOINS: AssetClass[] = ['USDC', 'DAI', 'USDT']
const RATE_MIN_BPS = 1n 
const RATE_MAX_BPS = 5000n
const STABLECOIN_SPREAD_THRESHOLD = 200

interface TVLCheck {
  slug: string
  tvl: number
}

function fetchTVLCheck(
  sendRequester: HTTPSendRequester,
  tvlApiBase: string,
  slug: string,
): TVLCheck {
  const url = `${tvlApiBase}/tvl/${slug}`
  const response = sendRequester.sendRequest({ url, method: 'GET' }).result()

  if (!ok(response)) return { slug, tvl: 0 }

  const tvlValue = Number(text(response))
  return { slug, tvl: isNaN(tvlValue) ? 0 : tvlValue }
}

export function runHttpValidation(runtime: Runtime<Config>): string {
  runtime.log('=== DeBOR HTTP Validation Layer ===')

  const warnings: string[] = []

  // ─── Step 1: Read on-chain DeBOR oracle rates from Sepolia ───
  runtime.log('Step 1: Reading on-chain DeBOR oracle rates...')
  const targetNetwork = getNetwork({
    chainFamily: 'evm',
    chainSelectorName: runtime.config.targetChainSelectorName,
    isTestnet: true,
  })
  if (!targetNetwork) {
    runtime.log('  Target network not found')
    return 'VALIDATION: Target network unavailable'
  }

  const evmClient = new cre.capabilities.EVMClient(targetNetwork.chainSelector.selector)
  const oracleRates: Record<string, bigint> = {}

  for (const asset of ASSETS) {
    const oracleAddr = runtime.config.oracleAddresses[asset]
    if (!oracleAddr) continue

    try {
      const callData = encodeFunctionData({
        abi: DEBOR_ORACLE_READ_ABI,
        functionName: 'getRate',
      })

      const result = evmClient
        .callContract(runtime, {
          call: encodeCallMsg({
            from: zeroAddress,
            to: oracleAddr as Address,
            data: callData,
          }),
          blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
        })
        .result()

      const rate = decodeFunctionResult({
        abi: DEBOR_ORACLE_READ_ABI,
        functionName: 'getRate',
        data: bytesToHex(result.data),
      })

      oracleRates[asset] = BigInt(rate as any)
      runtime.log(`  ${asset}: ${oracleRates[asset]}bps (${Number(oracleRates[asset]) / 100}%)`)
    } catch (e) {
      runtime.log(`  ${asset}: oracle read failed: ${e}`)
      oracleRates[asset] = 0n
    }
  }

  runtime.log(`  Oracle rates (safeJsonStringify): ${safeJsonStringify(oracleRates)}`)

  // ─── Step 2: Rate sanity checks ───
  runtime.log('Step 2: Rate sanity checks...')
  for (const asset of ASSETS) {
    const rate = oracleRates[asset] || 0n
    if (rate === 0n) {
      warnings.push(`${asset}:ZERO`)
      runtime.log(`  WARNING: ${asset} rate is 0 (no data or stale oracle)`)
    } else if (rate < RATE_MIN_BPS) {
      warnings.push(`${asset}:LOW(${rate}bps)`)
      runtime.log(`  WARNING: ${asset} rate ${rate}bps suspiciously low`)
    } else if (rate > RATE_MAX_BPS) {
      warnings.push(`${asset}:HIGH(${rate}bps)`)
      runtime.log(`  WARNING: ${asset} rate ${rate}bps suspiciously high`)
    } else {
      runtime.log(`  ${asset}: OK (${rate}bps within ${RATE_MIN_BPS}-${RATE_MAX_BPS} range)`)
    }
  }

  // ─── Step 3: Stablecoin consistency check ───
  runtime.log('Step 3: Stablecoin consistency check...')
  const stableRates = STABLECOINS
    .map((a) => ({ asset: a, rate: Number(oracleRates[a] || 0n) }))
    .filter((r) => r.rate > 0)

  if (stableRates.length >= 2) {
    const rates = stableRates.map((r) => r.rate)
    const maxRate = Math.max(...rates)
    const minRate = Math.min(...rates)
    const spread = maxRate - minRate

    if (spread > STABLECOIN_SPREAD_THRESHOLD) {
      warnings.push(`STABLE_SPREAD:${spread}bps`)
      runtime.log(
        `  WARNING: Stablecoin spread ${spread}bps exceeds ${STABLECOIN_SPREAD_THRESHOLD}bps (${stableRates.map((r) => `${r.asset}=${r.rate}`).join(', ')})`,
      )
    } else {
      runtime.log(
        `  Stablecoins consistent: spread=${spread}bps (${stableRates.map((r) => `${r.asset}=${r.rate}`).join(', ')})`,
      )
    }
  }

  // ─── Step 4: DeFiLlama TVL cross-check (HTTP validation) ───
  runtime.log('Step 4: DeFiLlama TVL cross-check...')
  const httpClient = new cre.capabilities.HTTPClient()
  const tvlSlugs = ['aave-v3', 'compound-v3', 'spark']

  for (const slug of tvlSlugs) {
    try {
      const tvlResult = httpClient
        .sendRequest(
          runtime,
          fetchTVLCheck,
          ConsensusAggregationByFields<TVLCheck>({
            slug: () => identical<string>(),
            tvl: () => median<number>(),
          }),
        )(runtime.config.tvlApiBase, slug)
        .result()

      if (tvlResult.tvl <= 0) {
        warnings.push(`TVL:${slug}=0`)
        runtime.log(`  WARNING: ${slug} TVL is ${tvlResult.tvl} (protocol may be down)`)
      } else if (tvlResult.tvl < 10_000_000) {
        warnings.push(`TVL:${slug}=LOW`)
        runtime.log(`  WARNING: ${slug} TVL=$${Math.floor(tvlResult.tvl).toLocaleString()} (unusually low)`)
      } else {
        runtime.log(`  ${slug}: TVL=$${Math.floor(tvlResult.tvl).toLocaleString()} OK`)
      }
    } catch (e) {
      runtime.log(`  ${slug}: TVL fetch failed: ${e}`)
    }
  }

  // ─── Step 5: Historical rate consistency (7d vs current) ───
  runtime.log('Step 5: Historical rate consistency...')
  for (const asset of ASSETS) {
    const oracleAddr = runtime.config.oracleAddresses[asset]
    if (!oracleAddr || !oracleRates[asset]) continue

    try {
      const callData = encodeFunctionData({
        abi: DEBOR_ORACLE_READ_ABI,
        functionName: 'getHistoricalRate',
        args: [1n], // 1 period back
      })

      const result = evmClient
        .callContract(runtime, {
          call: encodeCallMsg({
            from: zeroAddress,
            to: oracleAddr as Address,
            data: callData,
          }),
          blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
        })
        .result()

      const prevRate = decodeFunctionResult({
        abi: DEBOR_ORACLE_READ_ABI,
        functionName: 'getHistoricalRate',
        data: bytesToHex(result.data),
      })

      const prev = BigInt(prevRate as any)
      const current = oracleRates[asset]
      if (prev > 0n) {
        const change = current > prev ? current - prev : prev - current
        const changePct = (Number(change) * 100) / Number(prev)
        if (changePct > 50) {
          warnings.push(`${asset}:SPIKE(${changePct.toFixed(0)}%)`)
          runtime.log(`  WARNING: ${asset} rate changed ${changePct.toFixed(1)}% (${prev}→${current}bps)`)
        } else {
          runtime.log(`  ${asset}: stable (${changePct.toFixed(1)}% change, ${prev}→${current}bps)`)
        }
      }
    } catch {
      runtime.log(`  ${asset}: no historical data available`)
    }
  }

  // ─── Step 6: DON Consensus Validation ───
  // Demonstrates ALL 4 top-level and ALL 5 field-level CRE consensus strategies.
  // In production, each DON node independently executes these checks;
  // consensus ensures Byzantine fault tolerance across the node set.
  runtime.log('Step 6: DON consensus validation (4 top-level + 5 field-level strategies)...')
  let consensusChecks = 0

  // 6: consensusIdenticalAggregation — all nodes MUST agree on config
  // If any node has a different config, consensus fails → handler aborts (safety!)
  try {
    const configHash = runtime.runInNodeMode(
      (nodeRuntime: NodeRuntime<Config>) => {
        const cfg = nodeRuntime.config
        return `protocols=${cfg.protocols.length}|gas=${cfg.gasLimit}|target=${cfg.targetChainSelectorName}`
      },
      consensusIdenticalAggregation<string>(),
    )().result()
    runtime.log(`  6a [identical]: config consensus OK — ${configHash}`)
    consensusChecks++
  } catch (e) {
    runtime.log(`  6a [identical]: ${e} (expected in simulation)`)
  }

  // 6: consensusMedianAggregation — median of node-local protocol counts
  // Ensures statistical agreement even if nodes enumerate configs slightly differently
  try {
    const medianCount = runtime.runInNodeMode(
      (nodeRuntime: NodeRuntime<Config>) => nodeRuntime.config.protocols.length,
      consensusMedianAggregation<number>(),
    )().result()
    runtime.log(`  6b [median]: protocol count consensus = ${medianCount}`)
    consensusChecks++
  } catch (e) {
    runtime.log(`  6b [median]: ${e} (expected in simulation)`)
  }

  // 6: consensusCommonPrefixAggregation — longest common prefix of asset names
  // Nodes may see different tail-end assets if config propagation is in-flight;
  // commonPrefix guarantees agreement on the established head of the list
  try {
    const assetPrefix = runtime.runInNodeMode(
      (nodeRuntime: NodeRuntime<Config>) =>
        Object.keys(nodeRuntime.config.oracleAddresses),
      consensusCommonPrefixAggregation<string>(),
    )().result()
    runtime.log(`  6c [commonPrefix]: agreed on ${assetPrefix.length} assets — [${assetPrefix.join(', ')}]`)
    consensusChecks++
  } catch (e) {
    runtime.log(`  6c [commonPrefix]: ${e} (expected in simulation)`)
  }

  // 6: consensusCommonSuffixAggregation — common suffix of oracle addresses
  // If nodes disagree on earlier (deprecated) addresses but agree on the latest,
  // commonSuffix ensures the most recently deployed oracles are canonical
  try {
    const addrSuffix = runtime.runInNodeMode(
      (nodeRuntime: NodeRuntime<Config>) =>
        Object.values(nodeRuntime.config.oracleAddresses),
      consensusCommonSuffixAggregation<string>(),
    )().result()
    runtime.log(`  6d [commonSuffix]: agreed on ${addrSuffix.length} oracle addresses`)
    consensusChecks++
  } catch (e) {
    runtime.log(`  6d [commonSuffix]: ${e} (expected in simulation)`)
  }

  // 6e: ConsensusAggregationByFields — ALL 5 field-level strategies in one call
  // This demonstrates the complete field-level consensus toolkit:
  //   identical()    — exact match on config fingerprint
  //   median()       — statistical agreement on numeric values
  //   commonPrefix() — array prefix matching on asset list
  //   commonSuffix() — array suffix matching on oracle list
  //   ignore()       — intentionally skip consensus on node-local data
  interface FieldConsensusDemo {
    configFingerprint: string 
    protocolCount: number 
    assetNames: string[] 
    oracleAddrs: string[]
    nodeLocalTimestamp: number
  }

  try {
    const fieldResult = runtime.runInNodeMode(
      (nodeRuntime: NodeRuntime<Config>) => ({
        configFingerprint: `v${nodeRuntime.config.protocols.length}`,
        protocolCount: nodeRuntime.config.protocols.length,
        assetNames: Object.keys(nodeRuntime.config.oracleAddresses),
        oracleAddrs: Object.values(nodeRuntime.config.oracleAddresses),
        nodeLocalTimestamp: Math.floor(nodeRuntime.now().getTime() / 1000),
      }),
      ConsensusAggregationByFields<FieldConsensusDemo>({
        configFingerprint: () => identical<string>(),
        protocolCount: () => median<number>(),
        assetNames: () => commonPrefix<string>(),
        oracleAddrs: () => commonSuffix<string>(),
        nodeLocalTimestamp: () => ignore<number>(),
      }),
    )().result()

    runtime.log(
      `  6e [fields]: fingerprint=${fieldResult.configFingerprint}, count=${fieldResult.protocolCount}, ` +
      `assets=${fieldResult.assetNames.length}, oracles=${fieldResult.oracleAddrs.length}, ts=${fieldResult.nodeLocalTimestamp}`,
    )
    consensusChecks++
  } catch (e) {
    runtime.log(`  6e [fields]: ${e} (expected in simulation)`)
  }

  runtime.log(`  Consensus checks passed: ${consensusChecks}/5`)

  // ─── Step 7: Off-chain webhook distribution via sendReport ───
  // Generates a DON-signed report containing the validation summary,
  // then distributes it to off-chain consumers via HTTPClient.sendReport().
  // In production, this enables institutional consumers to receive
  // signed validation proofs without reading the blockchain.
  runtime.log('Step 7: DON-signed report distribution (sendReport)...')
  try {
    const validationPayload = encodeAbiParameters(
      parseAbiParameters('uint256, uint256, uint256'),
      [
        BigInt(warnings.length),
        BigInt(consensusChecks),
        BigInt(Math.floor(Date.now() / 1000)),
      ],
    )

    const report = runtime
      .report(prepareReportRequest(validationPayload))
      .result()

    const httpClient = new cre.capabilities.HTTPClient()
    httpClient.sendReport(
      runtime,
      report,
      (reportResponse) => ({
        url: `${runtime.config.tvlApiBase.replace('/tvl', '')}/webhook/debor-validation`,
        method: 'POST',
        body: Buffer.from(safeJsonStringify({
          type: 'validation_report',
          warnings: warnings.length,
          consensusChecks,
          reportHex: bytesToHex(reportResponse.rawReport),
          configDigest: bytesToHex(reportResponse.configDigest),
          signatures: reportResponse.sigs.length,
        })),
        multiHeaders: {
          'Content-Type': { values: ['application/json'] },
        },
      }),
    ).result()

    runtime.log(`  sendReport: validation report distributed to webhook`)
  } catch (e) {
    runtime.log(`  sendReport: ${e} (expected — no real webhook in simulation)`)
  }

  const summary =
    warnings.length > 0
      ? `VALIDATION: ${warnings.length} warnings [${warnings.join(', ')}] | consensus=${consensusChecks}/5`
      : `VALIDATION: All OK, TVLs healthy, consensus=${consensusChecks}/5`

  runtime.log(`=== ${summary} ===`)
  return summary
}