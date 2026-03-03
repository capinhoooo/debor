# DeBOR CRE Workflow

The Chainlink CRE (Compute Runtime Environment) workflow that powers DeBOR. This workflow reads real-time lending rates from 43 mainnet sources across 6 protocols and 6 chains, computes TVL-weighted benchmark rates, and writes signed reports to on-chain oracles on Sepolia.

---

## 10 Handlers (3 Trigger Types)

| Index | Handler | Trigger | Schedule | File |
|-------|---------|---------|----------|------|
| 0 | USDC Core Benchmark | Cron | `:00, :30` every hour | [`main.ts`](main.ts) |
| 1 | ETH Benchmark | Cron | `:10, :40` every hour | [`main.ts`](main.ts) |
| 2 | BTC Benchmark | Cron | `:20, :50` every hour | [`main.ts`](main.ts) |
| 3 | DAI Benchmark | Cron | `:15, :45` every hour | [`main.ts`](main.ts) |
| 4 | USDT Benchmark | Cron | `:18, :48` every hour | [`main.ts`](main.ts) |
| 5 | Swap Lifecycle Manager | Cron | `:05, :35` every hour | [`swapManager.ts`](swapManager.ts) |
| 6 | Pre-flight + Prices | Cron | `:25, :55` every hour | [`main.ts`](main.ts) |
| 7 | HTTP On-Demand (5 actions) | HTTP | On request | [`main.ts`](main.ts) |
| 8 | USDC Ext Merge | Cron | `:02, :32` every hour | [`main.ts`](main.ts) |
| 9 | Anomaly Detector | EVM Log | BenchmarkUpdated event | [`swapManager.ts`](swapManager.ts) |

---

## File Descriptions

### [`main.ts`](main.ts) — Entry Point & Handler Registration

The workflow entry point. Registers all 10 handlers across 3 trigger types, and contains the core benchmark update logic plus the USDC multi-handler merge.

**Chainlink CRE usage:**
- `Runner.newRunner()` — workflow initialization with typed config schema (zod)
- `CronCapability.trigger()` — 8 cron-scheduled handlers
- `HTTPCapability.trigger()` — HTTP trigger for on-demand refresh + validation
- `EVMClient.logTrigger()` — EVM event trigger on BenchmarkUpdated (anomaly detection)
- `EVMClient.writeReport()` — writes signed reports to Sepolia oracles
- `EVMClient.callContract()` — reads oracle state via `getFullBenchmark()` (USDC ext handler)
- `runtime.report()` + `prepareReportRequest()` — generates DON-signed reports
- `runtime.getSecret()` — reads VaultDON secret to gate ConfidentialHTTPClient
- `runtime.runInNodeMode()` + `consensusMedianAggregation()` — each DON node reads its local clock, median consensus produces manipulation-resistant timestamp
- `safeJsonStringify()` — bigint-safe JSON serialization
- `getNetwork()` — resolves chain selector names to network objects
- `LATEST_BLOCK_NUMBER` — freshest data for dry-run rate guard validation

**Key functions:**
- `runAssetBenchmark(runtime, payload, asset)` — full pipeline for one asset class
- `onUsdcExtTrigger(runtime, payload)` — reads 4 remaining USDC sources, merges with core oracle data for 14/14
- `parseTriggerTimestamp(payload)` — safely extracts timestamp from CronPayload
- `onHttpTrigger(runtime, payload)` — parses HTTP JSON input, routes to asset benchmark or HTTP validation
- `onPreflightCheck(runtime, payload)` — health check + Chainlink prices + confidential TVL + consensus timestamp
- `initWorkflow(config)` — returns array of 10 handler registrations (8 Cron + 1 HTTP + 1 EVM Log)

### [`rateReader.ts`](rateReader.ts) — Protocol Rate Reads + Chainlink Price Feeds

Reads borrow and supply rates from 6 DeFi protocols across 6 mainnet chains, plus 3 Chainlink Price Feeds.

**Chainlink CRE usage:**
- `EVMClient.callContract()` — 43 cross-chain EVM reads per full benchmark cycle
- `encodeCallMsg()` — encodes from/to/data for EVM calls
- `getNetwork()` — resolves 6 chain selectors
- `isChainSelectorSupported()` — validates chain availability before reads
- `bytesToHex()` — converts raw call results for viem decoding
- `LAST_FINALIZED_BLOCK_NUMBER` — reads from finalized blocks for consistency

