# DeBOR Smart Contracts

Solidity smart contracts for the DeBOR protocol. Built with Foundry. 80 tests passing.

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
| USDC | [`0x80Be9b18DCb40E216682aA8972b64F93a4716FE6`](https://sepolia.etherscan.io/address/0x80Be9b18DCb40E216682aA8972b64F93a4716FE6) |
| ETH | [`0x8D7EBA5Ef17D69b234746fdbB9722EC52135B9A8`](https://sepolia.etherscan.io/address/0x8D7EBA5Ef17D69b234746fdbB9722EC52135B9A8) |
| BTC | [`0x1Ee00d2bd54C6200905BB4746bFDFB3eB4Be24fD`](https://sepolia.etherscan.io/address/0x1Ee00d2bd54C6200905BB4746bFDFB3eB4Be24fD) |
| DAI | [`0xdF989f502Ba3d9664c4a8B7bA675a0F34990b608`](https://sepolia.etherscan.io/address/0xdF989f502Ba3d9664c4a8B7bA675a0F34990b608) |
| USDT | [`0x2F565693410D51Be42c664B566F244EDe7Be772c`](https://sepolia.etherscan.io/address/0x2F565693410D51Be42c664B566F244EDe7Be772c) |

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

**Deployed:** [`0x114b52B58C8DAebe4972D3D9bC3659Ef66f8D291`](https://sepolia.etherscan.io/address/0x114b52B58C8DAebe4972D3D9bC3659Ef66f8D291) (Sepolia)

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

**Deployed:** [`0xE99c38245EA789E9102Dc23EE28FAd3ed67d2432`](https://sepolia.etherscan.io/address/0xE99c38245EA789E9102Dc23EE28FAd3ed67d2432) (Sepolia)

**Active destinations (3):**
| Chain | Selector | Receiver |
|-------|----------|----------|
| Base Sepolia | `10344971235874465080` | `0xf11b0c2c3C23eeBa32AB9a5340C767ccB152fA57` |
| Arb Sepolia | `3478487238524512106` | `0xc6C927c77D9BFaFb7b9e003db6D96F3605ba2514` |
| OP Sepolia | `5224473277236331295` | `0xd8EcF5D6D77bF2852c5e9313F87f31cc99c38dE9` |

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
| Base Sepolia | [`0xf11b0c2c3C23eeBa32AB9a5340C767ccB152fA57`](https://sepolia.basescan.org/address/0xf11b0c2c3C23eeBa32AB9a5340C767ccB152fA57) |
| Arb Sepolia | [`0xc6C927c77D9BFaFb7b9e003db6D96F3605ba2514`](https://sepolia.arbiscan.io/address/0xc6C927c77D9BFaFb7b9e003db6D96F3605ba2514) |
| OP Sepolia | [`0xd8EcF5D6D77bF2852c5e9313F87f31cc99c38dE9`](https://sepolia-optimism.etherscan.io/address/0xd8EcF5D6D77bF2852c5e9313F87f31cc99c38dE9) |

---

### [`DeBORConsumer.sol`](src/DeBORConsumer.sol) — AdaptiveLending Demo

Demo consumer showing how protocols would use DeBOR as a benchmark. Implements dynamic rate adjustment and adaptive collateral ratios.

**DeBOR integration:**
- Reads `debor.getRate()`, `debor.getSpread()`, `debor.getVolatility()`
- `getCurrentBorrowRate()` — benchmark + base spread + volatility premium
- `getAdaptiveCollateralRatio()` — increases collateral requirements when spread widens
- Market regime classification: STABLE / NORMAL / VOLATILE / CRISIS

**Deployed:** [`0x7BA1BF282bE87cA4D549Dd35C2C9163e2C4833d3`](https://sepolia.etherscan.io/address/0x7BA1BF282bE87cA4D549Dd35C2C9163e2C4833d3) (Sepolia)

---

### [`ReceiverTemplate.sol`](src/ReceiverTemplate.sol) — CRE Report Receiver Base

Base contract for receiving Chainlink CRE signed reports. Validates that the caller is the authorized CRE Forwarder.

**Chainlink integration:**
- `onReport(metadata, report)` — external entry point called by CRE Forwarder
- Validates `msg.sender == forwarderAddress` (set in constructor)
- Calls `_processReport(report)` — virtual function overridden by child contracts
- Used by: DeBOROracle, DeBORSwap

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

80 tests across 4 test files:

| Test File | Count | What it covers |
|-----------|-------|----------------|
| [`test/DeBOROracle.t.sol`](test/DeBOROracle.t.sol) | 16 | Report processing, ring buffer, historical reads, access control, 8-field benchmark, source tracking |
| [`test/DeBORCCIP.t.sol`](test/DeBORCCIP.t.sol) | 21 | CCIP send/receive, fee calculation, source validation, multi-destination (3 L2s), OP Sepolia |
| [`test/DeBORSwap.t.sol`](test/DeBORSwap.t.sol) | 41 | Swap lifecycle (create/join/settle/close/cancel/liquidate), ERC-721 mint/burn/transfer, CRE batch actions, margin calculations, on-chain metadata, PnL |
| [`test/Counter.t.sol`](test/Counter.t.sol) | 2 | Foundry template sanity checks |

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
cast call 0x80Be9b18DCb40E216682aA8972b64F93a4716FE6 "getRate()(uint256)" --rpc-url $RPC

# Full benchmark (rate, supply, spread, vol, term7d, timestamp, sources, configured)
cast call 0x80Be9b18DCb40E216682aA8972b64F93a4716FE6 \
  "getFullBenchmark()(uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256)" --rpc-url $RPC

# Historical rate (5 periods back)
cast call 0x80Be9b18DCb40E216682aA8972b64F93a4716FE6 \
  "getHistoricalRate(uint256)(uint256)" 5 --rpc-url $RPC

# Swap count
cast call 0x114b52B58C8DAebe4972D3D9bC3659Ef66f8D291 "getSwapCount()(uint256)" --rpc-url $RPC

# Unrealized PnL for swap #0
cast call 0x114b52B58C8DAebe4972D3D9bC3659Ef66f8D291 \
  "getUnrealizedPnL(uint256)(int256,int256)" 0 --rpc-url $RPC

# CCIP receiver rate on Base Sepolia
cast call 0xf11b0c2c3C23eeBa32AB9a5340C767ccB152fA57 "getRate()(uint256)" \
  --rpc-url https://base-sepolia.infura.io/v3/YOUR_KEY
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
        DeBORConsumer            (ownerOf settlement)
       (AdaptiveLending)
              |
              v
       DeBORCCIPSender ---- CCIP ----+--> DeBORCCIPReceiver (Base Sepolia)
                                     +--> DeBORCCIPReceiver (Arb Sepolia)
                                     +--> DeBORCCIPReceiver (OP Sepolia)
```