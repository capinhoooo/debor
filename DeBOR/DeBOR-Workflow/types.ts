export type AssetClass = 'USDC' | 'ETH' | 'BTC' | 'DAI' | 'USDT'

export interface ProtocolRateConfig {
  protocol: string
  chain: string
  chainSelectorName: string
  contractAddress: string
  assetAddress: string
  rateType: 'aave' | 'compound' | 'spark' | 'morpho' | 'ctoken'
  asset: AssetClass
}

export interface NormalizedRate {
  protocol: string
  chain: string
  asset: AssetClass
  supplyBps: bigint
  borrowBps: bigint
}

export interface TVLWeight {
  protocol: string
  tvlUsd: bigint
}

export interface WeightedRate extends NormalizedRate {
  tvlUsd: bigint
}

export interface DeBORMetrics {
  deborRate: bigint
  deborSupply: bigint
  deborSpread: bigint
  deborVol: bigint
  deborTerm7d: bigint
  timestamp: bigint
  numSources: bigint
  sourcesConfigured: bigint
}

export interface OracleAddresses {
  USDC: string
  ETH: string
  BTC: string
  DAI: string
  USDT: string
}

export interface PriceContext {
  ethUsd: bigint
  btcUsd: bigint
  usdcUsd: bigint
  timestamp: bigint
}

export interface Config {
  schedule: string
  protocols: ProtocolRateConfig[]
  tvlApiBase: string
  targetChainSelectorName: string
  oracleAddresses: OracleAddresses
  gasLimit: string
  swapAddress?: string
}