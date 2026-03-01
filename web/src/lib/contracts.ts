import { type Address } from 'viem'

export const SEPOLIA_CHAIN_ID = 11155111

// Oracle addresses per asset
export const ORACLE_ADDRESSES = {
  USDC: '0x102Ad94B7D28B9222bf7F24Cd0022B6904A8A78E' as Address,
  ETH: '0x1c6c56A422B73Ee0c70c029BEF0deD113a98c727' as Address,
  BTC: '0x2836153c31bD747Beb470620212f6855DB7c76a4' as Address,
  DAI: '0x4929981f89CBA741b5ED8B48283B125eaD483754' as Address,
  USDT: '0xfcF28e4E4bCCD4477AFd5BDbf5a4943645752BDD' as Address,
} as const

export const CONSUMER_ADDRESS = '0x356509f8a5FE740488D9a6a596D617a67D153ddF' as Address
export const SWAP_ADDRESS = '0x4bB75f3863B885300DB9e87f9E8DC4d71d94B5aB' as Address
export const CCIP_SENDER_ADDRESS = '0xb09A5F2B70dAD8fbBe03C23e80883c9900Add3F0' as Address
export const AI_INSIGHT_ADDRESS = '0x8767630Fa001F380bE5d752969C4DE8D8D083083' as Address
export const PAYMENT_GATE_ADDRESS = '0x6eba1116C94f2E0eE9034062aB37f315866fF6B2' as Address
export const USDC_TOKEN_ADDRESS = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as Address

export const CCIP_RECEIVERS = {
  'Base Sepolia': {
    address: '0x99346FAbefdA21E17E49DEAC0e25a49c2B0cB084' as Address,
    chainId: 84532,
    chainSelector: '10344971235874465080',
  },
  'Arb Sepolia': {
    address: '0xE8163650f9e5bdAcd1e449f2fB70a5677bbA62ED' as Address,
    chainId: 421614,
    chainSelector: '3478487238524512106',
  },
  'OP Sepolia': {
    address: '0xecB93f03515DE67EA43272797Ea8eDa059985894' as Address,
    chainId: 11155420,
    chainSelector: '5224473277236331295',
  },
} as const

export type AssetKey = keyof typeof ORACLE_ADDRESSES

export const ASSETS: AssetKey[] = ['USDC', 'ETH', 'BTC', 'DAI', 'USDT']
