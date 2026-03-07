import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { http } from 'wagmi'
import { sepolia, baseSepolia, arbitrumSepolia, optimismSepolia } from 'wagmi/chains'

const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'debor-dev'
const infuraKey = import.meta.env.VITE_INFURA_KEY || ''

export const wagmiConfig = getDefaultConfig({
  appName: 'DeBOR',
  projectId,
  chains: [sepolia, baseSepolia, arbitrumSepolia, optimismSepolia],
  transports: {
    [sepolia.id]: http(`https://sepolia.infura.io/v3/${infuraKey}`),
    [baseSepolia.id]: http(`https://base-sepolia.infura.io/v3/${infuraKey}`),
    [arbitrumSepolia.id]: http(`https://arbitrum-sepolia.infura.io/v3/${infuraKey}`),
    [optimismSepolia.id]: http(`https://optimism-sepolia.infura.io/v3/${infuraKey}`),
  },
})