**Chainlink Data Feeds (Ethereum Mainnet):**
- ETH/USD: `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419`
- BTC/USD: `0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c`
- USDC/USD: `0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6`

**Protocol readers:**
- `readAaveRates()` — Aave V3 / Spark `getReserveData(asset)` → RAY to bps conversion [1 call]
- `readCompoundRates()` — Compound V3 `getUtilization()` → `getBorrowRate(util)` → per-sec WAD to bps [3 calls]
- `readMorphoRates()` — Morpho Blue `idToMarketParams` → `market` → `IRM.borrowRateView` → per-sec WAD to bps [3 calls]
- `readCtokenRates()` — Moonwell / Benqi `supplyRatePerTimestamp` + `borrowRatePerTimestamp` → per-sec WAD to bps [2 calls]
- `readChainlinkPrice()` — `latestRoundData()` on Chainlink feeds (8 decimal answer)
- `readAllPrices()` — reads ETH/USD, BTC/USD, USDC/USD with de-peg detection

**Rate sources (43 total):**

| Protocol | Type | Calls | USDC | ETH | BTC | DAI | USDT |
|----------|------|-------|------|-----|-----|-----|------|
| Aave V3 | aave | 1 | ETH, Base, Arb, OP, AVAX, Polygon | ETH, Base, Arb, OP, AVAX, Polygon | ETH, Arb, OP, AVAX | ETH, Arb, OP, AVAX, Polygon | ETH, Arb, OP, AVAX, Polygon |
| Spark | aave | 1 | ETH | ETH | -- | ETH | -- |
| Compound V3 | compound | 3 | ETH, Base, Arb | ETH | -- | -- | -- |
| Morpho Blue | morpho | 3 | ETH | -- | -- | -- | -- |
| Moonwell | ctoken | 2 | Base, OP | Base, OP | -- | OP | OP |
| Benqi | ctoken | 2 | AVAX | -- | AVAX | AVAX | -- |

### [`tvlFetcher.ts`](tvlFetcher.ts) — TVL Weights with DON Consensus

Fetches protocol TVL from DeFiLlama using Chainlink CRE's HTTP consensus pattern.

**Chainlink CRE usage:**
- `HTTPClient.sendRequest()` — curried HTTP request pattern with DON consensus
- `ConsensusAggregationByFields()` — field-level consensus strategy
  - `median()` — DON nodes independently fetch TVL, median eliminates outliers
  - `identical()` — protocol slug must match identically across all nodes
  - `ignore()` — skip consensus on node-local data (e.g. timestamps)
  - `.withDefault()` — fallback values when consensus fails
- `text()` — extracts response body as string
- `ok()` — validates HTTP 200-299 status

**Flow:**
1. Each DON node independently fetches `https://api.llama.fi/tvl/{slug}`
2. Nodes report their results
3. Consensus: median of TVL values, identical slug verification
4. Result: manipulation-resistant TVL weight for benchmark computation

### [`benchmarkEngine.ts`](benchmarkEngine.ts) — Benchmark Computation (Pure Logic)

Pure computation module — no Chainlink SDK dependencies. Computes the DeBOR metrics from weighted rate inputs.

**Chainlink CRE usage:**
- `safeJsonStringify()` — bigint-safe JSON serialization for metrics logging
- `UInt64()` — type-safe arithmetic with overflow checks

**Computation:**
- `mergeRatesWithTVL()` — joins rate data with TVL weights by protocol
- `computeBenchmark()` — produces:
  - `deborRate`: TVL-weighted average borrow rate (bps)
  - `deborSupply`: TVL-weighted average supply rate (bps)
  - `deborSpread`: rate - supply (bps)
  - `deborVol`: cross-protocol variance x 1000
  - `deborTerm7d`: 7-day rolling average from historical ring buffer
- `computeRateDeviation()` — dry-run rate guard (deviation threshold detection)

### [`swapManager.ts`](swapManager.ts) — Interest Rate Swap Lifecycle

CRE-native swap lifecycle manager. Exports a unified `onSwapLifecycle` handler (settlement + liquidation + spike detection) and `onBenchmarkUpdated` anomaly detector (EVM Log trigger).

