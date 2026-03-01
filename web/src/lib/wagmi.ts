import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { http } from 'wagmi'
import { sepolia, baseSepolia, arbitrumSepolia, optimismSepolia } from 'wagmi/chains'

const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'debor-dev'

export const wagmiConfig = getDefaultConfig({
  appName: 'DeBOR',
  projectId,
  chains: [sepolia, baseSepolia, arbitrumSepolia, optimismSepolia],
  transports: {
    [sepolia.id]: http('https://sepolia.infura.io/v3/b6652bb1dac64d0a96a7a01043b44ee4'),
    [baseSepolia.id]: http('https://base-sepolia.infura.io/v3/b6652bb1dac64d0a96a7a01043b44ee4'),
    [arbitrumSepolia.id]: http('https://arbitrum-sepolia.infura.io/v3/b6652bb1dac64d0a96a7a01043b44ee4'),
    [optimismSepolia.id]: http('https://optimism-sepolia.infura.io/v3/b6652bb1dac64d0a96a7a01043b44ee4'),
  },
})
