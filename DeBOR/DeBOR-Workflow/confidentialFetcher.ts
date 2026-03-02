import {
  cre,
  text,
  ok,
  type Runtime,
} from '@chainlink/cre-sdk'
import type { Config, TVLWeight } from './types'

const PROTOCOL_SLUGS = new Map<string, string>([
  ['aave_v3', 'aave-v3'],
  ['compound_v3', 'compound-v3'],
  ['spark', 'spark'],
  ['morpho_blue', 'morpho'],
])

/**
 * Fetch TVL data using ConfidentialHTTPClient (TEE-based).
 * Secrets (e.g., PREMIUM_API_KEY) are injected via VaultDON
 * and never exposed to node operators.
 *
 * This demonstrates CRE's confidential compute capability:
 * - Request is sent from within a Trusted Execution Environment
 * - API keys are stored in VaultDON, injected at runtime
 * - Node operators cannot observe request headers or secrets
 */
export function fetchConfidentialTVL(
  runtime: Runtime<Config>,
  protocolSlug: string,
): TVLWeight | null {
  const confidentialClient = new cre.capabilities.ConfidentialHTTPClient()

  const apiBase = runtime.config.tvlApiBase
  const url = `${apiBase}/tvl/${protocolSlug}`

  runtime.log(`  [Confidential] Fetching TVL: ${protocolSlug}...`)

  try {
    const response = confidentialClient
      .sendRequest(runtime, {
        vaultDonSecrets: [
          { key: 'PREMIUM_API_KEY', namespace: 'workflow' },
        ],
        request: {
          url,
          method: 'GET',
          multiHeaders: {
            'X-Api-Key': { values: ['{{PREMIUM_API_KEY}}'] },
          },
        },
      })
      .result()

    if (!ok(response)) {
      runtime.log(`    [Confidential] ${protocolSlug} returned status ${response.statusCode}`)
      return null
    }

    const bodyStr = text(response)
    const tvlValue = Number(bodyStr.trim())

    if (isNaN(tvlValue) || tvlValue <= 0) {
      runtime.log(`    [Confidential] Invalid TVL value for ${protocolSlug}`)
      return null
    }

    runtime.log(`    [Confidential] ${protocolSlug}: $${Math.floor(tvlValue).toLocaleString()}`)

    return {
      protocol: protocolSlug,
      tvlUsd: BigInt(Math.floor(tvlValue)),
    }
  } catch (e) {
    runtime.log(`    [Confidential] Failed for ${protocolSlug}: ${e}`)
    return null
  }
}

/**
 * Fetch all protocol TVLs using ConfidentialHTTPClient.
 * Falls back to null for any failures (caller should use regular HTTP as fallback).
 */
export function fetchAllConfidentialTVLs(
  runtime: Runtime<Config>,
  protocols: { protocol: string }[],
): TVLWeight[] {
  const weights: TVLWeight[] = []
  const seen = new Set<string>()

  for (const p of protocols) {
    if (seen.has(p.protocol)) continue
    seen.add(p.protocol)

    const slug = PROTOCOL_SLUGS.get(p.protocol)
    if (!slug) continue

    const result = fetchConfidentialTVL(runtime, slug)
    if (result) {
      weights.push({ protocol: p.protocol, tvlUsd: result.tvlUsd })
    }
  }

  return weights
}