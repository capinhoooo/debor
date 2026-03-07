# DeBOR Web Dashboard

Frontend for the DeBOR protocol. Displays live benchmark oracle data, interest rate swap positions, and cross-chain CCIP relay status. Reads directly from deployed contracts on Sepolia, Base Sepolia, Arbitrum Sepolia, and Optimism Sepolia.

---

## Architecture

```
┌─────────────────────── DeBOR Web Dashboard ───────────────────────────┐
│                                                                        │
│  Browser (React 19 + TanStack Start)                                  │
│  ┌──────────────────────────────────────────────────────────────┐     │
│  │  Dashboard        Swap Page       Cross-Chain Page           │     │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────────────┐     │     │
│  │  │ 5 Oracle   │  │ Swap list  │  │ CCIP Receivers     │     │     │
│  │  │ rates +    │  │ + create   │  │ (Base/Arb/OP)     │     │     │
│  │  │ metrics    │  │ + P&L      │  │ mirrored rates    │     │     │
│  │  └──────┬─────┘  └──────┬─────┘  └──────┬─────────────┘     │     │
│  └─────────┼───────────────┼───────────────┼────────────────────┘     │
│            │               │               │                          │
│            ▼               ▼               ▼                          │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │  wagmi + viem (Sepolia RPC)                                 │     │
│  │  useOracleData() — reads getFullBenchmark() from 5 oracles  │     │
│  │  useSwapData()   — reads DeBORSwap state + ERC-721          │     │
│  │  useCrossChain() — reads CCIP receivers on 3 L2 testnets    │     │
│  └─────────────────────────────────────────────────────────────┘     │
│            │               │               │                          │
│            ▼               ▼               ▼                          │
│     DeBOR Oracles    DeBORSwap      CCIP Receivers                   │
│     (Sepolia x5)     (Sepolia)      (Base/Arb/OP Sepolia)           │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Pages

| Route | Component | Description |
|-------|-----------|-------------|
| `/` | `Dashboard` | Live rates, supply rates, spreads, volatility, 7d term, source count for all 5 assets |
| `/asset/:id` | `AssetPage` | Per-asset deep dive with rate history chart, risk metrics, SOFR comparison |
| `/swap` | `SwapPage` | Interest rate swap positions, create/join swaps, unrealized P&L |
| `/cross-chain` | `CrossChainPage` | CCIP relay status — mirrored rates on Base, Arb, OP Sepolia |
| `/compare` | `ComparePage` | DeFi vs TradFi rate comparison (SOFR, EFFR) with regime classification |
| `/risk` | `RiskDashboard` | Risk analytics: VaR/CVaR, HHI, stress tests, circuit breaker status |

---

## Contract Addresses (read by frontend)

| Contract | Address | Chain |
|----------|---------|-------|
| USDC Oracle | `0x102Ad94B7D28B9222bf7F24Cd0022B6904A8A78E` | Sepolia |
| ETH Oracle | `0x1c6c56A422B73Ee0c70c029BEF0deD113a98c727` | Sepolia |
| BTC Oracle | `0x2836153c31bD747Beb470620212f6855DB7c76a4` | Sepolia |
| DAI Oracle | `0x4929981f89CBA741b5ED8B48283B125eaD483754` | Sepolia |
| USDT Oracle | `0xfcF28e4E4bCCD4477AFd5BDbf5a4943645752BDD` | Sepolia |
| DeBORSwap | `0x4bB75f3863B885300DB9e87f9E8DC4d71d94B5aB` | Sepolia |
| DeBORCCIPSender | `0xb09A5F2B70dAD8fbBe03C23e80883c9900Add3F0` | Sepolia |
| DeBORAIInsight | `0x8767630Fa001F380bE5d752969C4DE8D8D083083` | Sepolia |
| DeBORPaymentGate | `0x6eba1116C94f2E0eE9034062aB37f315866fF6B2` | Sepolia |
| CCIP Receiver | `0x99346FAbefdA21E17E49DEAC0e25a49c2B0cB084` | Base Sepolia |
| CCIP Receiver | `0xE8163650f9e5bdAcd1e449f2fB70a5677bbA62ED` | Arb Sepolia |
| CCIP Receiver | `0xecB93f03515DE67EA43272797Ea8eDa059985894` | OP Sepolia |

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | TanStack Start (React 19, SSR) |
| Routing | TanStack Router (file-based) |
| Styling | Tailwind CSS 4 + HeroUI |
| Animations | Framer Motion + GSAP + Lenis smooth scroll |
| Web3 | wagmi + viem (contract reads) |
| Build | Vite 7 + Nitro |
| Language | TypeScript (strict) |
| Package Manager | bun |

---

## Quick Start

```bash
cd web
bun install
bun dev        # http://localhost:3200
```

## Commands

```bash
bun dev        # Start dev server (port 3200)
bun build      # Production build
bun preview    # Preview production build
bun test       # Run Vitest tests
bun lint       # ESLint
bun format     # Prettier
bun check      # Format + lint
```

---

## Project Structure

```
web/
├── src/
│   ├── routes/                 # File-based routes (TanStack Router)
│   │   ├── __root.tsx          # Root layout + providers
│   │   ├── index.tsx           # Dashboard (oracle data)
│   │   ├── asset.$id.tsx       # Per-asset deep dive
│   │   ├── swap.tsx            # Swap page
│   │   ├── cross-chain.tsx     # CCIP cross-chain status
│   │   ├── compare.tsx         # DeFi vs TradFi comparison
│   │   └── risk.tsx            # Risk analytics dashboard
│   ├── components/
│   │   ├── Dashboard.tsx       # 5-asset oracle data display
│   │   ├── AssetPage.tsx       # Per-asset rates, charts, risk metrics
│   │   ├── SwapPage.tsx        # IRS positions + create/join
│   │   ├── CrossChainPage.tsx  # CCIP receiver status (3 L2s)
│   │   ├── ComparePage.tsx     # SOFR/EFFR comparison + regime
│   │   ├── RiskDashboard.tsx   # VaR/CVaR, HHI, stress tests, circuit breaker
│   │   ├── Navbar.tsx          # Navigation bar
│   │   └── Footer.tsx          # Footer
│   ├── hooks/
│   │   ├── useOracleData.ts    # wagmi hooks for oracle reads
│   │   ├── useSOFRData.ts      # SOFR/EFFR data from NY Fed API
│   │   ├── useDeFiPremium.ts   # DeFi vs TradFi premium calculation
│   │   └── useCrossChainData.ts # wagmi hooks for CCIP receivers
│   ├── lib/
│   │   ├── contracts.ts        # Contract addresses + chain config
│   │   ├── abi.ts              # Oracle + Swap + AIInsight + PaymentGate ABIs
│   │   └── wagmi.ts            # wagmi client configuration
│   ├── utils/
│   │   ├── format.ts           # Rate formatting (bps → %)
│   │   ├── risk.ts             # VaR/CVaR, HHI, stress tests, risk scoring
│   │   ├── motion.ts           # Framer Motion animation presets
│   │   └── style.ts            # cnm() — clsx + tailwind-merge
│   └── config.ts               # App-level config
├── package.json
└── vite.config.ts
```
