# DeBOR — Decentralized Benchmark Oracle Rate

> **The SOFR/LIBOR of DeFi.** A transparent, manipulation-resistant benchmark interest rate computed from real on-chain lending data across 9 protocols and 6 chains.

**43 sources | 9 protocols | 6 chains | 5 assets | 12 contracts | 80 tests**

Built with **Chainlink CRE** for [Convergence: A Chainlink Hackathon](https://chain.link/hackathon) — DeFi & Tokenization Track

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
Rate:    3.72% (372 bps)      Rate:    2.28% (228 bps)      Rate:    0.82% (82 bps)
Supply:  2.21% (221 bps)      Supply:  1.54% (154 bps)      Supply:  0.03% (3 bps)
Spread:  151 bps              Spread:  74 bps               Spread:  79 bps
Sources: 14/14                Sources: 10/10                Sources: 5/5

DeBOR-DAI                     DeBOR-USDT
Rate:    4.03% (403 bps)      Rate:    3.75% (375 bps)
Sources: 8/8                  Sources: 6/6
```

On top of the benchmark oracle, DeBOR includes:

- **Interest Rate Swap Protocol** — The first DeFi IRS. Pay fixed, receive DeBOR floating. ERC-721 tokenized positions. CRE autonomously settles daily, monitors margins hourly, and detects rate spikes.
- **Cross-Chain Oracle via CCIP** — Benchmark data relayed from Sepolia to Base Sepolia, Arbitrum Sepolia, and Optimism Sepolia.
- **Adaptive Lending Consumer (v2)** — Demo contract that adjusts borrow rates and collateral ratios in real time based on DeBOR. Includes risk scoring, stress-test PnL estimation, and source diversity scoring.
- **Risk & Compliance Engine** — On-demand VaR/CVaR, HHI concentration index, Basel IRRBB stress tests, and composite risk scoring.
- **AI Market Intelligence** — LLM-powered risk assessment via Groq API (llama-3.3-70b). Reads all oracle benchmarks + SOFR, returns structured risk classification.

---

## Architecture

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
│  AI INTELLIGENCE (Groq LLM API)                └──────────────────────────────┘      │
│                                                                                      │
│  10 Handlers · 3 Trigger Types · 30+ CRE Capabilities · DON Consensus              │
└──────────────────────────────────────────────────────────────────────────────────────┘
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
6. SIGN report (runtime.report + DON consensus)
7. WRITE to oracle on Sepolia (EVMClient.writeReport → ring buffer + BenchmarkUpdated event)
```

### USDC Multi-Handler Merge (14/14 sources)

USDC has 14 sources needing 22+ EVM calls, exceeding the CRE 15-call limit. Solved with a two-handler merge:

```
Trigger 0 (USDC Core)  :00/:30 → reads first 10 sources (15 calls) → writes to oracle
Trigger 9 (USDC Ext)   :02/:32 → reads remaining 4 sources (10 calls)
                                → reads oracle's current state via getFullBenchmark() (1 call)
                                → merges core + ext using source-count weighting
                                → writes combined 14/14 benchmark to oracle
```

### Swap Lifecycle (CRE-automated)

```
User creates swap (fixed rate + margin) ──► Contract holds margin, status = OPEN
Counterparty joins (matching margin)    ──► Mint 2 ERC-721 NFTs, status = ACTIVE
CRE lifecycle every 30min (unified)     ──► Spike detection + liquidation guard + settlement
CRE anomaly on event (EVM Log trigger)  ──► Decode BenchmarkUpdated, emergency settle if >200bps
Swap expires or liquidates              ──► Return margins to NFT holders, burn tokens
```

### Cross-Chain Relay (CCIP)

```
DeBOR Oracle (Sepolia) → DeBORCCIPSender → Chainlink CCIP → Base Sepolia Receiver
                                                            → Arb Sepolia Receiver
                                                            → OP Sepolia Receiver
```

---

## Deployed Contracts

### Sepolia

| Contract | Address | Verified |
|----------|---------|----------|
| DeBOR-USDC Oracle | [`0x80Be9b18DCb40E216682aA8972b64F93a4716FE6`](https://sepolia.etherscan.io/address/0x80Be9b18DCb40E216682aA8972b64F93a4716FE6) | Yes |
| DeBOR-ETH Oracle | [`0x8D7EBA5Ef17D69b234746fdbB9722EC52135B9A8`](https://sepolia.etherscan.io/address/0x8D7EBA5Ef17D69b234746fdbB9722EC52135B9A8) | Yes |
| DeBOR-BTC Oracle | [`0x1Ee00d2bd54C6200905BB4746bFDFB3eB4Be24fD`](https://sepolia.etherscan.io/address/0x1Ee00d2bd54C6200905BB4746bFDFB3eB4Be24fD) | Yes |
| DeBOR-DAI Oracle | [`0xdF989f502Ba3d9664c4a8B7bA675a0F34990b608`](https://sepolia.etherscan.io/address/0xdF989f502Ba3d9664c4a8B7bA675a0F34990b608) | Yes |
| DeBOR-USDT Oracle | [`0x2F565693410D51Be42c664B566F244EDe7Be772c`](https://sepolia.etherscan.io/address/0x2F565693410D51Be42c664B566F244EDe7Be772c) | Yes |
| DeBORSwap (ERC-721 IRS) | [`0x114b52B58C8DAebe4972D3D9bC3659Ef66f8D291`](https://sepolia.etherscan.io/address/0x114b52B58C8DAebe4972D3D9bC3659Ef66f8D291) | Yes |
| DeBORCCIPSender | [`0xE99c38245EA789E9102Dc23EE28FAd3ed67d2432`](https://sepolia.etherscan.io/address/0xE99c38245EA789E9102Dc23EE28FAd3ed67d2432) | Yes |
| AdaptiveLending (v2) | [`0x47e08484BECbf33c8d25036cc4F46b2CD7799232`](https://eth-sepolia.blockscout.com/address/0x47e08484BECbf33c8d25036cc4F46b2CD7799232) | Yes |
| CRE Forwarder | [`0x15fC6ae953E024d975e77382eEeC56A9101f9F88`](https://sepolia.etherscan.io/address/0x15fC6ae953E024d975e77382eEeC56A9101f9F88) | -- |

### Cross-Chain Receivers (CCIP)

| Chain | Contract | Address |
|-------|----------|---------|
| Base Sepolia | DeBORCCIPReceiver | [`0xf11b0c2c3C23eeBa32AB9a5340C767ccB152fA57`](https://sepolia.basescan.org/address/0xf11b0c2c3C23eeBa32AB9a5340C767ccB152fA57) |
| Arbitrum Sepolia | DeBORCCIPReceiver | [`0xc6C927c77D9BFaFb7b9e003db6D96F3605ba2514`](https://sepolia.arbiscan.io/address/0xc6C927c77D9BFaFb7b9e003db6D96F3605ba2514) |
| Optimism Sepolia | DeBORCCIPReceiver | [`0xd8EcF5D6D77bF2852c5e9313F87f31cc99c38dE9`](https://sepolia-optimism.etherscan.io/address/0xd8EcF5D6D77bF2852c5e9313F87f31cc99c38dE9) |

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
| 7 | HTTP | on-demand | `onHttpTrigger` | On-demand refresh + validation + risk analysis + AI intelligence |
| 8 | Cron | :02/:32 | `onUsdcExtTrigger` | USDC ext merge (4 sources → 14/14) |
| 9 | EVM Log | on event | `onBenchmarkUpdated` | Anomaly detection on BenchmarkUpdated |

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
| [`riskAnalyst.ts`](DeBOR/DeBOR-Workflow/riskAnalyst.ts) | EVMClient.callContract (10 oracle reads), HTTPClient + ConsensusAggregationByFields (TVL for HHI), VaR/CVaR (parametric), HHI concentration index, Basel IRRBB stress tests, composite risk scoring |
| [`aiAnalyst.ts`](DeBOR/DeBOR-Workflow/aiAnalyst.ts) | EVMClient.callContract (5 oracle reads), HTTPClient.sendRequest (Groq LLM POST + SOFR), structured risk classification via LLM |
| [`sofrComparator.ts`](DeBOR/DeBOR-Workflow/sofrComparator.ts) | HTTPClient.sendRequest, ConsensusAggregationByFields (identical + ignore), NY Fed SOFR/EFFR API, market regime classification |
| [`abis.ts`](DeBOR/DeBOR-Workflow/abis.ts) | CHAINLINK_PRICE_FEED_ABI (latestRoundData, decimals) |
| [`config.staging.json`](DeBOR/DeBOR-Workflow/config.staging.json) | 43 protocol sources, 5 oracle addresses, CRE chain selectors |

### Chainlink CCIP (`@chainlink/contracts-ccip`)

| File | Usage |
|------|-------|
| [`DeBORCCIPSender.sol`](contract/src/DeBORCCIPSender.sol) | IRouterClient, Client.EVM2AnyMessage, Client.GenericExtraArgsV2, ccipSend, getFee |
| [`DeBORCCIPReceiver.sol`](contract/src/DeBORCCIPReceiver.sol) | CCIPReceiver, Client.Any2EVMMessage, _ccipReceive |

### CRE ReceiverTemplate (on-chain report verification)

| File | Usage |
|------|-------|
| [`ReceiverTemplate.sol`](contract/src/ReceiverTemplate.sol) | CRE forwarder validation (onReport → _processReport) |
| [`DeBOROracle.sol`](contract/src/DeBOROracle.sol) | Inherits ReceiverTemplate — receives DON-signed benchmark reports |
| [`DeBORSwap.sol`](contract/src/DeBORSwap.sol) | Inherits ReceiverTemplate — receives CRE swap settlement/liquidation actions |

### Chainlink Data Feeds

| Feed | Mainnet Address | Used In |
|------|-----------------|---------|
| ETH/USD | `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419` | [`rateReader.ts`](DeBOR/DeBOR-Workflow/rateReader.ts) |
| BTC/USD | `0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c` | [`rateReader.ts`](DeBOR/DeBOR-Workflow/rateReader.ts) |
| USDC/USD | `0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6` | [`rateReader.ts`](DeBOR/DeBOR-Workflow/rateReader.ts) |

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

`CronCapability` · `HTTPCapability` · `HTTPClient` · `ConfidentialHTTPClient` · `EVMClient`

### Runtime Methods (6)

`log()` · `now()` · `config` · `report()` · `getSecret()` · `runInNodeMode()`

### Consensus Strategies (9/9)

**Top-level (4/4):**
`consensusMedianAggregation` · `consensusIdenticalAggregation` · `consensusCommonPrefixAggregation` · `consensusCommonSuffixAggregation`

**Field-level (5/5):**
`median()` · `identical()` · `commonPrefix()` · `commonSuffix()` · `ignore()` — composed via `ConsensusAggregationByFields` + `.withDefault()`

### SDK Utilities (12)

`getNetwork` · `encodeCallMsg` · `bytesToHex` · `hexToBase64` · `prepareReportRequest` · `safeJsonStringify` · `isChainSelectorSupported` · `UInt64` · `bigintToProtoBigInt` · `protoBigIntToBigint` · `LAST_FINALIZED_BLOCK_NUMBER` · `LATEST_BLOCK_NUMBER`

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

## Benchmark Metrics

| Metric | Unit | Description |
|--------|------|-------------|
| `deborRate` | bps | TVL-weighted average borrow rate across all sources |
| `deborSupply` | bps | TVL-weighted average supply rate across all sources |
| `deborSpread` | bps | Borrow-supply gap (risk indicator) |
| `deborVol` | scaled | Cross-protocol rate variance (disagreement metric) |
| `deborTerm7d` | bps | 7-day rolling average (336-entry ring buffer) |
| `numSources` | count | Number of sources that contributed to this update |
| `sourcesConfigured` | count | Total configured sources for this asset |

### How Rates Are Computed

```
DeBOR_RATE = Sum(borrowBps_i * tvlUsd_i) / Sum(tvlUsd_i)
```

Each protocol's rate is weighted by its total value locked. A $27B protocol (Aave) has more influence than a $1B protocol. This mirrors how SOFR weights by transaction volume — the benchmark reflects where capital actually sits.

All arithmetic uses `bigint` — no floating point, fully deterministic across DON nodes.

---

## Interest Rate Swap

The first decentralized interest rate derivative. One party pays a fixed rate, the other pays the DeBOR floating rate. Settlement every 24 hours. Positions represented as transferable ERC-721 NFTs.

| TradFi | DeBORSwap |
|--------|-----------|
| SOFR benchmark | DeBOR Oracle (on-chain, transparent) |
| CME clearinghouse | Smart contract (trustless) |
| $10M minimum | Any amount (0.01 ETH+) |
| Quarterly settlement | Daily settlement (CRE automated) |
| Phone call to dealer | `createSwap()` (instant, 24/7) |
| Paper confirmation | ERC-721 NFT position |

CRE automates the entire lifecycle: daily settlement, hourly liquidation monitoring, and 30-minute rate spike detection.

---

## Project Structure

```
DeBOR/
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
│       ├── httpValidator.ts        # HTTP validation + cross-check layer (8 steps)
│       ├── riskAnalyst.ts         # Risk engine: VaR/CVaR, HHI, Basel stress tests
│       ├── aiAnalyst.ts           # AI market intelligence via Groq LLM
│       ├── sofrComparator.ts       # SOFR/EFFR comparison (NY Fed API)
│       ├── types.ts                # TypeScript types
│       ├── abis.ts                 # Contract ABIs (Aave, Compound, Morpho, Chainlink)
│       └── config.staging.json     # 43 protocol sources + oracle addresses
├── contract/                       # Foundry smart contracts
│   ├── src/
│   │   ├── DeBOROracle.sol         # Benchmark oracle (ring buffer, 8 metrics)
│   │   ├── DeBORSwap.sol           # Interest rate swap (ERC-721 positions)
│   │   ├── DeBORCCIPSender.sol     # CCIP cross-chain relay (3 destinations)
│   │   ├── DeBORCCIPReceiver.sol   # CCIP receiver (Base + Arb + OP Sepolia)
│   │   ├── DeBORConsumer.sol       # AdaptiveLending demo consumer
│   │   └── ReceiverTemplate.sol    # CRE forwarder validation base
│   ├── test/                       # 80 tests (16 Oracle + 21 CCIP + 41 Swap + 2 Counter)
│   └── script/                     # Deployment scripts
├── RUN.md                          # How to broadcast real rates to Sepolia
├── CRE_UTILIZE.md                  # CRE SDK utilization report (100% coverage)
├── BACKUP.md                       # Backup track strategy & roadmap
└── TENDERLY.md                     # Tenderly Virtual TestNets integration guide
```

---

## Quick Start

### Prerequisites

- [CRE CLI](https://github.com/smartcontractkit/chainlink-cre) installed
- [Foundry](https://book.getfoundry.sh/) installed
- Node.js 18+

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

# HTTP on-demand refresh
cre workflow simulate ./DeBOR-Workflow --non-interactive --trigger-index 7 \
  --http-payload '{"asset":"USDC"}'

# HTTP validation layer (8-step cross-check + SOFR cross-reference)
cre workflow simulate ./DeBOR-Workflow --non-interactive --trigger-index 7 \
  --http-payload '{"action":"validate"}'

# SOFR/EFFR comparison (DeFi vs TradFi benchmark analysis)
cre workflow simulate ./DeBOR-Workflow --non-interactive --trigger-index 7 \
  --http-payload '{"action":"compare"}'

# Risk & compliance analysis (VaR, CVaR, HHI, Basel stress tests)
cre workflow simulate ./DeBOR-Workflow --non-interactive --trigger-index 7 \
  --http-payload '{"action":"risk"}'

# AI market intelligence (LLM-powered risk assessment via Groq)
cre workflow simulate ./DeBOR-Workflow --non-interactive --trigger-index 7 \
  --http-payload '{"action":"analyze"}'

# EVM Log anomaly detector (requires tx hash)
cre workflow simulate ./DeBOR-Workflow --non-interactive --trigger-index 9 \
  --evm-tx-hash <TX_HASH> --evm-event-index 0
```

### Read Oracle On-Chain

```bash
# Read full benchmark (rate, supply, spread, vol, term7d, timestamp, sources, configured)
cast call 0x80Be9b18DCb40E216682aA8972b64F93a4716FE6 \
  "getFullBenchmark()(uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256)" \
  --rpc-url https://sepolia.infura.io/v3/<YOUR_KEY>

# Read individual metrics
cast call 0x80Be9b18DCb40E216682aA8972b64F93a4716FE6 "getRate()(uint256)" --rpc-url <RPC>
cast call 0x80Be9b18DCb40E216682aA8972b64F93a4716FE6 "numSources()(uint256)" --rpc-url <RPC>
```

### Run Tests

```bash
cd contract && forge test -vvv
# 80 tests passing (16 Oracle + 21 CCIP + 41 Swap + 2 Counter)
```

### Broadcast Real Rates to Sepolia

Use the native CRE `--broadcast` flag to write real mainnet rates on-chain:

```bash
cd DeBOR

# Broadcast all 5 assets + USDC extended merge
cre workflow simulate ./DeBOR-Workflow --target staging-settings --non-interactive --trigger-index 0 --broadcast   # USDC core
cre workflow simulate ./DeBOR-Workflow --target staging-settings --non-interactive --trigger-index 1 --broadcast   # ETH
cre workflow simulate ./DeBOR-Workflow --target staging-settings --non-interactive --trigger-index 2 --broadcast   # BTC
cre workflow simulate ./DeBOR-Workflow --target staging-settings --non-interactive --trigger-index 3 --broadcast   # DAI
cre workflow simulate ./DeBOR-Workflow --target staging-settings --non-interactive --trigger-index 4 --broadcast   # USDT
cre workflow simulate ./DeBOR-Workflow --target staging-settings --non-interactive --trigger-index 8 --broadcast   # USDC ext (14/14)
```

Without `--broadcast`, `writeReport` returns a mock tx hash (`0x000...`). With `--broadcast`, real transactions are submitted to Sepolia. All `callContract` reads are always real mainnet data regardless.

---

## Key Design Decisions

1. **Read Mainnet, Write Testnet** — Real production rates from live DeFi protocols, safe testnet writes for development
2. **Separate handler per asset** — Each asset gets its own 15 EVM call budget (CRE hard limit)
3. **Multi-handler merge** — USDC splits across 2 handlers to achieve 14/14 sources within the 15-call limit
4. **Staggered schedules** — Prevents trigger contention (USDC :00, ETH :10, BTC :20, etc.)
5. **TVL-weighted** — Larger protocols have proportional influence on the benchmark, like SOFR weights by volume
6. **ERC-721 swap positions** — Tradeable NFTs, CRE settlements go to current `ownerOf()`
7. **CRE as clearinghouse** — DON autonomously settles, monitors, and liquidates swaps (unified lifecycle handler)
8. **3 trigger types** — Cron (scheduled), HTTP (on-demand), EVM Log (event-driven) — maximum CRE trigger diversity
9. **Config ordering** — Cheap sources first (Aave=1 call) to maximize sources within EVM call budget

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
| Smart Contracts | 12 deployed + verified |
| CRE Handlers | 10 (6 benchmark + 1 swap lifecycle + 1 pre-flight + 1 HTTP + 1 EVM Log) |
| HTTP Actions | 5 (asset refresh, validate, compare, risk analysis, AI intelligence) |
| External APIs | 3 (DeFiLlama TVL, NY Fed SOFR/EFFR, Groq LLM) |
| CRE Capabilities | 30+ |
| Trigger Types | 3 (Cron + HTTP + EVM Log) |
| Consensus Strategies | 9 (4 top-level + 5 field-level) |
| Tests | 80 |

---

## Hackathon

**Convergence: A Chainlink Hackathon**

| Track | Target |
|-------|--------|
| **DeFi & Tokenization** | Primary ($12K / $8K) |

---

## License

MIT