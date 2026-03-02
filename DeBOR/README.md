# DeBOR CRE Project

This is the Chainlink CRE (Compute Runtime Environment) project root. It contains the project-level configuration and the workflow source code.

---

## Structure

```
DeBOR/                          <- You are here (CRE project root)
├── project.yaml                # RPC endpoints for 7 chains (6 mainnet + 1 testnet)
├── secrets.yaml                # VaultDON secret references
└── DeBOR-Workflow/                      # Workflow source code
    ├── main.ts                 # 10 handler registrations + entry point
    ├── rateReader.ts           # Protocol rate reads + Chainlink Price Feeds
    ├── tvlFetcher.ts           # DeFiLlama TVL with DON consensus
    ├── benchmarkEngine.ts      # TVL-weighted benchmark computation
    ├── swapManager.ts          # IRS lifecycle (settle, liquidate, spike detect)
    ├── preflightCheck.ts       # Health monitoring (chain liveness, balances, gas)
    ├── confidentialFetcher.ts  # TEE-based TVL via ConfidentialHTTPClient
    ├── httpValidator.ts        # HTTP validation + cross-check layer
    ├── types.ts                # TypeScript type definitions
    ├── abis.ts                 # Contract ABIs (Aave, Compound, Morpho, CToken, Chainlink, DeBOR)
    ├── config.staging.json     # 43 protocol sources + 5 oracle addresses
    ├── workflow.yaml           # CRE workflow settings
    ├── package.json            # Dependencies: @chainlink/cre-sdk@1.1.2, viem, zod
    └── README.md               # Detailed workflow documentation
```

---

## RPC Configuration (`project.yaml`)

The CRE workflow reads from 6 mainnet chains and writes to 1 testnet:

| Chain | Selector Name | Purpose |
|-------|---------------|---------|
| Ethereum Mainnet | `ethereum-mainnet` | Read rates from Aave, Compound, Spark, Morpho + Chainlink Price Feeds |
| Base Mainnet | `ethereum-mainnet-base-1` | Read rates from Aave Base, Compound Base, Moonwell Base |
| Arbitrum Mainnet | `ethereum-mainnet-arbitrum-1` | Read rates from Aave Arb, Compound Arb |
| Optimism Mainnet | `ethereum-mainnet-optimism-1` | Read rates from Aave OP, Moonwell OP |
| Avalanche Mainnet | `ethereum-mainnet-avalanche-1` | Read rates from Aave AVAX, Benqi AVAX |
| Polygon Mainnet | `ethereum-mainnet-polygon-1` | Read rates from Aave Polygon |
| Sepolia Testnet | `ethereum-testnet-sepolia` | Write benchmarks to DeBOR Oracles + DeBORSwap |

---

## Secrets (`secrets.yaml`)

VaultDON secret references for ConfidentialHTTPClient:
- `PREMIUM_API_KEY` — gates ConfidentialHTTPClient TVL fetch (TEE-based)
- `INFURA_KEY` — RPC access (used in project.yaml URLs)

---

## How to Simulate

```bash
# From this directory (DeBOR/)

# Benchmark handlers (reads real mainnet rates)
cre workflow simulate ./DeBOR --non-interactive --trigger-index 0    # USDC core (10 sources)
cre workflow simulate ./DeBOR --non-interactive --trigger-index 1    # ETH (10 sources)
cre workflow simulate ./DeBOR --non-interactive --trigger-index 2    # BTC (5 sources)
cre workflow simulate ./DeBOR --non-interactive --trigger-index 3    # DAI (8 sources)
cre workflow simulate ./DeBOR --non-interactive --trigger-index 4    # USDT (6 sources)
cre workflow simulate ./DeBOR --non-interactive --trigger-index 8    # USDC ext merge (14/14)

# Swap lifecycle (merged: settle + liquidation + spike)
cre workflow simulate ./DeBOR --non-interactive --trigger-index 5    # Swap lifecycle manager

# Pre-flight health monitor + Chainlink prices
cre workflow simulate ./DeBOR --non-interactive --trigger-index 6    # Pre-flight check

# HTTP on-demand refresh
cre workflow simulate ./DeBOR --non-interactive --trigger-index 7 \
  --http-payload '{"asset":"USDC"}'                                  # Single asset

# HTTP validation layer
cre workflow simulate ./DeBOR --non-interactive --trigger-index 7 \
  --http-payload '{"action":"validate"}'                             # Cross-validation

# EVM Log anomaly detector (requires tx hash)
cre workflow simulate ./DeBOR --non-interactive --trigger-index 9 \
  --evm-tx-hash <TX_HASH> --evm-event-index 0                       # Anomaly detector
```

