import { useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { sepolia } from 'wagmi/chains'
import { parseEther } from 'viem'
import { swapAbi } from '@/lib/abi'
import { SWAP_ADDRESS } from '@/lib/contracts'

export const SWAP_STATUS = ['Open', 'Active', 'Settled', 'Liquidated'] as const

export interface SwapData {
  id: number
  fixedPayer: string
  floatingPayer: string
  notional: bigint
  fixedRateBps: bigint
  duration: bigint
  startedAt: bigint
  fixedPayerMargin: bigint
  floatingPayerMargin: bigint
  status: number
  totalSettlements: bigint
}

export function useSwapCount() {
  return useReadContract({
    address: SWAP_ADDRESS,
    abi: swapAbi,
    functionName: 'getSwapCount',
    chainId: sepolia.id,
    query: { refetchInterval: 15_000 },
  })
}

export function useSwapDetails(swapId: number) {
  const { data, isLoading } = useReadContracts({
    contracts: [
      {
        address: SWAP_ADDRESS,
        abi: swapAbi,
        functionName: 'getSwap',
        args: [BigInt(swapId)],
        chainId: sepolia.id,
      },
      {
        address: SWAP_ADDRESS,
        abi: swapAbi,
        functionName: 'getUnrealizedPnL',
        args: [BigInt(swapId)],
        chainId: sepolia.id,
      },
    ],
    query: { refetchInterval: 15_000 },
  })

  const swapResult = data?.[0]
  const pnlResult = data?.[1]

  let swap: SwapData | null = null
  if (swapResult?.status === 'success' && swapResult.result) {
    const r = swapResult.result as [string, string, bigint, bigint, bigint, bigint, bigint, bigint, number, bigint]
    swap = {
      id: swapId,
      fixedPayer: r[0],
      floatingPayer: r[1],
      notional: r[2],
      fixedRateBps: r[3],
      duration: r[4],
      startedAt: r[5],
      fixedPayerMargin: r[6],
      floatingPayerMargin: r[7],
      status: r[8],
      totalSettlements: r[9],
    }
  }

  let pnl: { fixed: bigint; floating: bigint } | null = null
  if (pnlResult?.status === 'success' && pnlResult.result) {
    const r = pnlResult.result as [bigint, bigint]
    pnl = { fixed: r[0], floating: r[1] }
  }

  return { swap, pnl, isLoading }
}

export interface NftOwnership {
  fixedTokenId: number
  floatingTokenId: number
  fixedHolder: string | null
  floatingHolder: string | null
  fixedTransferred: boolean
  floatingTransferred: boolean
}

export interface SwapWithPnL extends SwapData {
  pnl: { fixed: bigint; floating: bigint } | null
  nft: NftOwnership | null
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

export function useMultipleSwaps(count: number) {
  const ids = Array.from({ length: count }, (_, i) => i)
  const swapContracts = ids.map((id) => ({
    address: SWAP_ADDRESS,
    abi: swapAbi,
    functionName: 'getSwap' as const,
    args: [BigInt(id)] as const,
    chainId: sepolia.id,
  }))
  const pnlContracts = ids.map((id) => ({
    address: SWAP_ADDRESS,
    abi: swapAbi,
    functionName: 'getUnrealizedPnL' as const,
    args: [BigInt(id)] as const,
    chainId: sepolia.id,
  }))
  // ownerOf for fixed (swapId*2) and floating (swapId*2+1) NFT positions
  const fixedOwnerContracts = ids.map((id) => ({
    address: SWAP_ADDRESS,
    abi: swapAbi,
    functionName: 'ownerOf' as const,
    args: [BigInt(id * 2)] as const,
    chainId: sepolia.id,
  }))
  const floatingOwnerContracts = ids.map((id) => ({
    address: SWAP_ADDRESS,
    abi: swapAbi,
    functionName: 'ownerOf' as const,
    args: [BigInt(id * 2 + 1)] as const,
    chainId: sepolia.id,
  }))

  const { data, isLoading, error } = useReadContracts({
    contracts: [...swapContracts, ...pnlContracts, ...fixedOwnerContracts, ...floatingOwnerContracts],
    query: { refetchInterval: 15_000, enabled: count > 0 },
  })

  const swaps: SwapWithPnL[] = []
  if (data) {
    for (let i = 0; i < count; i++) {
      const result = data[i]
      if (result?.status === 'success' && result.result) {
        const r = result.result as [string, string, bigint, bigint, bigint, bigint, bigint, bigint, number, bigint]
        const pnlResult = data[count + i]
        let pnl: { fixed: bigint; floating: bigint } | null = null
        if (pnlResult?.status === 'success' && pnlResult.result) {
          const p = pnlResult.result as [bigint, bigint]
          pnl = { fixed: p[0], floating: p[1] }
        }

        // Parse NFT ownership (ownerOf reverts for non-existent tokens, so check status)
        const fixedOwnerResult = data[count * 2 + i]
        const floatingOwnerResult = data[count * 3 + i]
        const fixedHolder = fixedOwnerResult?.status === 'success' ? (fixedOwnerResult.result as string) : null
        const floatingHolder = floatingOwnerResult?.status === 'success' ? (floatingOwnerResult.result as string) : null

        const isActive = r[8] === 1
        const nft: NftOwnership | null = isActive
          ? {
              fixedTokenId: i * 2,
              floatingTokenId: i * 2 + 1,
              fixedHolder,
              floatingHolder,
              fixedTransferred: fixedHolder !== null && fixedHolder.toLowerCase() !== r[0].toLowerCase(),
              floatingTransferred: floatingHolder !== null && r[1] !== ZERO_ADDRESS && floatingHolder.toLowerCase() !== r[1].toLowerCase(),
            }
          : null

        swaps.push({
          id: i,
          fixedPayer: r[0],
          floatingPayer: r[1],
          notional: r[2],
          fixedRateBps: r[3],
          duration: r[4],
          startedAt: r[5],
          fixedPayerMargin: r[6],
          floatingPayerMargin: r[7],
          status: r[8],
          totalSettlements: r[9],
          pnl,
          nft,
        })
      }
    }
  }

  return { swaps, isLoading, error }
}

export function useCreateSwap() {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  const createSwap = (fixedRateBps: number, durationDays: number, marginEth: string) => {
    writeContract({
      address: SWAP_ADDRESS,
      abi: swapAbi,
      functionName: 'createSwap',
      args: [BigInt(fixedRateBps), BigInt(durationDays * 86400)],
      value: parseEther(marginEth),
      chainId: sepolia.id,
    })
  }

  return { createSwap, isPending, isConfirming, isSuccess, hash, error, reset }
}

export function useJoinSwap() {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  const joinSwap = (swapId: number, marginEth: string) => {
    writeContract({
      address: SWAP_ADDRESS,
      abi: swapAbi,
      functionName: 'joinSwap',
      args: [BigInt(swapId)],
      value: parseEther(marginEth),
      chainId: sepolia.id,
    })
  }

  return { joinSwap, isPending, isConfirming, isSuccess, hash, error, reset }
}

export function useCancelSwap() {
  const { writeContract, data: hash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  const cancelSwap = (swapId: number) => {
    writeContract({
      address: SWAP_ADDRESS,
      abi: swapAbi,
      functionName: 'cancelSwap',
      args: [BigInt(swapId)],
      chainId: sepolia.id,
    })
  }

  return { cancelSwap, isPending, isConfirming, isSuccess, hash }
}

export function useSettleSwap() {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  const settle = (swapId: number) => {
    writeContract({
      address: SWAP_ADDRESS,
      abi: swapAbi,
      functionName: 'settle',
      args: [BigInt(swapId)],
      chainId: sepolia.id,
    })
  }

  return { settle, isPending, isConfirming, isSuccess, hash, error, reset }
}

export function useCloseSwap() {
  const { writeContract, data: hash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  const closeSwap = (swapId: number) => {
    writeContract({
      address: SWAP_ADDRESS,
      abi: swapAbi,
      functionName: 'closeSwap',
      args: [BigInt(swapId)],
      chainId: sepolia.id,
    })
  }

  return { closeSwap, isPending, isConfirming, isSuccess, hash }
}

export function useSwapCategories() {
  const { data, isLoading } = useReadContracts({
    contracts: [
      {
        address: SWAP_ADDRESS,
        abi: swapAbi,
        functionName: 'getSettleableSwaps',
        args: [20n],
        chainId: sepolia.id,
      },
      {
        address: SWAP_ADDRESS,
        abi: swapAbi,
        functionName: 'getExpiredSwaps',
        args: [20n],
        chainId: sepolia.id,
      },
      {
        address: SWAP_ADDRESS,
        abi: swapAbi,
        functionName: 'getAtRiskSwaps',
        args: [20n],
        chainId: sepolia.id,
      },
      {
        address: SWAP_ADDRESS,
        abi: swapAbi,
        functionName: 'getCurrentRate',
        chainId: sepolia.id,
      },
    ],
    query: { refetchInterval: 15_000 },
  })

  const settleable = data?.[0]?.status === 'success' ? (data[0].result as bigint[]).map(Number) : []
  const expired = data?.[1]?.status === 'success' ? (data[1].result as bigint[]).map(Number) : []
  const atRisk = data?.[2]?.status === 'success' ? (data[2].result as bigint[]).map(Number) : []
  const currentRate = data?.[3]?.status === 'success' ? Number(data[3].result as bigint) : null

  return { settleable, expired, atRisk, currentRate, isLoading }
}