**Chainlink CRE usage:**
- `EVMClient.callContract()` — reads swap state (`getSettleableSwaps`, `getExpiredSwaps`, `getAtRiskSwaps`, `getRate`, `getHistoricalRate`)
- `EVMClient.writeReport()` — writes batch settle/close actions to DeBORSwap contract
- `EVMClient.filterLogs()` — queries historical BenchmarkUpdated events with bounded block range (`fromBlock`/`toBlock` via `bigintToProtoBigInt`)
- `EVMClient.headerByNumber()` — reads latest block to compute filterLogs window
- `EVMClient.getTransactionReceipt()` — verifies write transaction was mined (status, gasUsed, blockNumber, log count)
- `EVMClient.getTransactionByHash()` — fetches originating tx details (forensic analysis)
- `prepareReportRequest()` — encodes swap action reports
- `encodeCallMsg()` — EVM call encoding for contract reads
- `protoBigIntToBigint()` / `bigintToProtoBigInt()` — protobuf BigInt conversions
- `hexToBase64()` / `bytesToHex()` — data format conversions

**Exported handlers:**
- `onSwapLifecycle` — unified lifecycle manager (every 30 min): rate spike detection with filterLogs trend analysis, liquidation guard, settlement + closure
- `onBenchmarkUpdated` — EVM Log trigger anomaly detector: decodes BenchmarkUpdated event, fetches tx via getTransactionByHash, compares with history, emergency settles if >200bps change

**Also available (individual handlers preserved):**
- `onSettleTrigger` — daily auto-settler (original, before merge)
- `onLiquidationGuard` — hourly margin monitor (original, before merge)
- `onRateSpikeCheck` — rate spike detector (original, before merge)

**Trend analysis (`analyzeRateTrend`):**
1. `headerByNumber(LATEST_BLOCK_NUMBER)` → get current block
2. `filterLogs(fromBlock: current-1000, toBlock: current)` → last ~3.3 hours of events
3. Decode BenchmarkUpdated event data → extract rate series
4. Compute velocity (bps/period) and acceleration (bps/period^2)
5. Classify direction: RISING / FALLING / STABLE

### [`httpValidator.ts`](httpValidator.ts) — HTTP Validation & Cross-Check Layer

HTTP-triggered validation pipeline that cross-checks oracle data against external sources including SOFR from the NY Fed.

**Chainlink CRE usage:**
- `EVMClient.callContract()` — reads all 5 oracle benchmarks for validation
- CRE consensus aggregation for DON-agreed validation results (4 top-level + 5 field-level)
- `HTTPClient.sendRequest()` — DeFiLlama TVL cross-check + SOFR cross-reference
- `runtime.report()` + `HTTPClient.sendReport()` — DON-signed validation report distribution
- Sanity checks: rate bounds, stablecoin spread limits, source count minimums
- SOFR cross-reference: compares stablecoin DeBOR rates against TradFi benchmark

**8-step validation:**
1. Oracle reads — current benchmark for all 5 assets
2. Sanity checks — rate bounds (0-5000bps), source minimums
3. Stablecoin spread — USDC/DAI/USDT spread should be <200bps
4. TVL cross-check — DeFiLlama protocol TVL validation
5. Historical consistency — rate vs 7d average deviation
6. DON consensus — 4 top-level + 5 field-level strategies
7. DON-signed report — sendReport distribution to webhook
8. SOFR cross-reference — stablecoin rates vs NY Fed SOFR (flags >50bps below or >200bps dislocation)

### [`sofrComparator.ts`](sofrComparator.ts) — SOFR/EFFR TradFi Comparison

Compares DeBOR rates against real TradFi benchmark rates from the Federal Reserve Bank of New York. Provides the "DeFi vs TradFi" narrative that makes DeBOR meaningful to institutional users.

**Chainlink CRE usage:**
- `HTTPClient.sendRequest()` — fetches SOFR and EFFR from NY Fed Markets API with DON consensus
- `ConsensusAggregationByFields()` — `identical()` on rate/date fields (all DON nodes see same Fed data), `ignore()` on fetchedAt (node-local)
- `.withDefault()` — graceful fallback when API is unavailable
- `EVMClient.callContract()` — reads 5 oracle rates for comparison (in compare mode)