---

## Chainlink Integration

Every file in this project that uses Chainlink technology:

| File | Chainlink Usage |
|------|-----------------|
| `project.yaml` | CRE project config — RPC endpoints for 7 chain selectors |
| `secrets.yaml` | VaultDON secret references |
| [`DeBOR-Workflow/main.ts`](debor/main.ts) | CRE Runner, 3 trigger types (Cron + HTTP + EVM Log), runtime.report, runtime.getSecret, runtime.runInNodeMode, consensusMedianAggregation, safeJsonStringify, LATEST_BLOCK_NUMBER, hexToBase64 |
| [`DeBOR-Workflow/rateReader.ts`](debor/rateReader.ts) | EVMClient.callContract (43 source reads), Chainlink Price Feeds (ETH/USD, BTC/USD, USDC/USD), isChainSelectorSupported |
| [`DeBOR-Workflow/tvlFetcher.ts`](debor/tvlFetcher.ts) | HTTPClient + ConsensusAggregationByFields (median + identical + ignore) |
| [`DeBOR-Workflow/benchmarkEngine.ts`](debor/benchmarkEngine.ts) | safeJsonStringify, UInt64 |
| [`DeBOR-Workflow/swapManager.ts`](debor/swapManager.ts) | EVMClient (9 methods: callContract, writeReport, filterLogs, headerByNumber, getTransactionReceipt, getTransactionByHash), prepareReportRequest |
| [`DeBOR-Workflow/preflightCheck.ts`](debor/preflightCheck.ts) | EVMClient.headerByNumber, EVMClient.balanceAt (x2), EVMClient.estimateGas, runtime.now() |
| [`DeBOR-Workflow/confidentialFetcher.ts`](debor/confidentialFetcher.ts) | ConfidentialHTTPClient (TEE-based with VaultDON secrets) |
| [`DeBOR-Workflow/httpValidator.ts`](debor/httpValidator.ts) | CRE consensus aggregation, oracle reads, sanity validation, TVL cross-check, historical consistency |
| [`DeBOR-Workflow/abis.ts`](debor/abis.ts) | CHAINLINK_PRICE_FEED_ABI (latestRoundData, decimals) |

**Total: 30+ CRE capabilities used across 10 handlers with 3 trigger types (Cron + HTTP + EVM Log).**

See [`DeBOR/README.md`](debor/README.md) for detailed file-by-file documentation.

---

## Broadcast Real Rates to Sepolia

Add `--target staging-settings --broadcast` to write real mainnet rates on-chain:

```bash
# From this directory (DeBOR/)
cre workflow simulate ./DeBOR --target staging-settings --non-interactive --trigger-index 0 --broadcast   # USDC core
cre workflow simulate ./DeBOR --target staging-settings --non-interactive --trigger-index 1 --broadcast   # ETH
cre workflow simulate ./DeBOR --target staging-settings --non-interactive --trigger-index 2 --broadcast   # BTC
cre workflow simulate ./DeBOR --target staging-settings --non-interactive --trigger-index 3 --broadcast   # DAI
cre workflow simulate ./DeBOR --target staging-settings --non-interactive --trigger-index 4 --broadcast   # USDT
cre workflow simulate ./DeBOR --target staging-settings --non-interactive --trigger-index 8 --broadcast   # USDC ext (14/14)
```

Without `--broadcast`, `writeReport` returns mock tx hash. With `--broadcast`, real transactions hit Sepolia. All reads are always real mainnet data.