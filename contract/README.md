# DeBOR Smart Contracts

Solidity smart contracts for the DeBOR protocol. Built with Foundry. 105 tests passing.

---

## Contracts

### [`DeBOROracle.sol`](src/DeBOROracle.sol) — Benchmark Rate Oracle

The core on-chain oracle. Receives TVL-weighted benchmark rates from the CRE workflow via signed reports and stores them on-chain for any protocol to consume.

**Chainlink integration:**
- Inherits [`ReceiverTemplate.sol`](src/ReceiverTemplate.sol) — validates that reports come from the authorized CRE Forwarder (`0x15fC6ae953E024d975e77382eEeC56A9101f9F88`)
- `onReport(metadata, report)` → `_processReport(report)` — CRE report receiver pattern
- Emits `BenchmarkUpdated` event consumed by CRE's anomaly detector (Handler 9, EVM Log trigger)

**Storage:**
- 8 real-time metrics: `deborRate`, `deborSupply`, `deborSpread`, `deborVol`, `deborTerm7d`, `lastUpdated`, `numSources`, `sourcesConfigured`
- 336-entry ring buffer (`rateHistory`) for 7-day historical lookback (48 updates/day x 7 days)

**Read functions:**
```solidity
function getRate() external view returns (uint256)                    // Current borrow benchmark (bps)
function getSupplyRate() external view returns (uint256)              // Current supply benchmark (bps)
function getSpread() external view returns (uint256)                  // Rate spread (bps)
function getVolatility() external view returns (uint256)              // Cross-protocol rate variance
function getTermRate() external view returns (uint256)                // 7-day rolling average (bps)
function numSources() external view returns (uint256)                 // Active sources this update
function sourcesConfigured() external view returns (uint256)          // Total configured sources
function getFullBenchmark() external view returns (                   // All 8 values at once
    uint256 rate, uint256 supply, uint256 spread, uint256 vol,
    uint256 term7d, uint256 updated, uint256 sources, uint256 configured
)
function getHistoricalRate(uint256 periodsBack) external view returns (uint256) // Ring buffer lookup
```

**Deployed:** 5 instances on Sepolia