**External APIs:**
- SOFR: `https://markets.newyorkfed.org/api/rates/secured/sofr/last/1.json` (free, no auth)
- EFFR: `https://markets.newyorkfed.org/api/rates/unsecured/effr/last/1.json` (free, no auth)

**Market regime classification:**
- `CONVERGED` (<10bps) — DeFi and TradFi rates aligned
- `NORMAL` (10-50bps) — typical DeFi premium
- `DIVERGED` (50-200bps) — significant DeFi-TradFi gap
- `DISLOCATED` (>200bps) — market stress or manipulation

**Exported functions:**
- `fetchSOFR(runtime)` — fetches SOFR rate with DON consensus
- `fetchEFFR(runtime)` — fetches EFFR (Fed Funds Rate) with DON consensus
- `classifyRegime(defiPremiumBps)` — returns market regime classification
- `runSOFRComparison(runtime)` — full comparison: reads 5 oracle rates + SOFR + EFFR, computes per-asset DeFi premium
- `sofrCrossReference(runtime, oracleRates)` — lightweight SOFR-only check for the validate action (1 HTTP call)

**HTTP budget:**
- Compare action: 2 HTTP calls (SOFR + EFFR) — runs as standalone action
- Validate action: 1 HTTP call (SOFR only) — fits within 5 HTTP limit (3 TVL + 1 sendReport + 1 SOFR)

### [`riskAnalyst.ts`](riskAnalyst.ts) — Risk & Compliance Engine

On-demand risk analysis triggered via `action="risk"`. Computes institutional-grade risk metrics from live oracle data.

**Chainlink CRE usage:**
- `EVMClient.callContract()` — reads all 5 oracle benchmarks (5 calls) + 5 historical rates for VaR (5 calls) = 10 EVM calls
- `HTTPClient` + `ConsensusAggregationByFields` — fetches protocol TVL for HHI computation (up to 5 HTTP calls)
- `fetchSOFR(runtime)` — SOFR comparison for TradFi spread (1 HTTP call via sofrComparator)

**Risk metrics computed:**
- **VaR/CVaR** (parametric): 95% and 99% Value-at-Risk and Conditional VaR from realized rate volatility
- **HHI** (Herfindahl-Hirschman Index): Source concentration from TVL weights (DOJ merger guideline thresholds)
- **Basel IRRBB stress tests** (BCBS 368): Parallel up/down (+/-200bps), short rate shocks (+/-300bps), source failure, TVL collapse
- **Composite risk level**: Weighted scoring across VaR, HHI, source uptime, SOFR spread, cross-protocol vol → LOW/MEDIUM/HIGH/CRITICAL
- **Market regime**: CONVERGED/NORMAL/DIVERGED/DISLOCATED based on DeFi-TradFi spread

**Resource budget:** 10 EVM calls + 5 HTTP calls (at CRE limits)

### [`aiAnalyst.ts`](aiAnalyst.ts) — AI Market Intelligence

On-demand LLM-powered market risk assessment triggered via `action="analyze"`. Uses Groq API with `llama-3.3-70b-versatile` model.

**Chainlink CRE usage:**
- `EVMClient.callContract()` — reads all 5 oracle benchmarks via `getFullBenchmark()` (5 EVM calls)
- `HTTPClient.sendRequest()` — POST to Groq API for LLM inference (1 HTTP call, base64-encoded body, deprecated `headers` map)
- `fetchSOFR(runtime)` — SOFR for TradFi context in the LLM prompt (1 HTTP call)

**LLM prompt includes:**
- Benchmark rates, spreads, cross-protocol volatility for all 5 assets
- Source health (active/configured)
- SOFR comparison and DeFi premium
- 7-day trend direction

**Structured output (7 fields):**
- `riskLevel`: LOW/MEDIUM/HIGH/CRITICAL
- `riskScore`: 0-100
- `anomalyDetected`: boolean
- `rateDirection`: RISING/FALLING/STABLE
- `spreadHealth`: NORMAL/COMPRESSED/INVERTED
- `explanation`: Free-text reason (<150 chars)
- `analyzedAt`: timestamp

**Resource budget:** 5 EVM calls + 2 HTTP calls (Groq + SOFR)

**Technical notes:**
- Uses `json_object` response format (not `json_schema` — unsupported by llama-3.3-70b)
- Handles both camelCase and snake_case field names from LLM output
- Falls back to safe defaults if LLM is unavailable
- API key passed via `runtime.config.groqApiKey` (not `getSecret()` — unavailable in HTTP trigger context)

