import { useReadContracts, useReadContract, useAccount } from 'wagmi'
import { sepolia } from 'wagmi/chains'
import { paymentGateAbi } from '@/lib/abi'
import { PAYMENT_GATE_ADDRESS } from '@/lib/contracts'

export interface PaymentGateData {
  pricePerCredit: bigint
  totalCreditsIssued: number
  totalCreditsConsumed: number
  totalRevenue: bigint
}

export function usePaymentGateData() {
  const { address } = useAccount()

  const { data, isLoading: gateLoading, error } = useReadContracts({
    contracts: [
      {
        address: PAYMENT_GATE_ADDRESS,
        abi: paymentGateAbi,
        functionName: 'pricePerCredit',
        chainId: sepolia.id,
      },
      {
        address: PAYMENT_GATE_ADDRESS,
        abi: paymentGateAbi,
        functionName: 'totalCreditsIssued',
        chainId: sepolia.id,
      },
      {
        address: PAYMENT_GATE_ADDRESS,
        abi: paymentGateAbi,
        functionName: 'totalCreditsConsumed',
        chainId: sepolia.id,
      },
      {
        address: PAYMENT_GATE_ADDRESS,
        abi: paymentGateAbi,
        functionName: 'totalRevenue',
        chainId: sepolia.id,
      },
    ],
    query: { refetchInterval: 30_000 },
  })

  const { data: userCredits, isLoading: creditsLoading } = useReadContract({
    address: PAYMENT_GATE_ADDRESS,
    abi: paymentGateAbi,
    functionName: 'getCredits',
    args: [address!],
    chainId: sepolia.id,
    query: { enabled: !!address, refetchInterval: 30_000 },
  })

  const { data: userSpent, isLoading: spentLoading } = useReadContract({
    address: PAYMENT_GATE_ADDRESS,
    abi: paymentGateAbi,
    functionName: 'totalSpent',
    args: [address!],
    chainId: sepolia.id,
    query: { enabled: !!address, refetchInterval: 30_000 },
  })

  let gate: PaymentGateData | null = null

  if (data) {
    const price = data[0]
    const issued = data[1]
    const consumed = data[2]
    const revenue = data[3]

    const allSuccess =
      price?.status === 'success' &&
      issued?.status === 'success' &&
      consumed?.status === 'success' &&
      revenue?.status === 'success'

    if (allSuccess) {
      gate = {
        pricePerCredit: price.result as bigint,
        totalCreditsIssued: Number(issued.result as bigint),
        totalCreditsConsumed: Number(consumed.result as bigint),
        totalRevenue: revenue.result as bigint,
      }
    }
  }

  return {
    gate,
    userCredits: userCredits !== undefined ? Number(userCredits as bigint) : null,
    userSpent: userSpent !== undefined ? (userSpent as bigint) : null,
    isLoading: gateLoading,
    isWalletLoading: creditsLoading || spentLoading,
    isConnected: !!address,
    error,
  }
}
