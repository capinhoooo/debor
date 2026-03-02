import {
  cre,
  ConsensusAggregationByFields,
  median,
  identical,
  ignore,
  text,
  ok,
  type Runtime,
  type HTTPSendRequester,
} from '@chainlink/cre-sdk'
import type { Config, TVLWeight, ProtocolRateConfig } from './types'

const PROTOCOL_SLUGS = new Map<string, string>([
  ['aave_v3', 'aave-v3'],
  ['compound_v3', 'compound-v3'],
  ['spark', 'spark'],
  ['morpho_blue', 'morpho'],
  ['moonwell', 'moonwell'],
  ['benqi', 'benqi-lending'],
])

interface TVLResponse {
  slug: string
  tvl: number
  fetchedAt: number
}

function fetchSingleTVL(
  sendRequester: HTTPSendRequester,
  tvlApiBase: string,
  slug: string,
): TVLResponse {
  const url = `${tvlApiBase}/tvl/${slug}`
  const response = sendRequester.sendRequest({ url, method: 'GET' }).result()

  if (!ok(response)) {
    return { slug, tvl: 0, fetchedAt: Date.now() }
  }

  const bodyStr = text(response)
  const tvlValue = Number(bodyStr)

  if (isNaN(tvlValue) || tvlValue <= 0) {
    return { slug, tvl: 0, fetchedAt: Date.now() }
  }

  return { slug, tvl: tvlValue, fetchedAt: Date.now() }
}

export function fetchAllTVLs(
  runtime: Runtime<Config>,
  protocols: ProtocolRateConfig[],
): TVLWeight[] {
  const httpClient = new cre.capabilities.HTTPClient()
  const weights: TVLWeight[] = []
  const seen = new Set<string>()

  for (const p of protocols) {
    const protocolBase = p.protocol
    if (seen.has(protocolBase)) continue
    seen.add(protocolBase)

    const slug = PROTOCOL_SLUGS.get(protocolBase)
    if (!slug) continue

    runtime.log(`  Fetching TVL for ${protocolBase} (${slug})...`)

    try {
      const tvlResult = httpClient
        .sendRequest(
          runtime,
          fetchSingleTVL,
          ConsensusAggregationByFields<TVLResponse>({
            slug: () => identical<string>(),
            tvl: () => median<number>(),
            fetchedAt: () => ignore<number>(),
          }).withDefault({ slug, tvl: 0, fetchedAt: 0 }),
        )
        (runtime.config.tvlApiBase, slug)
        .result()

      weights.push({
        protocol: protocolBase,
        tvlUsd: BigInt(Math.floor(tvlResult.tvl)),
      })

      if (tvlResult.tvl <= 0) {
        runtime.log(`    ${protocolBase}: TVL unavailable — excluded from weighted average`)
      } else {
        runtime.log(`    ${protocolBase}: TVL=$${Math.floor(tvlResult.tvl).toLocaleString()}`)
      }
    } catch (e) {
      runtime.log(`    FAILED to fetch TVL for ${protocolBase}: ${e} — excluded from weighted average`)
      weights.push({
        protocol: protocolBase,
        tvlUsd: 0n,
      })
    }
  }

  runtime.log(`  Fetched TVL for ${weights.length} protocols`)
  return weights
}