### [`preflightCheck.ts`](preflightCheck.ts) — Health Monitoring

Pre-flight health checks using 5 CRE capabilities. Validates chain liveness and resource availability before benchmark updates.

**Chainlink CRE usage:**
- `EVMClient.headerByNumber(LATEST_BLOCK_NUMBER)` — chain liveness check (block number + timestamp)
- `EVMClient.balanceAt()` x 2 — forwarder contract balance + swap contract balance
- `EVMClient.estimateGas()` — dry-run gas estimation for oracle write (`getRate` call)
- `runtime.now()` x 2 — DON-trusted clock for execution time measurement
- `encodeCallMsg()` — EVM call encoding for estimateGas
- `protoBigIntToBigint()` — block number / balance conversion
- `hexToBase64()` — address encoding for balanceAt
- `getNetwork()` — target chain resolution

**Checks performed:**
1. Block staleness (>5 min = warning)
2. Forwarder ETH balance (<0.01 ETH = warning)
3. Swap contract ETH balance
4. Gas estimation dry-run
5. Total execution time measurement

### [`confidentialFetcher.ts`](confidentialFetcher.ts) — TEE-Based Confidential Fetch

Demonstrates CRE's Trusted Execution Environment capability. API credentials are stored in VaultDON and injected at runtime — node operators never see them.

**Chainlink CRE usage:**
- `ConfidentialHTTPClient.sendRequest()` — TEE-protected HTTP with secret injection
  - `vaultDonSecrets: [{ key: 'PREMIUM_API_KEY', namespace: 'workflow' }]`
  - Headers: `X-Api-Key: {{PREMIUM_API_KEY}}` (template replaced by VaultDON)
- `text()` — response body extraction
- `ok()` — status code validation

**Gating:** Only invoked when `runtime.getSecret('PREMIUM_API_KEY')` returns a value. Falls back to regular HTTPClient if not configured.

### [`types.ts`](types.ts) — Type Definitions

TypeScript types shared across all modules:
- `AssetClass`: `'USDC' | 'ETH' | 'BTC' | 'DAI' | 'USDT'`
- `ProtocolRateConfig`: protocol source definition (chain, contract, asset, rateType)
- `NormalizedRate`: supply/borrow rates in bps
- `TVLWeight`: protocol TVL in USD
- `WeightedRate`: rate + TVL weight (for benchmark computation)
- `DeBORMetrics`: 8-field benchmark output (rate, supply, spread, vol, term7d, numSources, sourcesConfigured)
- `PriceContext`: Chainlink price feed results (ETH/USD, BTC/USD, USDC/USD)
- `Config`: workflow configuration schema (incl. optional sofrApiBase, sofrEndpoint, effrEndpoint)
- `SOFRData`: SOFR rate data (rate, rateBps, date, volumeBillions, percentiles)
- `EFFRData`: EFFR rate data (rate, rateBps, date, target range)
- `MarketRegime`: `'CONVERGED' | 'NORMAL' | 'DIVERGED' | 'DISLOCATED'`
- `AssetComparison`: per-asset DeFi vs TradFi comparison
- `SOFRComparisonResult`: full comparison output

### [`abis.ts`](abis.ts) — Contract ABIs

ABI definitions for all on-chain interactions:
- `AAVE_POOL_ABI` — `getReserveData(asset)` (Aave V3 + Spark)
- `COMPOUND_COMET_ABI` — `getUtilization()`, `getSupplyRate(util)`, `getBorrowRate(util)`
- `MORPHO_BLUE_ABI` — `idToMarketParams(id)`, `market(id)`
- `MORPHO_IRM_ABI` — `borrowRateView(params, market)`
- `CTOKEN_ABI` — `supplyRatePerTimestamp()`, `borrowRatePerTimestamp()` (Moonwell, Benqi)
- `DEBOR_SWAP_ABI` — `getSettleableSwaps`, `getExpiredSwaps`, `getAtRiskSwaps`, `getSwapCount`
- `DEBOR_ORACLE_READ_ABI` — `getRate()`, `getFullBenchmark()`, `getHistoricalRate(periodsBack)`
- `CHAINLINK_PRICE_FEED_ABI` — `latestRoundData()`, `decimals()`
- `DEBOR_ORACLE_ABI` — `onReport(metadata, report)` (CRE write target)

