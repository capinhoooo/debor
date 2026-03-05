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

export interface RiskThresholds {
  varWarning: number
  varCritical: number
  hhiWarning: number
  spreadWarning: number
}

export interface Config {
  schedule: string
  protocols: ProtocolRateConfig[]
  tvlApiBase: string
  targetChainSelectorName: string
  oracleAddresses: OracleAddresses
  gasLimit: string
  swapAddress?: string
  sofrApiBase?: string
  sofrEndpoint?: string
  effrEndpoint?: string
  groqApiModel?: string
  groqApiKey?: string
  riskThresholds?: RiskThresholds
  ccipSenderAddress?: string
  aiInsightAddress?: string
  paymentGateAddress?: string
  paymentMinCredits?: string // minimum credits required (in USDC wei)
  rateSpikeThreshold?: string // bps threshold for rate spike detection (default: 100)
  anomalyThreshold?: string   // bps threshold for anomaly detection (default: 200)
  maxSwapsPerBatch?: string   // max swaps per batch operation (default: 10)
}

// --- Circuit Breaker Report Constants ---
export const REPORT_TYPE_NORMAL = 0
export const REPORT_TYPE_ALERT = 1

export const RISK_LEVEL_LOW = 0
export const RISK_LEVEL_MEDIUM = 1
export const RISK_LEVEL_HIGH = 2
export const RISK_LEVEL_CRITICAL = 3

export interface SOFRData {
  rate: number 
  rateBps: number
  date: string
  volumeBillions: number
  percentile1: number
  percentile99: number
}

export interface EFFRData {
  rate: number
  rateBps: number
  date: string
  targetFrom: number
  targetTo: number
}

export type MarketRegime = 'CONVERGED' | 'NORMAL' | 'DIVERGED' | 'DISLOCATED'

export interface AssetComparison {
  asset: string
  deborRate: number
  sofrRate: number
  effrRate: number
  defiPremium: number 
  regime: MarketRegime
}

export interface SOFRComparisonResult {
  sofr: SOFRData
  effr: EFFRData
  comparisons: AssetComparison[]
  avgStablePremium: number
  summary: string
}

// --- Risk & Compliance Types ---

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export interface StressResult {
  scenario: string
  shockedRate: number
  impact: number
  breachesVaR: boolean
}

export interface RiskMetrics {
  // VaR (parametric from realized vol)
  var95: number              // 95% 30-min VaR (bps)
  var99: number              // 99% 30-min VaR (bps)
  cvar95: number             // Conditional VaR / Expected Shortfall (bps)
  cvar99: number

  // Volatility
  realizedVol: number        // Annualized temporal volatility (bps)
  crossProtocolVol: number   // Existing deborVol (point-in-time disagreement)

  // Concentration
  protocolHHI: number        // 0-1 scale (lower = more diverse)
  effectiveSources: number   // 1/HHI (higher = better)
  maxSourceWeight: number    // Largest TVL share (0-1)

  // Stress Tests
  stressResults: StressResult[]

  // TradFi Comparison
  sofrSpread: number         // DeBOR - SOFR (bps)
  regime: MarketRegime

  // Source Health
  sourceUptime: number       // numSources / configured (0-1)

  // Overall
  riskLevel: RiskLevel
  summary: string
}

// --- CRE & AI Types ---

export type RateDirection = 'RISING' | 'FALLING' | 'STABLE'
export type SpreadHealth = 'NORMAL' | 'COMPRESSED' | 'INVERTED'

export interface AIAnalysis {
  riskLevel: string          // "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
  riskScore: number          // 0-100
  anomalyDetected: boolean   // true | false
  rateDirection: string      // "RISING" | "FALLING" | "STABLE"
  spreadHealth: string       // "NORMAL" | "COMPRESSED" | "INVERTED"
  explanation: string        // Free text (non-deterministic)
  analyzedAt: number         // Timestamp (node-local)
}