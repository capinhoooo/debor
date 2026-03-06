import {
  useWriteContract,
  useWaitForTransactionReceipt,
  useReadContract,
  useAccount,
} from 'wagmi'
import { sepolia } from 'wagmi/chains'
import { paymentGateAbi, erc20Abi } from '@/lib/abi'
import { PAYMENT_GATE_ADDRESS, USDC_TOKEN_ADDRESS } from '@/lib/contracts'

export function useUsdcAllowance() {
  const { address } = useAccount()

  const { data: allowance, refetch } = useReadContract({
    address: USDC_TOKEN_ADDRESS,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address ? [address, PAYMENT_GATE_ADDRESS] : undefined,
    chainId: sepolia.id,
    query: { enabled: !!address, refetchInterval: 15_000 },
  })

  return {
    allowance: allowance as bigint | undefined,
    refetchAllowance: refetch,
  }
}

export function useApproveUsdc() {
  const { writeContract, data: hash, isPending, reset, error } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  const approve = (amount: bigint) => {
    writeContract({
      address: USDC_TOKEN_ADDRESS,
      abi: erc20Abi,
      functionName: 'approve',
      args: [PAYMENT_GATE_ADDRESS, amount],
      chainId: sepolia.id,
    })
  }

  return { approve, isPending, isConfirming, isSuccess, hash, reset, error }
}

export function usePurchaseCredits() {
  const { writeContract, data: hash, isPending, reset, error } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  const purchase = (amount: bigint) => {
    writeContract({
      address: PAYMENT_GATE_ADDRESS,
      abi: paymentGateAbi,
      functionName: 'purchaseCredits',
      args: [amount],
      chainId: sepolia.id,
    })
  }

  return { purchase, isPending, isConfirming, isSuccess, hash, reset, error }
}