### [`config.staging.json`](config.staging.json) — Source Configuration

43 protocol rate sources across 6 chains + 5 oracle deployment addresses + NY Fed API config:
- 14 USDC sources (Aave x6, Compound x3, Spark x1, Morpho x1, Moonwell x2, Benqi x1)
- 10 ETH sources (Aave x6, Compound x1, Spark x1, Moonwell x2)
- 5 BTC sources (Aave x4, Benqi x1)
- 8 DAI sources (Aave x5, Spark x1, Moonwell x1, Benqi x1)
- 6 USDT sources (Aave x5, Moonwell x1)
- Target: Sepolia (`ethereum-testnet-sepolia`)
- Swap contract: `0x114b52B58C8DAebe4972D3D9bC3659Ef66f8D291`

### [`workflow.yaml`](workflow.yaml) — CRE Workflow Settings

Workflow name, entry point, config path, and target settings for `cre workflow simulate`.

---

## How to Simulate

```bash
# From the DeBOR/ project root (parent of this directory)
cd /path/to/DeBOR

# Install dependencies
cd DeBOR-Workflow && bun install && cd ..

# Simulate any handler by trigger index (0-9)
cre workflow simulate ./DeBOR-Workflow --non-interactive --trigger-index 0    # USDC core (10 sources)
cre workflow simulate ./DeBOR-Workflow --non-interactive --trigger-index 1    # ETH (10 sources)
cre workflow simulate ./DeBOR-Workflow --non-interactive --trigger-index 2    # BTC (5 sources)
cre workflow simulate ./DeBOR-Workflow --non-interactive --trigger-index 3    # DAI (8 sources)
cre workflow simulate ./DeBOR-Workflow --non-interactive --trigger-index 4    # USDT (6 sources)
cre workflow simulate ./DeBOR-Workflow --non-interactive --trigger-index 5    # Swap lifecycle manager
cre workflow simulate ./DeBOR-Workflow --non-interactive --trigger-index 6    # Pre-flight + prices
cre workflow simulate ./DeBOR-Workflow --non-interactive --trigger-index 7 \
  --http-payload '{"asset":"USDC"}'                                  # HTTP trigger
cre workflow simulate ./DeBOR-Workflow --non-interactive --trigger-index 7 \
  --http-payload '{"action":"validate"}'                             # Validation + SOFR cross-ref
cre workflow simulate ./DeBOR-Workflow --non-interactive --trigger-index 7 \
  --http-payload '{"action":"compare"}'                              # SOFR/EFFR comparison
cre workflow simulate ./DeBOR-Workflow --non-interactive --trigger-index 7 \
  --http-payload '{"action":"risk"}'                                 # Risk analysis (VaR/CVaR/HHI/Basel)
cre workflow simulate ./DeBOR-Workflow --non-interactive --trigger-index 7 \
  --http-payload '{"action":"analyze"}'                              # AI market intelligence (Groq LLM)
cre workflow simulate ./DeBOR-Workflow --non-interactive --trigger-index 8    # USDC ext merge (14/14)
cre workflow simulate ./DeBOR-Workflow --non-interactive --trigger-index 9 \
  --evm-tx-hash <TX_HASH> --evm-event-index 0                       # EVM Log trigger
```

---

## CRE Capability Summary

| Category | Count | Details |
|----------|-------|---------|
| Trigger types | 3 | Cron, HTTP, EVM Log |
| EVMClient methods | 9/9 | callContract, writeReport, filterLogs, headerByNumber, balanceAt, estimateGas, logTrigger, getTransactionReceipt, getTransactionByHash |
| Capability classes | 5 | CronCapability, HTTPCapability, HTTPClient, ConfidentialHTTPClient, EVMClient |
| Runtime methods | 6 | log, now, config, report, getSecret, runInNodeMode |
| Consensus strategies | 9/9 | **Top-level (4):** consensusMedianAggregation, consensusIdenticalAggregation, consensusCommonPrefixAggregation, consensusCommonSuffixAggregation · **Field-level (5):** median, identical, commonPrefix, commonSuffix, ignore — via ConsensusAggregationByFields + .withDefault() |
| SDK utilities | 12 | getNetwork, encodeCallMsg, bytesToHex, hexToBase64, prepareReportRequest, safeJsonStringify, isChainSelectorSupported, UInt64, bigintToProtoBigInt, protoBigIntToBigint, LAST_FINALIZED_BLOCK_NUMBER, LATEST_BLOCK_NUMBER |
| Handlers | 10 | 8 cron + 1 HTTP + 1 EVM Log |
| **Total capabilities** | **30+** | All meaningful CRE SDK features utilized |

