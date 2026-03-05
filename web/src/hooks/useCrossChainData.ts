import { useReadContracts } from 'wagmi'
import { ccipReceiverAbi, oracleAbi } from '@/lib/abi'
import { CCIP_RECEIVERS, ORACLE_ADDRESSES } from '@/lib/contracts'
import { sepolia, baseSepolia, arbitrumSepolia, optimismSepolia } from 'wagmi/chains'

const chainIdMap: Record<string, number> = {
  'Base Sepolia': baseSepolia.id,
  'Arb Sepolia': arbitrumSepolia.id,
  'OP Sepolia': optimismSepolia.id,
}

export interface CrossChainRate {
  chain: string
  rate: bigint
  supply: bigint
  spread: bigint
  vol: bigint
  term7d: bigint
  updated: bigint
  sources: bigint
  configured: bigint
  riskLevel: number | null
  cbActive: boolean | null
  riskScore: number | null
}

export function useCrossChainRates() {
  const chains = Object.keys(CCIP_RECEIVERS) as (keyof typeof CCIP_RECEIVERS)[]

  const contracts = [
    // Sepolia origin (USDC oracle as reference)
    {
      address: ORACLE_ADDRESSES.USDC,
      abi: oracleAbi,
      functionName: 'getFullBenchmark' as const,
      chainId: sepolia.id,
    },
    // L2 receivers
    ...chains.map((chain) => ({
      address: CCIP_RECEIVERS[chain].address,
      abi: ccipReceiverAbi,
      functionName: 'getFullBenchmark' as const,
      chainId: chainIdMap[chain],
    })),
    // L2 risk metadata
    ...chains.map((chain) => ({
      address: CCIP_RECEIVERS[chain].address,
      abi: ccipReceiverAbi,
      functionName: 'getRiskMetadata' as const,
      chainId: chainIdMap[chain],
    })),
  ]

  const { data, isLoading, error } = useReadContracts({
    contracts,
    query: { refetchInterval: 30_000 },
  })

  const results: CrossChainRate[] = []

  // Origin (Sepolia)
  const originResult = data?.[0]
  if (originResult?.status === 'success' && originResult.result) {
    const r = originResult.result as [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint]
    results.push({
      chain: 'Sepolia (Origin)',
      rate: r[0], supply: r[1], spread: r[2], vol: r[3],
      term7d: r[4], updated: r[5], sources: r[6], configured: r[7],
      riskLevel: null, cbActive: null, riskScore: null,
    })
  }

  // L2s
  chains.forEach((chain, i) => {
    const result = data?.[i + 1]
    if (result?.status === 'success' && result.result) {
      const r = result.result as [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint]
      const riskIdx = 1 + chains.length + i
      const riskResult = data?.[riskIdx]
      let riskLevel: number | null = null
      let cbActive: boolean | null = null
      let riskScore: number | null = null
      if (riskResult?.status === 'success' && riskResult.result) {
        const rm = riskResult.result as [number, boolean, bigint]
        riskLevel = rm[0]
        cbActive = rm[1]
        riskScore = Number(rm[2])
      }
      results.push({
        chain,
        rate: r[0], supply: r[1], spread: r[2], vol: r[3],
        term7d: r[4], updated: r[5], sources: r[6], configured: r[7],
        riskLevel, cbActive, riskScore,
      })
    }
  })

  return { rates: results, isLoading, error }
}
