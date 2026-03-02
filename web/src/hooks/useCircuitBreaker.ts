import { useReadContracts } from 'wagmi'
import { sepolia } from 'wagmi/chains'
import { oracleAbi } from '@/lib/abi'
import { ORACLE_ADDRESSES, ASSETS, type AssetKey } from '@/lib/contracts'

const RISK_LABELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const

export interface CircuitBreakerStatus {
  asset: AssetKey
  active: boolean
  lastTrip: bigint
  riskLevel: number
  riskLabel: string
}

export function useCircuitBreaker() {
  const contracts = ASSETS.flatMap((asset) => [
    {
      address: ORACLE_ADDRESSES[asset],
      abi: oracleAbi,
      functionName: 'circuitBreakerActive' as const,
      chainId: sepolia.id,
    },
    {
      address: ORACLE_ADDRESSES[asset],
      abi: oracleAbi,
      functionName: 'lastCircuitBreakerTrip' as const,
      chainId: sepolia.id,
    },
    {
      address: ORACLE_ADDRESSES[asset],
      abi: oracleAbi,
      functionName: 'riskLevel' as const,
      chainId: sepolia.id,
    },
  ])

  const { data, isLoading } = useReadContracts({
    contracts,
    query: { refetchInterval: 15_000 },
  })

  const statuses: CircuitBreakerStatus[] = ASSETS.map((asset, i) => {
    const base = i * 3
    const active = data?.[base]?.status === 'success' ? (data[base].result as boolean) : false
    const lastTrip = data?.[base + 1]?.status === 'success' ? (data[base + 1].result as bigint) : 0n
    const level = data?.[base + 2]?.status === 'success' ? Number(data[base + 2].result) : 0

    return {
      asset,
      active,
      lastTrip,
      riskLevel: level,
      riskLabel: RISK_LABELS[level] ?? 'LOW',
    }
  })

  const anyActive = statuses.some((s) => s.active)

  return { statuses, anyActive, isLoading }
}