---

## Broadcast Real Rates to Sepolia

Add `--target staging-settings --broadcast` to submit real transactions on-chain:

```bash
# From the debor/ project root (parent of this directory)
cd /path/to/DeBOR

cre workflow simulate ./DeBOR-Workflow --target staging-settings --non-interactive --trigger-index 0 --broadcast   # USDC core
cre workflow simulate ./DeBOR-Workflow --target staging-settings --non-interactive --trigger-index 1 --broadcast   # ETH
cre workflow simulate ./DeBOR-Workflow --target staging-settings --non-interactive --trigger-index 2 --broadcast   # BTC
cre workflow simulate ./DeBOR-Workflow --target staging-settings --non-interactive --trigger-index 3 --broadcast   # DAI
cre workflow simulate ./DeBOR-Workflow --target staging-settings --non-interactive --trigger-index 4 --broadcast   # USDT
cre workflow simulate ./DeBOR-Workflow --target staging-settings --non-interactive --trigger-index 8 --broadcast   # USDC ext (14/14)
```

Run trigger 8 (USDC ext) AFTER trigger 0 (USDC core) — it merges core + extended sources into 14/14.

Without `--broadcast`, `writeReport` returns mock tx hash (`0x000...`). With `--broadcast`, real transactions are submitted to Sepolia via the deployer wallet. All `callContract` reads are always real mainnet data regardless.

---

## Architecture

```
┌─────────────────────────────── CRE Workflow Engine ────────────────────────────────┐
│                                                                                     │
│  ┌─ Cron Triggers (0-6, 8) ──────────────────────────────────────────────────┐     │
│  │ main.ts ─► rateReader.ts ─► tvlFetcher.ts ─► benchmarkEngine.ts          │     │
│  │     │          │                  │                    │                   │     │
│  │     │     43 EVM reads       DeFiLlama API      TVL-weighted avg          │     │
│  │     │     (6 chains)         (DON consensus)     (bigint math)            │     │
│  │     │                                                                     │     │
│  │     ├─► swapManager.ts  (settle + liquidate + spike detect)               │     │
│  │     ├─► preflightCheck.ts (liveness, balances, gas estimation)            │     │
│  │     └─► confidentialFetcher.ts (TEE + VaultDON secrets)                   │     │
│  └───────────────────────────────────────────────────────────────────────────┘     │
│                                                                                     │
│  ┌─ HTTP Trigger (7) ── 5 Actions ──────────────────────────────────────────┐     │
│  │  "asset"    ─► rateReader + tvlFetcher + benchmarkEngine (single asset)  │     │
│  │  "validate" ─► httpValidator.ts (8-step cross-check + SOFR)              │     │
│  │  "compare"  ─► sofrComparator.ts (DeFi vs TradFi: SOFR + EFFR)          │     │
│  │  "risk"     ─► riskAnalyst.ts (VaR/CVaR, HHI, Basel stress tests)       │     │
│  │  "analyze"  ─► aiAnalyst.ts (Groq LLM market intelligence)              │     │
│  └──────────────────────────────────────────────────────────────────────────┘     │
│                                                                                     │
│  ┌─ EVM Log Trigger (9) ────────────────────────────────────────────────────┐     │
│  │  BenchmarkUpdated event ─► swapManager.onBenchmarkUpdated (anomaly)      │     │
│  └──────────────────────────────────────────────────────────────────────────┘     │
│                                                                                     │
│  External Data Sources:                                                             │
│    DeFiLlama API ─── NY Fed SOFR/EFFR API ─── Groq LLM API                        │
│    Chainlink Price Feeds (ETH/BTC/USDC on Ethereum Mainnet)                        │
│                                                                                     │
│  Output ──► DON-signed reports ──► Sepolia Oracles (5) + DeBORSwap                 │
└─────────────────────────────────────────────────────────────────────────────────────┘
```