# DeBOR — Decentralized Benchmark Oracle Rate

> **The SOFR/LIBOR of DeFi.** A transparent, manipulation-resistant benchmark interest rate computed from real on-chain lending data across 9 protocols and 6 chains.

**43 sources | 9 protocols | 6 chains | 5 assets | 13 contracts | 146 tests**

Built with **Chainlink CRE** for [Convergence: A Chainlink Hackathon](https://chain.link/hackathon) — DeFi & Tokenization | CRE & AI | Risk & Compliance

---

## Table of Contents

- [The Problem](#the-problem)
- [What DeBOR Does](#what-debor-does)
- [Architecture](#architecture)
- [Data Flow](#data-flow)
- [Smart Contracts](#smart-contracts)
- [CRE Workflow](#cre-workflow-10-handlers)
- [Cross-Chain (CCIP)](#cross-chain-ccip)
- [AI Market Intelligence](#ai-market-intelligence)
- [Risk & Compliance Engine](#risk--compliance-engine)
- [Payment Gate (x402)](#payment-gate-x402-credit-system)
- [Interest Rate Swap](#interest-rate-swap)
- [Frontend](#frontend)
- [Deployed Contracts](#deployed-contracts)
- [Protocol Sources](#protocol-sources-43-total)
- [Chainlink Integration Map](#chainlink-integration-map)
- [CRE Capabilities Used](#cre-capabilities-used)
- [Quick Start](#quick-start)
- [Project Structure](#project-structure)
- [Key Design Decisions](#key-design-decisions)
- [Tech Stack](#tech-stack)
- [By the Numbers](#by-the-numbers)

---

## The Problem

Traditional finance runs on benchmark rates. Every mortgage, bond, derivative, and risk model prices off SOFR or Treasury yields. The interest rate swap market alone is **$500+ trillion** in notional value.

DeFi has **$200B+ in lending TVL** but no standard reference rate. Each protocol has its own isolated rate. There is no aggregated benchmark, no term structure, no volatility metric, and no interest rate derivative market. Institutions cannot assess DeFi yields relative to a standard. Risk models remain primitive.

**DeBOR fills this gap.**

---

## What DeBOR Does

DeBOR reads live interest rates from **9 protocols** across **6 mainnet chains**, weights them by TVL from DeFiLlama, and publishes benchmark metrics on-chain every 30 minutes via Chainlink CRE.

### Live Oracle Data (Sepolia)

```
DeBOR-USDC                    DeBOR-ETH                     DeBOR-BTC
Rate:    3.69% (369 bps)      Rate:    2.27% (227 bps)      Rate:    0.82% (82 bps)
Supply:  2.18% (218 bps)      Supply:  1.52% (152 bps)      Supply:  0.03% (3 bps)
Spread:  151 bps              Spread:  75 bps               Spread:  79 bps
Sources: 14/14                Sources: 10/10                Sources: 5/5

DeBOR-DAI                     DeBOR-USDT
Rate:    4.19% (419 bps)      Rate:    3.79% (379 bps)
Sources: 8/8                  Sources: 6/6
```

On top of the benchmark oracle, DeBOR includes:

- **Interest Rate Swap Protocol** — The first DeFi IRS. Pay fixed, receive DeBOR floating. ERC-721 tokenized positions. CRE autonomously settles daily, monitors margins hourly, and detects rate spikes.
- **Cross-Chain Oracle via CCIP** — Benchmark data relayed from Sepolia to Base Sepolia, Arbitrum Sepolia, and Optimism Sepolia.
- **Adaptive Lending Consumer (v2)** — Demo contract that adjusts borrow rates and collateral ratios in real time based on DeBOR. Includes risk scoring, stress-test PnL estimation, and source diversity scoring.
- **AI Risk Metadata Oracle** — On-chain storage for DON-consensus LLM-generated risk assessments. CRE writes structured insights (risk level, score, anomaly flags, rate direction, spread health, market regime) to DeBORAIInsight contract. When risk is HIGH/CRITICAL, `isHighRisk()` autonomously blocks new swaps and pauses CRE settlement.
- **Credit-Gated API Access** — DeBORPaymentGate contract for metered access to premium endpoints. Users purchase credits with USDC.
- **Risk & Compliance Engine** — On-demand VaR/CVaR, HHI concentration index, Basel IRRBB stress tests, composite risk scoring, and rate manipulation detection audit trail.
- **AI Market Intelligence** — LLM-powered risk assessment via Groq API (llama-3.3-70b). DON nodes independently call the LLM and reach consensus on the verdict.

---

## Architecture

### System Overview

```
┌──────────────────────────── CRE Workflow (10 Handlers) ─────────────────────────────┐
│                                                                                      │
│  MAINNET READS (6 chains)                     SEPOLIA WRITES                         │
│  ┌──────────────────────────────────┐         ┌──────────────────────────────┐       │
│  │ Aave V3     (ETH/Base/Arb/      │         │ DeBOR-USDC Oracle (14 src)   │       │
│  │              OP/AVAX/Polygon)    │         │ DeBOR-ETH Oracle  (10 src)   │       │
│  │ Compound V3 (ETH/Base/Arb)      │         │ DeBOR-BTC Oracle  (5 src)    │       │
│  │ Spark       (ETH)               ├──►BME──►│ DeBOR-DAI Oracle  (8 src)    │       │
│  │ Morpho Blue (ETH)               │         │ DeBOR-USDT Oracle (6 src)    │       │
│  │ Moonwell    (Base/OP)           │         └──────────────┬───────────────┘       │
│  │ Benqi       (AVAX)              │                        │                       │
│  └──────────────────────────────────┘                       ▼                       │
│                                                ┌──────────────────────────────┐      │
│  TVL WEIGHTS         (DeFiLlama API)           │ DeBORSwap (ERC-721 IRS)     │      │
│  CHAINLINK PRICE FEEDS (ETH/BTC/USDC)          │ DeBORCCIPSender ──► 3 L2s   │      │
│  SOFR/EFFR COMPARISON (NY Fed API)             │ AdaptiveLending v2          │      │
│  HTTP VALIDATION LAYER (cross-check)           │  (risk score, stress PnL,   │      │
│  RISK ENGINE (VaR/CVaR/HHI/Basel)              │   source diversity)         │      │
│  AI INTELLIGENCE (Groq LLM API)                │ DeBORAIInsight              │      │
│  PAYMENT GATE (x402 credit check)              │ DeBORPaymentGate            │      │
│                                                └──────────────────────────────┘      │
│                                                                                      │
│  10 Handlers · 3 Trigger Types · 30+ CRE Capabilities · DON Consensus              │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### Full Data Pipeline

```
                          ┌─────────────────────────────────┐
                          │   6 MAINNET CHAINS              │
                          │   Ethereum · Base · Arbitrum     │
                          │   Optimism · Avalanche · Polygon │
                          └───────────────┬─────────────────┘
                                          │
                    EVMClient.callContract (LAST_FINALIZED_BLOCK_NUMBER)
                                          │
                          ┌───────────────▼─────────────────┐
                          │   RATE NORMALIZATION             │
                          │   Aave/Spark: RAY (10^27) → bps │
                          │   Compound:   WAD/sec → bps     │
                          │   Morpho:     RAY → bps         │
                          │   CToken:     per-block → bps   │
                          └───────────────┬─────────────────┘
                                          │
                    HTTPClient + DON Consensus (median TVL)
                                          │
                          ┌───────────────▼─────────────────┐
                          │   BENCHMARK ENGINE (BME)         │
                          │   TVL-weighted average rates     │
                          │   Spread = borrow - supply       │
                          │   Vol = cross-protocol std dev   │
                          │   Term7d = 336-period rolling    │
                          └───────────────┬─────────────────┘
                                          │
                    Risk gate + rate bounds validation
                                          │
                          ┌───────────────▼─────────────────┐
                          │   REPORT SIGNING                 │
                          │   runtime.report() → DON-signed  │
                          │   encodeAbiParameters(8 uint256) │
                          └───────────────┬─────────────────┘
                                          │
                    EVMClient.writeReport (ReceiverTemplate.onReport)
                                          │
                 ┌────────────────────────▼────────────────────────┐
                 │                   SEPOLIA L1                    │
                 │                                                 │
                 │  DeBOROracle (per asset)                        │
                 │  ├── Rate, Supply, Spread, Vol, Term7d          │
                 │  ├── Ring buffer: 336 periods (7 days)          │
                 │  ├── Circuit breaker: active + risk level       │
                 │  └── Event: BenchmarkUpdated                    │
                 │                                                 │
                 │  DeBORSwap ← reads oracle for daily settlement  │
                 │  DeBORAIInsight ← CRE writes Groq AI verdicts  │
                 │  DeBORPaymentGate ← users purchase credits      │
                 │  AdaptiveLending ← demo consumer                │
                 │                                                 │
                 │  DeBORCCIPSender ← auto-relays to L2s           │
                 └────────────────┬───────────────────────────────┘
                                  │
                    Chainlink CCIP (Client.EVM2AnyMessage)
                                  │
            ┌─────────────────────┼─────────────────────┐
            │                     │                     │
   ┌────────▼────────┐  ┌────────▼────────┐  ┌────────▼────────┐
   │  Base Sepolia    │  │  Arb Sepolia    │  │  OP Sepolia     │
   │  CCIPReceiver    │  │  CCIPReceiver   │  │  CCIPReceiver   │
   │  + risk metadata │  │  + risk metadata│  │  + risk metadata│
   └─────────────────┘  └─────────────────┘  └─────────────────┘
```

### Frontend Architecture

```
┌─────────────────────── React 19 (TanStack Start) ───────────────────────┐
│                                                                          │
│  wagmi v3 + viem        ──► reads oracle contracts on Sepolia            │
│  RainbowKit v2          ──► wallet connection                            │
│  TanStack Router        ──► file-based routing (9 pages)                 │
│  Framer Motion          ──► animations (fadeIn, stagger)                 │
│  Tailwind CSS 4 + HeroUI──► styling (benji editorial theme)             │
│                                                                          │
│  Pages:                                                                  │
│  /              Dashboard       5 asset rate cards, sparklines, 7d chart │
│  /asset/:symbol Asset Detail    TWAP, protocol breakdown, full benchmark │
│  /swap          Swap            Create/join/settle IRS positions         │
│  /cross-chain   Cross-Chain     L2 rates via CCIP, risk metadata         │
│  /ai            AI Intelligence Groq verdicts, risk score history         │
│  /risk          Risk Dashboard  VaR, CVaR, HHI, stress tests             │
│  /compare       Compare         DeBOR vs SOFR/EFFR (TradFi comparison)   │
│  /payment       Credits         x402 purchase flow (approve + buy)       │
│  /methodology   Methodology     Technical documentation                  │
│                                                                          │
│  Hooks (wagmi contract reads, 30s refetch):                              │
│  useOracleData, useSwapData, useCrossChainData, useAIInsightData,       │
│  usePaymentGateData, useRiskMetrics, useSOFRData, useConsumerData       │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow

### Benchmark Update (every 30 minutes)

```
1. CRON fires (staggered: USDC :00/:30, ETH :10/:40, BTC :20/:50, DAI :15/:45, USDT :18/:48)
2. READ mainnet rates via EVMClient.callContract
   Aave V3 / Spark  → getReserveData(asset) → currentVariableBorrowRate (RAY → bps)    [1 call]
   Compound V3       → getUtilization → getSupplyRate → getBorrowRate (WAD → bps)       [3 calls]
   Morpho Blue       → idToMarketParams → market → IRM.borrowRateView (WAD → bps)      [3 calls]
   Moonwell / Benqi  → supplyRatePerTimestamp + borrowRatePerTimestamp (CToken)          [2 calls]
3. FETCH TVL weights from DeFiLlama (HTTPClient + DON consensus aggregation)
4. COMPUTE benchmark (TVL-weighted average borrow rate, supply rate, spread, volatility, 7d term)
5. DRY-RUN rate guard: read current on-chain rate, warn if >500bps deviation
6. RISK GATE: evaluate circuit breaker thresholds (VaR warning/critical)
7. SIGN report (runtime.report + DON consensus)
8. WRITE to oracle on Sepolia (EVMClient.writeReport → ring buffer + BenchmarkUpdated event)
9. RELAY via CCIP to Base/Arbitrum/Optimism Sepolia (if ccipSenderAddress configured)
```

### USDC Multi-Handler Merge (14/14 sources)

USDC has 14 sources needing 22+ EVM calls, exceeding the CRE 15-call limit. Solved with a two-handler merge:

```
Trigger 0 (USDC Core)  :00/:30 → reads first 10 sources (15 calls) → writes to oracle
Trigger 8 (USDC Ext)   :02/:32 → reads remaining 4 sources (10 calls)
                                → reads oracle's current state via getFullBenchmark() (1 call)
                                → merges core + ext using source-count weighting
                                → writes combined 14/14 benchmark to oracle
```

### Benchmark Computation Formula

```
DeBOR_RATE = Sum(borrowBps_i * tvlUsd_i) / Sum(tvlUsd_i)
```

Each protocol's rate is weighted by its total value locked. A $27B protocol (Aave) has more influence than a $1B protocol. This mirrors how SOFR weights by transaction volume. All arithmetic uses `bigint` (no floating point, fully deterministic across DON nodes).

### Benchmark Metrics

| Metric | Unit | Description |
|--------|------|-------------|
| `deborRate` | bps | TVL-weighted average borrow rate across all sources |
| `deborSupply` | bps | TVL-weighted average supply rate across all sources |
| `deborSpread` | bps | Borrow-supply gap (risk indicator) |
| `deborVol` | scaled | Cross-protocol rate variance (disagreement metric) |
| `deborTerm7d` | bps | 7-day rolling average (336-entry ring buffer at 30-min intervals) |
| `numSources` | count | Number of sources that contributed to this update |
| `sourcesConfigured` | count | Total configured sources for this asset |

---

## Smart Contracts

### Contract Hierarchy

```
ReceiverTemplate (CRE forwarder validation)
├── DeBOROracle        Benchmark rate storage (per asset)
├── DeBORSwap          Interest rate swap protocol (ERC-721)
├── DeBORAIInsight     AI risk verdict storage
└── DeBORCCIPSender    CCIP cross-chain relay

CCIPReceiver (Chainlink CCIP)
└── DeBORCCIPReceiver  L2 benchmark receiver

Standalone
├── DeBORConsumer      Demo: adaptive lending using DeBOR rates
└── DeBORPaymentGate   x402 credit system for premium API access
```

### DeBOROracle

The core oracle contract stores TVL-weighted benchmark rates written by CRE.

- **Two report types**: Normal (type 0) updates rates; Alert (type 1) activates circuit breaker without changing rates
- **Rate bounds**: MAX_RATE_BPS=50000 (500%), MAX_DEVIATION_BPS=2000 (20% per update)
- **Ring buffer**: 336-period history (7 days at 30-min intervals) with TWAP computation
- **Circuit breaker**: Freezes rate updates on anomaly detection. Reset automatically on next valid report.

### DeBORSwap (Interest Rate Swap)

The first decentralized interest rate derivative. One party pays a fixed rate, the other pays the DeBOR floating rate.

| TradFi | DeBORSwap |
|--------|-----------|
| SOFR benchmark | DeBOR Oracle (on-chain, transparent) |
| CME clearinghouse | Smart contract (trustless) |
| $10M minimum | Any amount (0.01 ETH+) |
| Quarterly settlement | Daily settlement (CRE automated) |
| Phone call to dealer | `createSwap()` (instant, 24/7) |
| Paper confirmation | ERC-721 NFT position |

- **Margin**: 10% of notional required at creation and joining
- **Liquidation**: Triggered when margin falls below 1% of notional
- **Duration**: 1 to 365 days
- **Token ID scheme**: `swapId*2` for fixed payer, `swapId*2+1` for floating payer

### ReceiverTemplate

Abstract base contract for all CRE-integrated contracts. Provides:

- Forwarder address validation (only authorized CRE forwarder can write)
- Optional workflow identity checks (author, name, workflow ID)
- Single entry point: `onReport(metadata, report)` called by CRE DON

### DeBORCCIPSender / DeBORCCIPReceiver

Relays benchmark data cross-chain via Chainlink CCIP.

- **Sender** (Sepolia): Receives CRE reports, auto-relays to all active L2 destinations
- **Receiver** (Base/Arb/OP Sepolia): Validates source chain + sender address, stores rates + risk metadata
- **Format detection**: 7 fields (legacy) vs 10 fields (risk-aware with riskLevel, cbActive, riskScore)

### DeBORAIInsight

Stores DON-consensus AI verdicts from Groq LLM analysis:

- `riskLevel`: LOW (0), MEDIUM (1), HIGH (2), CRITICAL (3)
- `rateDirection`: STABLE (0), RISING (1), FALLING (2)
- `spreadHealth`: NORMAL (0), COMPRESSED (1), INVERTED (2)
- `marketRegime`: CONVERGED (0), NORMAL (1), DIVERGED (2), DISLOCATED (3)
- `riskScore`: 0-100 composite score
- `anomalyDetected`: boolean flag
- 48-period history buffer for risk score tracking

### DeBORPaymentGate

x402-style credit system for premium API access:

- Users deposit USDC via `purchaseCredits(amount)`
- 1 credit = 1 premium API call (risk analysis or AI insight)
- CRE checks `getCredits(user)` before serving premium actions
- Fail-closed: if configured and user has no credits, access is denied
- Tracks per-address spending and global revenue metrics

### DeBORConsumer (AdaptiveLending)

Demo contract showing how protocols would consume DeBOR:

- Adaptive borrow rate: `benchmark + BASE_SPREAD(200bps) + volatilityPremium`
- Volatility regimes: STABLE (<500bps vol), NORMAL, VOLATILE, CRISIS (>5000bps)
- Adaptive collateral ratio: increases as spread widens beyond 100bps
- Composite risk score (0-100): volatility (0-40pts) + spread (0-30pts) + source diversity (0-30pts)
- Stress test PnL: estimates swap impact under rate shock scenarios

---

## CRE Workflow: 10 Handlers

| # | Trigger | Schedule | Handler | Purpose |
|---|---------|----------|---------|---------|
| 0 | Cron | :00/:30 | `onUsdcTrigger` | USDC benchmark (core 10 sources) |
| 1 | Cron | :10/:40 | `onEthTrigger` | ETH benchmark (10 sources) |
| 2 | Cron | :20/:50 | `onBtcTrigger` | BTC benchmark (5 sources) |
| 3 | Cron | :15/:45 | `onDaiTrigger` | DAI benchmark (8 sources) |
| 4 | Cron | :18/:48 | `onUsdtTrigger` | USDT benchmark (6 sources) |
| 5 | Cron | :05/:35 | `onSwapLifecycle` | Merged: settlement + liquidation + spike detection |
| 6 | Cron | :25/:55 | `onPreflightCheck` | Health monitor + Chainlink prices + DON consensus |
| 7 | HTTP | on-demand | `onHttpTrigger` | On-demand refresh + validation + risk + AI analysis |
| 8 | Cron | :02/:32 | `onUsdcExtTrigger` | USDC ext merge (4 sources, achieves 14/14) |
| 9 | EVM Log | on event | `onBenchmarkUpdated` | Anomaly detection on BenchmarkUpdated event |

### Swap Lifecycle (Handler 5, unified)

Three previously separate handlers merged into one to recover trigger slots:

```
Phase 1: Rate Spike Detection
  ├── Read current rate + historical rate (2 periods back)
  ├── filterLogs: BenchmarkUpdated events for trend analysis (velocity, acceleration)
  └── If diff > rateSpikeThreshold (configurable, default 100bps) → flag spike

Phase 2: Liquidation Guard
  ├── Read at-risk swaps (margin < 1% of notional)
  └── Emergency settle if at-risk OR spike detected

Phase 3: Settlement + Closure
  ├── Batch settle mature swaps (daily interval passed)
  └── Batch close expired swaps (duration exceeded)
```

### Pre-flight Health Monitor (Handler 6)

```
1. Chain liveness: headerByNumber(LATEST_BLOCK_NUMBER)
2. Balance check: balanceAt(forwarder) + balanceAt(swapContract)
3. Gas estimation: estimateGas for oracle write
4. Chainlink prices: ETH/USD, BTC/USD, USDC/USD via latestRoundData
5. USDC de-peg: alert if >50bps deviation from $1
6. VaultDON secrets: getSecret("PREMIUM_API_KEY")
7. ConfidentialHTTPClient: TEE-based fetch (secret injection)
8. DON consensus: runInNodeMode() → median timestamp aggregation
```

### HTTP On-Demand Actions (Handler 7)

| Action | Endpoint | Description | Premium |
|--------|----------|-------------|---------|
| (none) | `{"asset":"USDC"}` | Refresh specific asset benchmark | No |
| `validate` | `{"action":"validate"}` | 8-step cross-check + SOFR cross-reference | No |
| `compare` | `{"action":"compare"}` | DeBOR vs SOFR/EFFR (DeFi premium analysis) | No |
| `risk` | `{"action":"risk"}` | VaR/CVaR/HHI/Basel stress tests | Yes |
| `analyze` | `{"action":"analyze"}` | AI market intelligence via Groq LLM | Yes |

### EVM Log Anomaly Detector (Handler 9)

Push-based event subscription on DeBOROracle:

```
1. BenchmarkUpdated event fires
2. getTransactionByHash: forensic tx analysis
3. Decode event data: extract new rate + source count
4. Read historical rate (1 period back)
5. If diff > anomalyThreshold (configurable, default 200bps):
   → Emergency settle all active swaps
```

---

## Cross-Chain (CCIP)

```
DeBOR Oracle (Sepolia)
       │
       ▼
DeBORCCIPSender
  ├── Calculates CCIP fees for all destinations
  ├── Encodes Client.EVM2AnyMessage with benchmark data
  └── Calls IRouterClient.ccipSend per destination
       │
       ├────────────────────────────────────┐
       │                                    │
       ▼                                    ▼
Base Sepolia Receiver         Arbitrum Sepolia Receiver
  ├── Validates source chain    ├── Same validation
  ├── Stores 5 benchmark        ├── Same storage
  │   metrics + risk metadata   │
  └── 336-period history        └── 336-period history
                                    │
                                    ▼
                          Optimism Sepolia Receiver
                            └── Same pattern
```

The CCIP sender auto-relays on every CRE report write. Risk metadata (riskLevel, circuitBreakerActive, riskScore) is included in the 10-field extended format, giving L2 consumers awareness of L1 risk state.

---

## AI Market Intelligence

### How It Works

```
┌─────────────────────────────────────────────────────┐
│                CRE DON (3+ nodes)                   │
│                                                     │
│  Node 1:                                            │
│  ├── Read 5 oracle benchmarks (EVMClient)           │
│  ├── Read Chainlink price feeds (ETH/BTC/USDC)      │
│  ├── Fetch SOFR/EFFR (HTTPClient + consensus)       │
│  ├── Build prompt with all context                  │
│  ├── Call Groq LLM (llama-3.3-70b-versatile)        │
│  └── Return structured JSON verdict                 │
│                                                     │
│  Node 2: Same independent execution                 │
│  Node 3: Same independent execution                 │
│                                                     │
│  Consensus: median(riskScore), identical(riskLevel) │
└─────────────────────────┬───────────────────────────┘
                          │
            DON-signed report (encodeAbiParameters)
                          │
                          ▼
              DeBORAIInsight contract
              ├── riskLevel, rateDirection
              ├── spreadHealth, marketRegime
              ├── riskScore (0-100)
              ├── anomalyDetected flag
              └── 48-period history buffer
```

### AI-Driven Circuit Breaker

If DON consensus returns `anomalyDetected=true AND riskLevel=CRITICAL`:

1. CRE writes ALERT reports (type 1) to all 5 oracles simultaneously
2. Each oracle sets `circuitBreakerActive=true`, `riskLevel=3` (CRITICAL)
3. Swap settlements are frozen until circuit breaker resets
4. Next valid normal report from CRE auto-resets the circuit breaker

---

## Risk & Compliance Engine

Invoked via HTTP action `risk`. Computes institutional-grade risk metrics:

### Quantitative Metrics

| Metric | Method | Description |
|--------|--------|-------------|
| VaR 95%/99% | Parametric (Z=1.645/2.326) | Maximum expected loss at confidence level |
| CVaR (ES) | Conditional tail expectation | Expected loss beyond VaR threshold |
| HHI | Herfindahl-Hirschman Index | Protocol concentration risk (0-1 scale) |
| Realized Vol | Temporal std deviation | Annualized rate volatility |
| Source Uptime | numSources / configured | Data availability ratio |

### Basel IRRBB Stress Scenarios

| Scenario | Shock | Purpose |
|----------|-------|---------|
| Parallel Up | +200bps | Standard interest rate shock |
| Parallel Down | -200bps | Rate decrease scenario |
| Short Rate Up | +300bps | Front-end rate shock |
| Short Rate Down | -300bps | Inverted short shock |

### Circuit Breaker Thresholds (configurable)

```
Rate deviation > varWarning (default 50bps)   → RISK_LEVEL_HIGH
Rate deviation > varCritical (default 200bps)  → RISK_LEVEL_CRITICAL + circuit breaker
Rate spike > rateSpikeThreshold (default 100bps) → emergency settlement
Anomaly > anomalyThreshold (default 200bps)    → anomaly alert
```

### Rate Manipulation Detection (Audit Trail)

The oracle emits `RateManipulationDetected` events when any proposed rate deviates more than 500bps from the current on-chain rate. This creates a permanent, indexable audit trail for compliance monitoring without blocking the update (the existing circuit breaker at 1000bps handles hard rejection).

```
RateManipulationDetected(timestamp, proposedRate, currentRate, deviationBps)
```

### AI-Driven Autonomous Risk Controls

The AI insight oracle is not advisory-only. It drives automated safety actions:

- **CRE workflow**: Phase 3 of the swap lifecycle reads `isHighRisk()` from the AI insight contract. When risk is HIGH or CRITICAL, settlement is paused autonomously. No human intervention required.
- **Smart contract**: `DeBORSwap.createSwap()` checks `isHighRisk()` on-chain. New swaps cannot be created during HIGH/CRITICAL risk periods. Reverts with `AIHighRiskActive()`.
- **Dual circuit breaker**: Both the rate-deviation circuit breaker (quantitative) and AI risk flag (qualitative) can independently halt operations, providing defense in depth.

---

## Payment Gate (x402 Credit System)

### End-to-End Flow

```
1. User approves USDC to DeBORPaymentGate contract
2. User calls purchaseCredits(amount)
   ├── USDC transferred to treasury: amount * pricePerCredit
   ├── credits[user] += amount
   └── Event: CreditsPurchased

3. User calls HTTP API with payer=userAddress
4. CRE verifies: getCredits(userAddress) >= minCredits
   ├── YES → proceed with premium action (risk/analyze)
   └── NO  → return PAYMENT_REQUIRED error

5. On success, CRE calls consumeCredit(user)
   └── credits[user] -= 1
```

### Fail-Closed Enforcement

```
if (gateConfigured && !payer)       → deny
if (gateConfigured && credits < 1)  → deny
if (readError)                      → deny (fail-closed)
if (!gateConfigured)                → free access
```

---

## Interest Rate Swap

### Lifecycle

```
User creates swap (fixed rate + margin) ──► Contract holds margin, status = OPEN
Counterparty joins (matching margin)    ──► Mint 2 ERC-721 NFTs, status = ACTIVE
CRE lifecycle every 30min (unified)     ──► Spike detection + liquidation guard + settlement
CRE anomaly on event (EVM Log trigger)  ──► Decode BenchmarkUpdated, emergency settle if >200bps
Swap expires or liquidates              ──► Return margins to NFT holders, burn tokens
```

### Settlement Math

```
Net payment per settlement = notional * |DeBOR_rate - fixed_rate| / 10000

If DeBOR > fixed: floating payer pays fixed payer
If DeBOR < fixed: fixed payer pays floating payer

Margin deducted from loser, credited to winner
```

---

## Frontend

### Tech Stack

TanStack Start (React 19 SSR) + wagmi v3 + RainbowKit v2 + HeroUI + Tailwind CSS 4 + Framer Motion

### Pages

| Route | Component | Data Source |
|-------|-----------|-------------|
| `/` | [`Dashboard.tsx`](web/src/components/Dashboard.tsx) | 5 oracle reads, sparkline history |
| `/asset/:symbol` | [`AssetPage.tsx`](web/src/components/AssetPage.tsx) | Single oracle full benchmark + TWAP |
| `/swap` | [`SwapPage.tsx`](web/src/components/SwapPage.tsx) | Swap contract reads + write hooks |
| `/cross-chain` | [`CrossChainPage.tsx`](web/src/components/CrossChainPage.tsx) | 4 chain reads (Sepolia + 3 L2 CCIP receivers) |
| `/ai` | [`AIInsightPage.tsx`](web/src/components/AIInsightPage.tsx) | AIInsight contract + risk score history |
| `/risk` | [`RiskDashboard.tsx`](web/src/components/RiskDashboard.tsx) | Consumer contract + client-side risk math |
| `/compare` | [`ComparePage.tsx`](web/src/components/ComparePage.tsx) | SOFR/EFFR API + oracle reads |
| `/payment` | [`PaymentGatePage.tsx`](web/src/components/PaymentGatePage.tsx) | PaymentGate reads + USDC approve/purchase |
| `/methodology` | [`MethodologyPage.tsx`](web/src/components/MethodologyPage.tsx) | Static documentation |

### Key Hooks

| Hook | File | Purpose |
|------|------|---------|
| `useOracleData` | [`useOracleData.ts`](web/src/hooks/useOracleData.ts) | Batch reads all 5 oracle benchmarks (30s refetch) |
| `useSwapData` | [`useSwapData.ts`](web/src/hooks/useSwapData.ts) | Swap contract reads + write hooks (create/join/settle/close) |
| `useCrossChainData` | [`useCrossChainData.ts`](web/src/hooks/useCrossChainData.ts) | CCIP receiver reads across 4 chains + risk metadata |
| `useAIInsightData` | [`useAIInsightData.ts`](web/src/hooks/useAIInsightData.ts) | AIInsight contract reads |
| `useAIInsightHistory` | [`useAIInsightHistory.ts`](web/src/hooks/useAIInsightHistory.ts) | Batch historical risk scores (48 entries) |
| `usePaymentGateData` | [`usePaymentGateData.ts`](web/src/hooks/usePaymentGateData.ts) | Credits balance + protocol stats |
| `usePaymentGateWrite` | [`usePaymentGateWrite.ts`](web/src/hooks/usePaymentGateWrite.ts) | USDC approve + purchase credits |
| `useRiskMetrics` | [`useRiskMetrics.ts`](web/src/hooks/useRiskMetrics.ts) | Consumer contract risk data |
| `useSOFRData` | [`useSOFRData.ts`](web/src/hooks/useSOFRData.ts) | NY Fed SOFR/EFFR API |
| `useConsumerData` | [`useConsumerData.ts`](web/src/hooks/useConsumerData.ts) | AdaptiveLending contract reads |
| `useCircuitBreaker` | [`useCircuitBreaker.ts`](web/src/hooks/useCircuitBreaker.ts) | Circuit breaker status per oracle |

### Design System

Benji editorial style: light-only, warm off-white (#f7f7f5), pink accent (rgb(255,0,170)), green dashed section lines, CSS custom variables, generous whitespace, typography-first approach.

---

## Deployed Contracts

### Sepolia

| Contract | Address | Verified |
|----------|---------|----------|
| DeBOR-USDC Oracle | [`0x7ec6d8C63f752b5e59e63826b603888Ccb7136c1`](https://sepolia.etherscan.io/address/0x7ec6d8C63f752b5e59e63826b603888Ccb7136c1) | Yes |
| DeBOR-ETH Oracle | [`0x0D4021b8aBEa12327194ef6379A18dF8124F6EFe`](https://sepolia.etherscan.io/address/0x0D4021b8aBEa12327194ef6379A18dF8124F6EFe) | Yes |
| DeBOR-BTC Oracle | [`0xE368d601f9b92D7cE3908a77A8CCe7549cb0B354`](https://sepolia.etherscan.io/address/0xE368d601f9b92D7cE3908a77A8CCe7549cb0B354) | Yes |
| DeBOR-DAI Oracle | [`0x7389C0b32212e85Ef142C235AF30b46C74dD249E`](https://sepolia.etherscan.io/address/0x7389C0b32212e85Ef142C235AF30b46C74dD249E) | Yes |
| DeBOR-USDT Oracle | [`0x245c878b80231065AA7C21CEa463958e3462d81A`](https://sepolia.etherscan.io/address/0x245c878b80231065AA7C21CEa463958e3462d81A) | Yes |
| DeBORSwap (ERC-721 IRS) | [`0x99c07Bb55e8c58E6b0e41F77D4d8DDC1eb8B6135`](https://sepolia.etherscan.io/address/0x99c07Bb55e8c58E6b0e41F77D4d8DDC1eb8B6135) | Yes |
| DeBORCCIPSender | [`0xb09A5F2B70dAD8fbBe03C23e80883c9900Add3F0`](https://sepolia.etherscan.io/address/0xb09A5F2B70dAD8fbBe03C23e80883c9900Add3F0) | Yes |
| AdaptiveLending (v2) | [`0x356509f8a5FE740488D9a6a596D617a67D153ddF`](https://sepolia.etherscan.io/address/0x356509f8a5FE740488D9a6a596D617a67D153ddF) | Yes |
| DeBORAIInsight | [`0x8767630Fa001F380bE5d752969C4DE8D8D083083`](https://sepolia.etherscan.io/address/0x8767630Fa001F380bE5d752969C4DE8D8D083083) | Yes |
| DeBORPaymentGate | [`0x6eba1116C94f2E0eE9034062aB37f315866fF6B2`](https://sepolia.etherscan.io/address/0x6eba1116C94f2E0eE9034062aB37f315866fF6B2) | Yes |
| CRE Forwarder | [`0x15fC6ae953E024d975e77382eEeC56A9101f9F88`](https://sepolia.etherscan.io/address/0x15fC6ae953E024d975e77382eEeC56A9101f9F88) | -- |

### Cross-Chain Receivers (CCIP)

| Chain | Contract | Address |
|-------|----------|---------|
| Base Sepolia | DeBORCCIPReceiver | [`0x99346FAbefdA21E17E49DEAC0e25a49c2B0cB084`](https://sepolia.basescan.org/address/0x99346FAbefdA21E17E49DEAC0e25a49c2B0cB084) |
| Arbitrum Sepolia | DeBORCCIPReceiver | [`0xE8163650f9e5bdAcd1e449f2fB70a5677bbA62ED`](https://sepolia.arbiscan.io/address/0xE8163650f9e5bdAcd1e449f2fB70a5677bbA62ED) |
| Optimism Sepolia | DeBORCCIPReceiver | [`0xecB93f03515DE67EA43272797Ea8eDa059985894`](https://sepolia-optimism.etherscan.io/address/0xecB93f03515DE67EA43272797Ea8eDa059985894) |

---

## Protocol Sources (43 total)

| Protocol | Type | Calls | USDC | ETH | BTC | DAI | USDT |
|----------|------|-------|------|-----|-----|-----|------|
| Aave V3 | aave | 1 | ETH, Base, Arb, OP, AVAX, Polygon | ETH, Base, Arb, OP, AVAX, Polygon | ETH, Arb, OP, AVAX | ETH, Arb, OP, AVAX, Polygon | ETH, Arb, OP, AVAX, Polygon |
| Spark | aave | 1 | ETH | ETH | -- | ETH | -- |
| Compound V3 | compound | 3 | ETH, Base, Arb | ETH | -- | -- | -- |
| Morpho Blue | morpho | 3 | ETH | -- | -- | -- | -- |
| Moonwell | ctoken | 2 | Base, OP | Base, OP | -- | OP | OP |
| Benqi | ctoken | 2 | AVAX | -- | AVAX | AVAX | -- |

---

## Chainlink Integration Map

Every file that uses Chainlink technology:

### CRE SDK (`@chainlink/cre-sdk`)

| File | Chainlink Usage |
|------|-----------------|
| [`main.ts`](DeBOR/DeBOR-Workflow/main.ts) | Runner, CronCapability, HTTPCapability, EVMClient, writeReport, runtime.report, runtime.getSecret, runtime.runInNodeMode, consensusMedianAggregation, prepareReportRequest, getNetwork, LATEST_BLOCK_NUMBER |
| [`rateReader.ts`](DeBOR/DeBOR-Workflow/rateReader.ts) | EVMClient.callContract (43 source reads), encodeCallMsg, bytesToHex, LAST_FINALIZED_BLOCK_NUMBER, isChainSelectorSupported, **Chainlink Price Feeds** (ETH/USD, BTC/USD, USDC/USD) |
| [`tvlFetcher.ts`](DeBOR/DeBOR-Workflow/tvlFetcher.ts) | HTTPClient.sendRequest, ConsensusAggregationByFields, median(), identical(), text(), ok() |
| [`benchmarkEngine.ts`](DeBOR/DeBOR-Workflow/benchmarkEngine.ts) | safeJsonStringify, UInt64 |
| [`swapManager.ts`](DeBOR/DeBOR-Workflow/swapManager.ts) | EVMClient.callContract, writeReport, filterLogs, headerByNumber, getTransactionReceipt, getTransactionByHash, prepareReportRequest, encodeCallMsg, bigintToProtoBigInt, protoBigIntToBigint |
| [`preflightCheck.ts`](DeBOR/DeBOR-Workflow/preflightCheck.ts) | EVMClient.headerByNumber, balanceAt, estimateGas, encodeCallMsg, protoBigIntToBigint, runtime.now(), LATEST_BLOCK_NUMBER |
| [`confidentialFetcher.ts`](DeBOR/DeBOR-Workflow/confidentialFetcher.ts) | ConfidentialHTTPClient.sendRequest (TEE-based, VaultDON secret injection) |
| [`httpValidator.ts`](DeBOR/DeBOR-Workflow/httpValidator.ts) | CRE consensus aggregation, oracle reads, sanity validation, TVL cross-check, historical consistency, SOFR cross-reference, DON-signed sendReport |
| [`riskAnalyst.ts`](DeBOR/DeBOR-Workflow/riskAnalyst.ts) | EVMClient.callContract (10 oracle reads), HTTPClient + ConsensusAggregationByFields (TVL for HHI), VaR/CVaR, HHI, Basel IRRBB stress tests |
| [`aiAnalyst.ts`](DeBOR/DeBOR-Workflow/aiAnalyst.ts) | EVMClient.callContract (5 oracle reads), HTTPClient.sendRequest (Groq LLM), structured risk classification |
| [`sofrComparator.ts`](DeBOR/DeBOR-Workflow/sofrComparator.ts) | HTTPClient.sendRequest, ConsensusAggregationByFields, NY Fed SOFR/EFFR API |
| [`abis.ts`](DeBOR/DeBOR-Workflow/abis.ts) | CHAINLINK_PRICE_FEED_ABI (latestRoundData, decimals) |
| [`types.ts`](DeBOR/DeBOR-Workflow/types.ts) | Config types for CRE workflow (oracle addresses, thresholds, chain selectors) |
| [`config.staging.json`](DeBOR/DeBOR-Workflow/config.staging.json) | 43 protocol sources, 5 oracle addresses, CRE chain selectors, risk thresholds |

### Chainlink CCIP (`@chainlink/contracts-ccip`)

| File | Usage |
|------|-------|
| [`DeBORCCIPSender.sol`](contract/src/DeBORCCIPSender.sol) | IRouterClient, Client.EVM2AnyMessage, Client.GenericExtraArgsV2, ccipSend, getFee |
| [`DeBORCCIPReceiver.sol`](contract/src/DeBORCCIPReceiver.sol) | CCIPReceiver, Client.Any2EVMMessage, _ccipReceive |
| [`DeployCCIP.s.sol`](contract/script/DeployCCIP.s.sol) | CCIP deployment scripts (router addresses, chain selectors) |

### CRE ReceiverTemplate (on-chain report verification)

| File | Usage |
|------|-------|
| [`ReceiverTemplate.sol`](contract/src/ReceiverTemplate.sol) | CRE forwarder validation (onReport, _processReport) |
| [`DeBOROracle.sol`](contract/src/DeBOROracle.sol) | Inherits ReceiverTemplate: receives DON-signed benchmark reports |
| [`DeBORSwap.sol`](contract/src/DeBORSwap.sol) | Inherits ReceiverTemplate: receives CRE swap settlement/liquidation actions |
| [`DeBORAIInsight.sol`](contract/src/DeBORAIInsight.sol) | Inherits ReceiverTemplate: receives DON-signed AI risk metadata |
| [`DeBORCCIPSender.sol`](contract/src/DeBORCCIPSender.sol) | Inherits ReceiverTemplate: receives CRE reports, auto-relays via CCIP |

### Chainlink Data Feeds

| Feed | Mainnet Address | Used In |
|------|-----------------|---------|
| ETH/USD | `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419` | [`rateReader.ts`](DeBOR/DeBOR-Workflow/rateReader.ts) |
| BTC/USD | `0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c` | [`rateReader.ts`](DeBOR/DeBOR-Workflow/rateReader.ts) |
| USDC/USD | `0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6` | [`rateReader.ts`](DeBOR/DeBOR-Workflow/rateReader.ts) |

### Frontend (reads Chainlink-integrated contracts)

| File | Usage |
|------|-------|
| [`contracts.ts`](web/src/lib/contracts.ts) | Oracle addresses, CCIP sender/receiver addresses, chain selectors |
| [`abi.ts`](web/src/lib/abi.ts) | ABIs for oracleAbi, ccipReceiverAbi, swapAbi, consumerAbi, aiInsightAbi, paymentGateAbi |
| [`useCrossChainData.ts`](web/src/hooks/useCrossChainData.ts) | Reads CCIP receiver contracts across 4 chains |
| [`CrossChainPage.tsx`](web/src/components/CrossChainPage.tsx) | Displays CCIP-relayed rates with risk metadata per L2 |

---

## CRE Capabilities Used

### Trigger Types (3 active)

| Trigger | Handlers | Purpose |
|---------|----------|---------|
| `CronCapability` | 8 | Benchmark updates, swap lifecycle, pre-flight health, USDC ext merge |
| `HTTPCapability` | 1 | On-demand benchmark refresh + HTTP validation layer |
| `EVMClient.logTrigger` | 1 | Anomaly detection on BenchmarkUpdated event (push-based) |

### EVMClient Methods (9)

| Method | Purpose |
|--------|---------|
| `callContract` | 43 mainnet rate reads + Chainlink Price Feeds + oracle state reads |
| `writeReport` | DON-signed benchmark writes to oracle + swap batch actions |
| `filterLogs` | Historical BenchmarkUpdated events for trend analysis |
| `headerByNumber` | Chain liveness verification |
| `balanceAt` | Forwarder + swap contract ETH balance monitoring |
| `estimateGas` | Dry-run gas estimation for oracle writes |
| `logTrigger` | EVM event trigger on BenchmarkUpdated (anomaly detection) |
| `getTransactionReceipt` | Post-write verification (status, gasUsed, logs) |
| `getTransactionByHash` | Forensic transaction analysis on anomaly events |

### Capability Classes (5)

`CronCapability` | `HTTPCapability` | `HTTPClient` | `ConfidentialHTTPClient` | `EVMClient`

### Runtime Methods (6)

`log()` | `now()` | `config` | `report()` | `getSecret()` | `runInNodeMode()`

### Consensus Strategies (9/9)

**Top-level (4/4):**
`consensusMedianAggregation` | `consensusIdenticalAggregation` | `consensusCommonPrefixAggregation` | `consensusCommonSuffixAggregation`

**Field-level (5/5):**
`median()` | `identical()` | `commonPrefix()` | `commonSuffix()` | `ignore()` — composed via `ConsensusAggregationByFields` + `.withDefault()`

### SDK Utilities (12)

`getNetwork` | `encodeCallMsg` | `bytesToHex` | `hexToBase64` | `prepareReportRequest` | `safeJsonStringify` | `isChainSelectorSupported` | `UInt64` | `bigintToProtoBigInt` | `protoBigIntToBigint` | `LAST_FINALIZED_BLOCK_NUMBER` | `LATEST_BLOCK_NUMBER`

---

## Quick Start

### Prerequisites

- [CRE CLI](https://github.com/smartcontractkit/chainlink-cre) installed
- [Foundry](https://book.getfoundry.sh/) installed
- Node.js 18+ / Bun

### Simulate the CRE Workflow

```bash
cd DeBOR

# Benchmark handlers (reads real mainnet rates)
cre workflow simulate ./DeBOR-Workflow --non-interactive --trigger-index 0   # USDC core (10 sources)
cre workflow simulate ./DeBOR-Workflow --non-interactive --trigger-index 1   # ETH (10 sources)
cre workflow simulate ./DeBOR-Workflow --non-interactive --trigger-index 2   # BTC (5 sources)
cre workflow simulate ./DeBOR-Workflow --non-interactive --trigger-index 3   # DAI (8 sources)
cre workflow simulate ./DeBOR-Workflow --non-interactive --trigger-index 4   # USDT (6 sources)
cre workflow simulate ./DeBOR-Workflow --non-interactive --trigger-index 8   # USDC ext merge (14/14)

# Swap lifecycle (merged: settle + liquidation + spike)
cre workflow simulate ./DeBOR-Workflow --non-interactive --trigger-index 5   # Swap lifecycle manager

# Pre-flight health monitor + Chainlink prices
cre workflow simulate ./DeBOR-Workflow --non-interactive --trigger-index 6   # Pre-flight check

# HTTP on-demand actions
cre workflow simulate ./DeBOR-Workflow --non-interactive --trigger-index 7 \
  --http-payload '{"asset":"USDC"}'                                          # Refresh specific asset
cre workflow simulate ./DeBOR-Workflow --non-interactive --trigger-index 7 \
  --http-payload '{"action":"validate"}'                                     # 8-step validation
cre workflow simulate ./DeBOR-Workflow --non-interactive --trigger-index 7 \
  --http-payload '{"action":"compare"}'                                      # SOFR/EFFR comparison
cre workflow simulate ./DeBOR-Workflow --non-interactive --trigger-index 7 \
  --http-payload '{"action":"risk"}'                                         # Risk analysis
cre workflow simulate ./DeBOR-Workflow --non-interactive --trigger-index 7 \
  --http-payload '{"action":"analyze"}'                                      # AI intelligence

# EVM Log anomaly detector (requires tx hash)
cre workflow simulate ./DeBOR-Workflow --non-interactive --trigger-index 9 \
  --evm-tx-hash <TX_HASH> --evm-event-index 0
```

### Broadcast to Sepolia

```bash
cd DeBOR

# Write real mainnet rates on-chain
cre workflow simulate ./DeBOR-Workflow --target staging-settings --non-interactive --trigger-index 0 --broadcast   # USDC
cre workflow simulate ./DeBOR-Workflow --target staging-settings --non-interactive --trigger-index 1 --broadcast   # ETH
cre workflow simulate ./DeBOR-Workflow --target staging-settings --non-interactive --trigger-index 2 --broadcast   # BTC
cre workflow simulate ./DeBOR-Workflow --target staging-settings --non-interactive --trigger-index 3 --broadcast   # DAI
cre workflow simulate ./DeBOR-Workflow --target staging-settings --non-interactive --trigger-index 4 --broadcast   # USDT
cre workflow simulate ./DeBOR-Workflow --target staging-settings --non-interactive --trigger-index 8 --broadcast   # USDC ext

# Broadcast HTTP actions
cre workflow simulate ./DeBOR-Workflow --target staging-settings --non-interactive --trigger-index 7 --broadcast \
  --http-payload '{"action":"risk"}'                                         # Risk → on-chain
cre workflow simulate ./DeBOR-Workflow --target staging-settings --non-interactive --trigger-index 7 --broadcast \
  --http-payload '{"action":"analyze"}'                                      # AI → DeBORAIInsight
```

Without `--broadcast`, `writeReport` returns a mock tx hash. With `--broadcast`, real transactions are submitted to Sepolia. All `callContract` reads are always real mainnet data regardless.

### Read Oracle On-Chain

```bash
# Read full benchmark (rate, supply, spread, vol, term7d, timestamp, sources, configured)
cast call 0x7ec6d8C63f752b5e59e63826b603888Ccb7136c1 \
  "getFullBenchmark()(uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256)" \
  --rpc-url https://sepolia.infura.io/v3/<YOUR_KEY>

# Read individual metrics
cast call 0x7ec6d8C63f752b5e59e63826b603888Ccb7136c1 "getRate()(uint256)" --rpc-url <RPC>
cast call 0x7ec6d8C63f752b5e59e63826b603888Ccb7136c1 "numSources()(uint256)" --rpc-url <RPC>
```

### Run Tests

```bash
cd contract && forge test -vvv
# 146 tests passing (27 Oracle + 26 Consumer + 25 CCIP + 47 Swap + 7 AIInsight + 14 PaymentGate)
```

### Run Frontend

```bash
cd web
bun install
bun dev        # Dev server on port 3300
bun build      # Production build
```

---

## Project Structure

```
debor-chainlink/
├── DeBOR/                          # CRE Project Root
│   ├── project.yaml                # RPC configs (6 mainnet chains + Sepolia)
│   ├── secrets.yaml                # VaultDON secret references
│   └── DeBOR-Workflow/             # Workflow source
│       ├── main.ts                 # 10 handler registrations + entry point
│       ├── rateReader.ts           # Protocol rate reads + Chainlink Price Feeds
│       ├── tvlFetcher.ts           # DeFiLlama TVL with consensus aggregation
│       ├── benchmarkEngine.ts      # TVL-weighted benchmark computation
│       ├── swapManager.ts          # IRS lifecycle (settle, liquidate, spike)
│       ├── preflightCheck.ts       # Health monitoring (liveness, balances, gas)
│       ├── confidentialFetcher.ts  # TEE-based TVL via ConfidentialHTTPClient
│       ├── httpValidator.ts        # HTTP validation + cross-check layer
│       ├── riskAnalyst.ts          # Risk engine: VaR/CVaR, HHI, Basel stress tests
│       ├── aiAnalyst.ts            # AI market intelligence via Groq LLM
│       ├── sofrComparator.ts       # SOFR/EFFR comparison (NY Fed API)
│       ├── types.ts                # TypeScript types + config interface
│       ├── abis.ts                 # Contract ABIs (Aave, Compound, Morpho, Chainlink)
│       └── config.staging.json     # 43 protocol sources + oracle addresses
├── contract/                       # Foundry smart contracts
│   ├── src/
│   │   ├── DeBOROracle.sol         # Benchmark oracle (ring buffer, circuit breaker)
│   │   ├── DeBORSwap.sol           # Interest rate swap (ERC-721 positions)
│   │   ├── DeBORCCIPSender.sol     # CCIP cross-chain relay (3 destinations)
│   │   ├── DeBORCCIPReceiver.sol   # CCIP receiver (Base + Arb + OP Sepolia)
│   │   ├── DeBORConsumer.sol       # AdaptiveLending demo consumer
│   │   ├── DeBORAIInsight.sol      # AI-powered risk metadata oracle
│   │   ├── DeBORPaymentGate.sol    # Credit-gated API access control
│   │   └── ReceiverTemplate.sol    # CRE forwarder validation base
│   ├── test/
│   │   ├── DeBOROracle.t.sol       # 25 tests (reports, history, circuit breaker, TWAP)
│   │   ├── DeBORConsumer.t.sol     # 26 tests (regimes, risk score, stress PnL, diversity)
│   │   ├── DeBORCCIP.t.sol         # 25 tests (sender, receiver, routing)
│   │   ├── DeBORSwap.t.sol         # 44 tests (lifecycle, settlement, liquidation)
│   │   ├── DeBORAIInsight.t.sol    # 7 tests (verdict storage, history)
│   │   └── DeBORPaymentGate.t.sol  # 14 tests (purchase, consume, gating)
│   └── script/                     # Deployment scripts
├── web/                            # Frontend (TanStack Start)
│   ├── src/
│   │   ├── components/             # Page components + UI elements
│   │   ├── hooks/                  # wagmi contract read/write hooks
│   │   ├── routes/                 # File-based routes (9 pages)
│   │   ├── lib/                    # ABIs, contract addresses, wagmi config
│   │   ├── utils/                  # Format, style, motion, risk utilities
│   │   └── providers/              # React context (Web3, Theme, HeroUI)
│   └── package.json
├── README.md
├── RUN.md                          # How to broadcast real rates to Sepolia
├── CRE_UTILIZE.md                  # CRE SDK utilization report (100% coverage)
└── TENDERLY.md                     # Tenderly Virtual TestNets integration guide
```

---

## Key Design Decisions

1. **Read Mainnet, Write Testnet** — Real production rates from live DeFi protocols, safe testnet writes for development
2. **Separate handler per asset** — Each asset gets its own 15 EVM call budget (CRE hard limit)
3. **Multi-handler merge** — USDC splits across 2 handlers to achieve 14/14 sources within the 15-call limit
4. **Staggered schedules** — Prevents trigger contention (USDC :00, ETH :10, BTC :20, etc.)
5. **TVL-weighted** — Larger protocols have proportional influence on the benchmark, like SOFR weights by volume
6. **ERC-721 swap positions** — Tradeable NFTs, CRE settlements go to current `ownerOf()`
7. **CRE as clearinghouse** — DON autonomously settles, monitors, and liquidates swaps (unified lifecycle handler)
8. **3 trigger types** — Cron (scheduled), HTTP (on-demand), EVM Log (event-driven): maximum CRE trigger diversity
9. **Config ordering** — Cheap sources first (Aave=1 call) to maximize sources within EVM call budget
10. **Configurable thresholds** — rateSpikeThreshold, anomalyThreshold, maxSwapsPerBatch all in config.staging.json (not hardcoded)
11. **Fail-closed payment gate** — If PaymentGate configured and read fails, deny access (never fail-open)
12. **Dual circuit breaker** — Triggered by rate deviation (quantitative) OR AI anomaly detection (LLM consensus)

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Workflow | Chainlink CRE SDK v1.1.2 (TypeScript) |
| Contracts | Solidity 0.8.24, Foundry |
| Cross-Chain | Chainlink CCIP (3 L2 destinations) |
| Price Feeds | Chainlink Data Feeds (ETH/USD, BTC/USD, USDC/USD) |
| TVL Data | DeFiLlama API |
| TradFi Benchmarks | NY Fed Markets API (SOFR, EFFR) |
| AI / LLM | Groq API (llama-3.3-70b-versatile) |
| Frontend | TanStack Start (React 19), wagmi v3, RainbowKit v2, HeroUI |
| Styling | Tailwind CSS 4, Framer Motion |
| ABI Encoding | viem |
| Config | zod schema validation |

---

## By the Numbers

| Metric | Count |
|--------|-------|
| Rate Sources | 43 (mainnet on-chain reads) |
| Protocols | 6 (Aave V3, Compound V3, Spark, Morpho Blue, Moonwell, Benqi) |
| Chains Read | 6 (Ethereum, Base, Arbitrum, Optimism, Avalanche, Polygon) |
| Chains Written | 4 (Sepolia, Base Sepolia, Arb Sepolia, OP Sepolia) |
| Asset Benchmarks | 5 (USDC, ETH, BTC, DAI, USDT) |
| Smart Contracts | 13 deployed + verified |
| CRE Handlers | 10 (6 benchmark + 1 swap lifecycle + 1 pre-flight + 1 HTTP + 1 EVM Log) |
| HTTP Actions | 5 (asset refresh, validate, compare, risk analysis, AI intelligence) |
| External APIs | 3 (DeFiLlama TVL, NY Fed SOFR/EFFR, Groq LLM) |
| CRE Capabilities | 30+ |
| Trigger Types | 3 (Cron + HTTP + EVM Log) |
| Consensus Strategies | 9 (4 top-level + 5 field-level) |
| Tests | 146 |
| Frontend Pages | 9 |

---

## Hackathon

**Convergence: A Chainlink Hackathon**

| Track | Target |
|-------|--------|
| **DeFi & Tokenization** | Primary ($12K / $8K) |
| **CRE & AI** | AI-driven autonomous risk controls, DON-consensus LLM verdicts |
| **Risk & Compliance** | VaR/CVaR, Basel IRRBB, rate manipulation audit trail, dual circuit breakers |

---

## License

MIT