| Asset | Address |
|-------|---------|
| USDC | [`0x582cd24653ddB50bC23383457b2493487F1E4e68`](https://sepolia.etherscan.io/address/0x582cd24653ddB50bC23383457b2493487F1E4e68) |
| ETH | [`0x846D1d2424BBe8C16E9Ac5e59a2915298cFecFeA`](https://sepolia.etherscan.io/address/0x846D1d2424BBe8C16E9Ac5e59a2915298cFecFeA) |
| BTC | [`0xB2e0D3663Ae773e8D8EF7186a29FfFb07209fa24`](https://sepolia.etherscan.io/address/0xB2e0D3663Ae773e8D8EF7186a29FfFb07209fa24) |
| DAI | [`0xA1ccf4604c0ee3c43e44914a82d27935f8E3a2E0`](https://sepolia.etherscan.io/address/0xA1ccf4604c0ee3c43e44914a82d27935f8E3a2E0) |
| USDT | [`0x2A43a60233435F990b327AD06c6Da06eB36dBBaF`](https://sepolia.etherscan.io/address/0x2A43a60233435F990b327AD06c6Da06eB36dBBaF) |

---

### [`DeBORSwap.sol`](src/DeBORSwap.sol) — Interest Rate Swap with ERC-721 Positions

The first on-chain interest rate swap settled against a decentralized benchmark rate. Each swap position is tokenized as a tradeable ERC-721 NFT.

**Chainlink integration:**
- Inherits [`ReceiverTemplate.sol`](src/ReceiverTemplate.sol) — receives batch settle/close actions from CRE
- `_processReport` decodes `(uint8 action, uint256[] swapIds)`:
  - `ACTION_SETTLE = 1` → batch settle active swaps
  - `ACTION_CLOSE = 2` → batch close expired swaps
- Reads live rates from `IDeBOROracle` (the oracle above)
- CRE DON acts as decentralized clearinghouse:
  - Unified swap lifecycle every 30 min (Handler 5): settlement + liquidation + spike detection
  - Anomaly detection on BenchmarkUpdated event (Handler 9, EVM Log trigger)

**ERC-721 Token ID scheme:**
- Fixed payer token: `swapId * 2`
- Floating payer token: `swapId * 2 + 1`
- Minted on `joinSwap()`, burned on `closeSwap()`/`_liquidate()`
- Transfers restricted to Active swaps only
- Settlements go to `ownerOf()` — positions are transferable

**Swap lifecycle:**
```
createSwap(fixedRateBps, duration) → SwapStatus.Open      // Fixed payer deposits margin
joinSwap(swapId)                   → SwapStatus.Active     // Floating payer deposits margin, 2 NFTs minted
settle(swapId)                     → Still Active           // Daily: net payment based on DeBOR rate vs fixedRate
closeSwap(swapId)                  → SwapStatus.Settled     // After duration: return margins, burn NFTs
cancelSwap(swapId)                 → SwapStatus.Settled     // Unmatched: fixed payer reclaims margin
_liquidate(swapId)                 → SwapStatus.Liquidated  // Margin < 1%: return remaining, burn NFTs
```

**Settlement math:**
```
rateDiff = deborRate - fixedRateBps
dailyPayment = notional * rateDiff / 10000 / 365
totalPayment = dailyPayment * periods

If totalPayment > 0: floating payer pays fixed payer (DeBOR rate > fixed rate)
If totalPayment < 0: fixed payer pays floating payer (DeBOR rate < fixed rate)
```

**CRE view functions (read by workflow):**
```solidity
function getSettleableSwaps(uint256 maxResults) external view returns (uint256[]) // Due for settlement
function getExpiredSwaps(uint256 maxResults) external view returns (uint256[])    // Past duration
function getAtRiskSwaps(uint256 maxResults) external view returns (uint256[])     // Margin < 2% notional
function getSwapCount() external view returns (uint256)                            // Total swaps created
function getUnrealizedPnL(uint256 swapId) external view returns (int256, int256)  // Unrealized P&L
```

**On-chain metadata:**
```solidity
function tokenURI(uint256 tokenId) public view returns (string memory)
// Returns Base64-encoded JSON with: Role, Swap ID, Fixed Rate, Notional, Status
```

**Deployed:** [`0x21f2B4D2972045031c88F2e6D3430dD8646a5497`](https://sepolia.etherscan.io/address/0x21f2B4D2972045031c88F2e6D3430dD8646a5497) (Sepolia)

---

### [`DeBORCCIPSender.sol`](src/DeBORCCIPSender.sol) — Cross-Chain Relay via Chainlink CCIP

Relays benchmark data from Sepolia to L2 chains via Chainlink CCIP.

**Chainlink integration:**
- `IRouterClient` — Chainlink CCIP Router interface
- `Client.EVM2AnyMessage` — CCIP message construction
- `Client.GenericExtraArgsV2` — gas limit + out-of-order execution config
- `router.getFee()` — CCIP fee estimation
- `router.ccipSend()` — sends cross-chain message (pays in native ETH)

**Functions:**
```solidity
function relayBenchmark(bytes benchmarkData) external payable   // Relay to all active destinations
function relaySingle(uint64 chainSelector, address receiver, bytes data) external payable // Single destination
function getTotalFee(bytes benchmarkData) external view returns (uint256) // Fee estimation
function addDestination(uint64 chainSelector, address receiver) external  // Admin: add L2 target
```

**Deployed:** [`0xb09A5F2B70dAD8fbBe03C23e80883c9900Add3F0`](https://sepolia.etherscan.io/address/0xb09A5F2B70dAD8fbBe03C23e80883c9900Add3F0) (Sepolia)

**Active destinations (3):**
| Chain | Selector | Receiver |
|-------|----------|----------|
| Base Sepolia | `10344971235874465080` | `0x99346FAbefdA21E17E49DEAC0e25a49c2B0cB084` |
| Arb Sepolia | `3478487238524512106` | `0xE8163650f9e5bdAcd1e449f2fB70a5677bbA62ED` |
| OP Sepolia | `5224473277236331295` | `0xecB93f03515DE67EA43272797Ea8eDa059985894` |

---

### [`DeBORCCIPReceiver.sol`](src/DeBORCCIPReceiver.sol) — L2 Benchmark Mirror via Chainlink CCIP

Receives benchmark data on L2 chains via Chainlink CCIP. Stores the same 8 metrics as DeBOROracle with the same read interface.

**Chainlink integration:**
- Inherits `CCIPReceiver` from `@chainlink/contracts-ccip`
- `_ccipReceive(Client.Any2EVMMessage)` — validates source chain + sender, decodes benchmark data
- Source chain allowlisting: only accepts messages from Sepolia sender

**Security:**
- `allowedSourceChainSelector` — only Sepolia (16015286601757825753)
- `allowedSender` — only DeBORCCIPSender address
- Both validated on every incoming message

**Same read interface as DeBOROracle:**
```solidity
function getRate() external view returns (uint256)
function getFullBenchmark() external view returns (
    uint256 rate, uint256 supply, uint256 spread, uint256 vol,
    uint256 term7d, uint256 updated, uint256 sources, uint256 configured
)
function getHistoricalRate(uint256 periodsBack) external view returns (uint256)
```

**Deployed:**
| Chain | Address |
|-------|---------|
| Base Sepolia | [`0x99346FAbefdA21E17E49DEAC0e25a49c2B0cB084`](https://sepolia.basescan.org/address/0x99346FAbefdA21E17E49DEAC0e25a49c2B0cB084) |
| Arb Sepolia | [`0xE8163650f9e5bdAcd1e449f2fB70a5677bbA62ED`](https://sepolia.arbiscan.io/address/0xE8163650f9e5bdAcd1e449f2fB70a5677bbA62ED) |
| OP Sepolia | [`0xecB93f03515DE67EA43272797Ea8eDa059985894`](https://sepolia-optimism.etherscan.io/address/0xecB93f03515DE67EA43272797Ea8eDa059985894) |

---

### [`DeBORConsumer.sol`](src/DeBORConsumer.sol) — AdaptiveLending Demo

Demo consumer showing how protocols would use DeBOR as a benchmark. Implements dynamic rate adjustment and adaptive collateral ratios.

**DeBOR integration:**
- Reads `debor.getRate()`, `debor.getSpread()`, `debor.getVolatility()`, `debor.getFullBenchmark()`
- `getCurrentBorrowRate()` — benchmark + base spread + volatility premium
- `getAdaptiveCollateralRatio()` — increases collateral requirements when spread widens
- Market regime classification: STABLE / NORMAL / VOLATILE / CRISIS

**New risk functions (v2):**
```solidity
function getRiskScore() public view returns (uint256 score)
// Composite 0-100 risk score from volatility (0-40), spread (0-30), source coverage (0-30)

function getStressTestPnL(uint256 currentFixedRate, uint256 notional, int256 rateShockBps)
    public view returns (int256 pnlImpact)
// Simulates rate shock impact on a fixed-rate position (annualized PnL in notional units)

function getSourceDiversityScore() public view returns (uint256 diversityBps)
// Source health: (activeSources / configuredSources) * 10000 — 10000 = perfect coverage
```

**Deployed (v2):** [`0x7fd1C580A83E85b3b16d9e9A3Cd0385cC9759Eeb`](https://eth-sepolia.blockscout.com/address/0x7fd1C580A83E85b3b16d9e9A3Cd0385cC9759Eeb) (Sepolia)

---

### [`DeBORAIInsight.sol`](src/DeBORAIInsight.sol) — AI Risk Metadata Oracle

Stores structured AI-generated risk assessments on-chain. Receives LLM analysis results from the CRE workflow (Handler 7, `action="analyze"`) and makes them available to any consuming protocol.

**Chainlink integration:**
- Inherits [`ReceiverTemplate.sol`](src/ReceiverTemplate.sol) — receives DON-signed AI insight reports from CRE
- `_processReport(report)` decodes `(uint8 riskLevel, uint8 riskScore, bool anomalyDetected, uint8 rateDirection, uint8 spreadHealth, string explanation)`

**Storage:**
- `riskLevel`: LOW (0) / MEDIUM (1) / HIGH (2) / CRITICAL (3)
- `riskScore`: 0-100 composite score
- `anomalyDetected`: boolean anomaly flag
- `rateDirection`: RISING (0) / FALLING (1) / STABLE (2)
- `spreadHealth`: NORMAL (0) / COMPRESSED (1) / INVERTED (2)
- `explanation`: free-text reason from LLM
- `analyzedAt`: timestamp of last analysis

**Read functions:**
```solidity
function getInsight() external view returns (
    uint8 riskLevel, uint8 riskScore, bool anomalyDetected,
    uint8 rateDirection, uint8 spreadHealth, string memory explanation, uint256 analyzedAt
)
function getRiskLevel() external view returns (uint8)
function getRiskScore() external view returns (uint8)
function isAnomalyDetected() external view returns (bool)
```

**Deployed:** [`0xB0BEA2Ad32b41CF12bf600c4FfA5B5E569280a32`](https://sepolia.etherscan.io/address/0xB0BEA2Ad32b41CF12bf600c4FfA5B5E569280a32) (Sepolia)

---

### [`DeBORPaymentGate.sol`](src/DeBORPaymentGate.sol) — Credit-Gated API Access

Payment gate contract for metered access to premium DeBOR API endpoints. Users purchase credits with ETH and consume them per API call.

**Functions:**
```solidity
function purchaseCredits() external payable                    // Buy credits with ETH
function getBalance(address user) external view returns (uint256)  // Check credit balance
function consumeCredit(address user) external                  // Deduct 1 credit (called by authorized consumers)
function setMinCredits(uint256 min) external                   // Admin: set minimum credit purchase
function withdraw() external                                    // Admin: withdraw collected ETH
```

**Deployed:** [`0xFE3451ACB77228a022312cDB949c1f53E900c743`](https://sepolia.etherscan.io/address/0xFE3451ACB77228a022312cDB949c1f53E900c743) (Sepolia)

---

### [`ReceiverTemplate.sol`](src/ReceiverTemplate.sol) — CRE Report Receiver Base

Base contract for receiving Chainlink CRE signed reports. Validates that the caller is the authorized CRE Forwarder.

**Chainlink integration:**
- `onReport(metadata, report)` — external entry point called by CRE Forwarder
- Validates `msg.sender == forwarderAddress` (set in constructor)
- Calls `_processReport(report)` — virtual function overridden by child contracts
- Used by: DeBOROracle, DeBORSwap, DeBORAIInsight

---

## Chainlink Dependencies

| Library | Version | Import Path | Used By |
|---------|---------|-------------|---------|
| Chainlink CCIP | Latest | `@chainlink/contracts-ccip/` | DeBORCCIPSender, DeBORCCIPReceiver |
| OpenZeppelin | 5.0.2 | `@openzeppelin/contracts/` | DeBORSwap (ERC721, Ownable), DeBORCCIPSender (Ownable), DeBORCCIPReceiver (Ownable) |

**Foundry remappings** (`foundry.toml`):
```toml
remappings = [
  "@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/",
  "@openzeppelin/contracts@5.0.2/=lib/openzeppelin-contracts/contracts/",
  "@chainlink/contracts-ccip/=lib/chainlink-ccip/chains/evm/",
]
```

---

## Tests

105 tests across 6 test files:

| Test File | Count | What it covers |
|-----------|-------|----------------|
| [`test/DeBOROracle.t.sol`](test/DeBOROracle.t.sol) | 20 | Report processing, ring buffer, historical reads, access control, 8-field benchmark, source tracking, circuit breaker, risk metadata |
| [`test/DeBORCCIP.t.sol`](test/DeBORCCIP.t.sol) | 25 | CCIP send/receive, fee calculation, source validation, multi-destination (3 L2s), OP Sepolia, benchmark relay |
| [`test/DeBORSwap.t.sol`](test/DeBORSwap.t.sol) | 41 | Swap lifecycle (create/join/settle/close/cancel/liquidate), ERC-721 mint/burn/transfer, CRE batch actions, margin calculations, on-chain metadata, PnL |
| [`test/DeBORAIInsight.t.sol`](test/DeBORAIInsight.t.sol) | 7 | AI insight storage, risk level updates, anomaly flags, CRE report processing, access control |
| [`test/DeBORPaymentGate.t.sol`](test/DeBORPaymentGate.t.sol) | 12 | Credit purchase, balance tracking, credit consumption, access gating, admin controls, refunds |

```bash
# Run all tests
forge test -vvv

# Run specific test file
forge test --match-path test/DeBORSwap.t.sol -vvv

# Run specific test
forge test --match-test testSettlement -vvv
```

---

## Deployment

### Deploy Oracles (Sepolia)

```bash
source .env
forge script script/DeployMultiAsset.s.sol:DeployMultiAsset \
  --rpc-url sepolia --broadcast --verify
```

### Deploy CCIP (Sepolia + L2s)

```bash
forge script script/DeployCCIP.s.sol:DeployCCIP \
  --rpc-url sepolia --broadcast --verify
```

### Redeploy Consumer (Sepolia)

```bash
forge script script/RedeployConsumer.s.sol:RedeployConsumer \
  --rpc-url sepolia --broadcast --verify
```

### Deploy Swap (Sepolia)

```bash
forge script script/DeploySwap.s.sol:DeploySwap \
  --rpc-url sepolia --broadcast --verify
```

---

## Read On-Chain (cast examples)

```bash
RPC="https://sepolia.infura.io/v3/YOUR_KEY"

# Current DeBOR-USDC borrow rate (bps)
cast call 0x582cd24653ddB50bC23383457b2493487F1E4e68 "getRate()(uint256)" --rpc-url $RPC

# Full benchmark (rate, supply, spread, vol, term7d, timestamp, sources, configured)
cast call 0x582cd24653ddB50bC23383457b2493487F1E4e68 \
  "getFullBenchmark()(uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256)" --rpc-url $RPC

# Historical rate (5 periods back)
cast call 0x582cd24653ddB50bC23383457b2493487F1E4e68 \
  "getHistoricalRate(uint256)(uint256)" 5 --rpc-url $RPC

# Swap count
cast call 0x21f2B4D2972045031c88F2e6D3430dD8646a5497 "getSwapCount()(uint256)" --rpc-url $RPC

# Unrealized PnL for swap #0
cast call 0x21f2B4D2972045031c88F2e6D3430dD8646a5497 \
  "getUnrealizedPnL(uint256)(int256,int256)" 0 --rpc-url $RPC

# CCIP receiver rate on Base Sepolia
cast call 0x99346FAbefdA21E17E49DEAC0e25a49c2B0cB084 "getRate()(uint256)" \
  --rpc-url https://base-sepolia.infura.io/v3/YOUR_KEY

# AdaptiveLending v2 — risk score (0-100)
cast call 0x7fd1C580A83E85b3b16d9e9A3Cd0385cC9759Eeb "getRiskScore()(uint256)" --rpc-url $RPC

# AdaptiveLending v2 — stress test PnL (rate shock of +200bps on 1 ETH notional at 350bps fixed)
cast call 0x7fd1C580A83E85b3b16d9e9A3Cd0385cC9759Eeb \
  "getStressTestPnL(uint256,uint256,int256)(int256)" 350 1000000000000000000 200 --rpc-url $RPC

# AdaptiveLending v2 — source diversity (10000 = 100% sources active)
cast call 0x7fd1C580A83E85b3b16d9e9A3Cd0385cC9759Eeb "getSourceDiversityScore()(uint256)" --rpc-url $RPC
```

---

## Architecture

```
                        CRE Forwarder (0x15fC...)
                              |
                    +---------+---------+
                    v                   v
           DeBOROracle               DeBORSwap
         (5 instances)             (ERC-721 IRS)
     USDC/ETH/BTC/DAI/USDT              |
              |                          v
              v                    NFT Holders
        DeBORConsumer v2         (ownerOf settlement)
       (AdaptiveLending +
        riskScore, stressPnL,        DeBORAIInsight
        diversityScore)             (AI risk metadata)
              |
              v                   DeBORPaymentGate
       DeBORCCIPSender            (credit-gated API)
              |
              +---- CCIP ----+--> DeBORCCIPReceiver (Base Sepolia)
                             +--> DeBORCCIPReceiver (Arb Sepolia)
                             +--> DeBORCCIPReceiver (OP Sepolia)
```