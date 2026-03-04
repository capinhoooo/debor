import { useReadContracts, useReadContract } from 'wagmi'
import { sepolia } from 'wagmi/chains'
import { consumerAbi } from '@/lib/abi'
import { CONSUMER_ADDRESS } from '@/lib/contracts'

export interface ConsumerData {
  riskScore: number
  borrowRateBps: number
  regime: string
  collateralRatioBps: number
  diversityBps: number
}

export function useConsumerData() {
  const { data, isLoading, error } = useReadContracts({
    contracts: [
      {
        address: CONSUMER_ADDRESS,
        abi: consumerAbi,
        functionName: 'getRiskScore',
        chainId: sepolia.id,
      },
      {
        address: CONSUMER_ADDRESS,
        abi: consumerAbi,
        functionName: 'getCurrentBorrowRate',
        chainId: sepolia.id,
      },
      {
        address: CONSUMER_ADDRESS,
        abi: consumerAbi,
        functionName: 'getAdaptiveCollateralRatio',
        chainId: sepolia.id,
      },
      {
        address: CONSUMER_ADDRESS,
        abi: consumerAbi,
        functionName: 'getSourceDiversityScore',
        chainId: sepolia.id,
      },
    ],
    query: { refetchInterval: 30_000 },
  })

  let consumer: ConsumerData | null = null

  if (data) {
    const risk = data[0]
    const borrow = data[1]
    const collateral = data[2]
    const diversity = data[3]

    const allSuccess =
      risk?.status === 'success' &&
      borrow?.status === 'success' &&
      collateral?.status === 'success' &&
      diversity?.status === 'success'

    if (allSuccess) {
      const [rateBps, regime] = borrow.result as [bigint, string]
      consumer = {
        riskScore: Number(risk.result as bigint),
        borrowRateBps: Number(rateBps),
        regime,
        collateralRatioBps: Number(collateral.result as bigint),
        diversityBps: Number(diversity.result as bigint),
      }
    }
  }

  return { consumer, isLoading, error }
}

export function useStressTest(fixedRate: number, notional: bigint, shockBps: number) {
  const { data, isLoading, refetch } = useReadContract({
    address: CONSUMER_ADDRESS,
    abi: consumerAbi,
    functionName: 'getStressTestPnL',
    args: [BigInt(fixedRate), notional, BigInt(shockBps)],
    chainId: sepolia.id,
    query: { enabled: fixedRate > 0 && notional > 0n },
  })

  const pnlImpact = data !== undefined ? (data as bigint) : null

  return { pnlImpact, isLoading, refetch }
}
