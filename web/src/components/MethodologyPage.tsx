import { motion } from 'motion/react'
import { fadeIn, delayedFadeIn } from '@/utils/motion'
import SectionHeading from '@/components/elements/SectionHeading'
import { shortenAddress, etherscanLink } from '@/utils/format'
import {
  ORACLE_ADDRESSES,
  CONSUMER_ADDRESS,
  SWAP_ADDRESS,
  AI_INSIGHT_ADDRESS,
  PAYMENT_GATE_ADDRESS,
  CCIP_SENDER_ADDRESS,
  CCIP_RECEIVERS,
} from '@/lib/contracts'

export default function MethodologyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 pb-16 pt-10">
      <motion.div {...fadeIn}>
        <SectionHeading title="Methodology" />
        <p
          className="mb-10 max-w-xl text-[0.9375rem] leading-relaxed"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          Complete documentation of DeBOR benchmark rate calculation, data
          sources, weighting methodology, and governance framework.
        </p>
      </motion.div>

      <div className="space-y-12">
        <motion.section {...delayedFadeIn(0.04)}>
          <H3>1. Overview</H3>
          <P>
            DeBOR (Decentralized Benchmark Oracle Rate) is an on-chain
            benchmark interest rate aggregated from major DeFi lending
            protocols. It provides TVL-weighted average borrow and supply rates
            for five assets: USDC, ETH, BTC (WBTC), DAI, and USDT.
          </P>
          <P>
            Rates are computed every 30 minutes by a Chainlink CRE
            (Compute Runtime Environment) workflow running in a Trusted
            Execution Environment (TEE), then published to on-chain oracle
            contracts on Ethereum Sepolia and relayed to L2 testnets via
            Chainlink CCIP.
          </P>
        </motion.section>

        <motion.section {...delayedFadeIn(0.08)}>
          <H3>2. Data Sources</H3>
          <P>
            DeBOR aggregates rate data from six DeFi lending protocols across
            multiple mainnet chains:
          </P>
          <Table
            headers={['Protocol', 'Chains', 'Data Points']}
            rows={[
              ['Aave V3', 'Ethereum, Polygon, Arbitrum, Optimism, Base, Avalanche', 'Borrow APY, Supply APY, TVL'],
              ['Compound V3', 'Ethereum, Polygon, Arbitrum, Base', 'Borrow APR, Supply APR, TVL'],
              ['Morpho', 'Ethereum, Base', 'Borrow APY, Supply APY, TVL'],
              ['Spark', 'Ethereum', 'Borrow APY, Supply APY, TVL'],
              ['Moonwell', 'Base, Optimism', 'Borrow APY, Supply APY, TVL'],
              ['Benqi', 'Avalanche', 'Borrow APY, Supply APY, TVL'],
            ]}
          />
          <P>
            Data is fetched via HTTP from each protocol's public API or
            subgraph. Fetching occurs inside a confidential TEE environment to
            ensure data integrity and prevent manipulation.
          </P>
        </motion.section>

        <motion.section {...delayedFadeIn(0.12)}>
          <H3>3. Weighting Methodology</H3>
          <P>
            The benchmark rate is a TVL-weighted average. Each protocol's
            contribution is proportional to its Total Value Locked for the
            specific asset being computed.
          </P>
          <Formula>
            {`DeBOR_rate = Σ(rate_i × TVL_i) / Σ(TVL_i)`}
          </Formula>
          <P>Where:</P>
          <Ul>
            <li><Code>rate_i</Code> = borrow rate from protocol i (annualized, in basis points)</li>
            <li><Code>TVL_i</Code> = total value locked in protocol i for the specific asset</li>
            <li>Summation is over all protocols reporting data for that asset</li>
          </Ul>
          <P>
            This weighting ensures that larger, more liquid markets have greater
            influence on the benchmark. A protocol with $10B in USDC deposits
            contributes more than one with $100M.
          </P>
        </motion.section>

        <motion.section {...delayedFadeIn(0.16)}>
          <H3>4. Derived Metrics</H3>
          <P>
            Beyond the headline borrow rate, each oracle publishes:
          </P>
          <Table
            headers={['Field', 'Unit', 'Description']}
            rows={[
              ['rate', 'bps', 'TVL-weighted average borrow rate'],
              ['supply', 'bps', 'TVL-weighted average supply rate'],
              ['spread', 'bps', 'Difference between borrow and supply rates'],
              ['vol', 'raw', 'Cross-protocol standard deviation (volatility indicator)'],
              ['term7d', 'bps', '7-day moving average rate from the on-chain ring buffer'],
              ['sources', 'count', 'Number of protocols that reported data this cycle'],
              ['configured', 'count', 'Total number of protocols expected to report'],
            ]}
          />
        </motion.section>

        <motion.section {...delayedFadeIn(0.2)}>
          <H3>5. Anomaly Detection</H3>
          <P>
            Before publishing, the CRE workflow performs anomaly detection:
          </P>
          <Ul>
            <li>
              <strong>Rate bounds check:</strong> Any individual protocol rate
              below 0 or above 10,000 bps (100%) is excluded from the weighted
              average.
            </li>
            <li>
              <strong>Source quorum:</strong> If fewer than 50% of configured
              sources report, the rate is flagged but still published with the
              reduced source count visible.
            </li>
            <li>
              <strong>Cross-protocol deviation:</strong> The volatility field
              captures standard deviation across protocols. High values indicate
              disagreement between sources.
            </li>
          </Ul>
        </motion.section>

        <motion.section {...delayedFadeIn(0.24)}>
          <H3>6. On-Chain Storage</H3>
          <P>
            Each asset oracle contract maintains a 336-slot circular ring
            buffer, storing one rate per 30-minute interval — approximately
            7 days of history.
          </P>
          <Ul>
            <li>
              <Code>getHistoricalRate(0)</Code> returns the most recent rate.
            </li>
            <li>
              <Code>getHistoricalRate(335)</Code> returns the oldest rate
              (~7 days ago).
            </li>
            <li>
              <Code>historyIndex()</Code> returns the current write position
              in the ring buffer.
            </li>
          </Ul>
          <P>
            The ring buffer overwrites old data cyclically. The term7d field
            is computed as the average of all non-zero entries in the buffer.
          </P>
        </motion.section>

        <motion.section {...delayedFadeIn(0.28)}>
          <H3>7. Cross-Chain Relay</H3>
          <P>
            After publishing to Sepolia, the CRE workflow sends the benchmark
            data to L2 testnets via Chainlink CCIP (Cross-Chain Interoperability
            Protocol):
          </P>
          <Table
            headers={['Destination', 'Chain ID', 'Relay Method']}
            rows={[
              ['Base Sepolia', '84532', 'CCIP programmable token transfer'],
              ['Arbitrum Sepolia', '421614', 'CCIP programmable token transfer'],
              ['Optimism Sepolia', '11155420', 'CCIP programmable token transfer'],
            ]}
          />
          <P>
            Each L2 receiver contract stores the relayed benchmark data and
            maintains its own historical rate buffer, enabling local queries
            without cross-chain calls.
          </P>
        </motion.section>

        <motion.section {...delayedFadeIn(0.32)}>
          <H3>8. Risk Analytics</H3>
          <P>
            The AdaptiveLending consumer contract computes risk metrics from
            oracle data:
          </P>
          <Ul>
            <li>
              <strong>VaR (Value-at-Risk):</strong> Parametric VaR at 95% and
              99% confidence levels using z-scores (1.645 and 2.326) applied
              to cross-protocol volatility. Annualized over 17,520 periods/year.
            </li>
            <li>
              <strong>CVaR (Expected Shortfall):</strong> Conditional VaR using
              multipliers 2.063 (95%) and 2.665 (99%).
            </li>
            <li>
              <strong>HHI (Herfindahl-Hirschman Index):</strong> Concentration
              metric computed from TVL weights. Below 0.15 = low, 0.15-0.25 = moderate,
              above 0.25 = high concentration.
            </li>
            <li>
              <strong>Basel IRRBB Stress Tests:</strong> Six standard scenarios
              — Parallel Up/Down (±200bps), Short Rate Up/Down (±300bps), Source
              Failure, and TVL Collapse.
            </li>
          </Ul>
        </motion.section>

        <motion.section {...delayedFadeIn(0.36)}>
          <H3>9. Update Schedule</H3>
          <Table
            headers={['Event', 'Frequency', 'Trigger']}
            rows={[
              ['Rate computation', 'Every 30 minutes', 'CRE Cron trigger'],
              ['Oracle publication', 'Every 30 minutes', 'CRE report submission'],
              ['CCIP relay', 'Every 30 minutes', 'Post-publication trigger'],
              ['Risk score update', 'On every oracle write', 'Consumer reads latest data'],
              ['SOFR comparison', 'Daily (business days)', 'NY Fed publishes ~8am ET'],
            ]}
          />
        </motion.section>

        <motion.section {...delayedFadeIn(0.4)}>
          <H3>10. Deployed Contracts</H3>
          <P>
            All contracts are deployed on Ethereum Sepolia testnet. Click any
            address to view on Etherscan.
          </P>
          <ContractTable />
        </motion.section>

        <motion.section {...delayedFadeIn(0.44)}>
          <H3>11. Governance & Parameters</H3>
          <P>
            The following parameters are set at deployment and can be updated
            through contract owner functions:
          </P>
          <Table
            headers={['Parameter', 'Current Value', 'Effect']}
            rows={[
              ['Source list', '6 protocols', 'Which protocols are aggregated'],
              ['Ring buffer size', '336 slots', '~7 days of 30-min data'],
              ['Update interval', '30 minutes', 'CRE cron frequency'],
              ['Rate bounds', '0-10,000 bps', 'Anomaly exclusion range'],
              ['CCIP destinations', '3 L2 testnets', 'Cross-chain relay targets'],
            ]}
          />
          <P>
            DeBOR is currently deployed on Ethereum Sepolia testnet for
            development and evaluation purposes. The methodology may be
            refined before any mainnet deployment.
          </P>
        </motion.section>
      </div>
    </main>
  )
}

function H3({ children }: { children: React.ReactNode }) {
  return (
    <h3
      className="mb-3 text-sm font-semibold"
      style={{ color: 'var(--color-text-primary)' }}
    >
      {children}
    </h3>
  )
}

function P({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="mb-3 text-[0.875rem] leading-relaxed"
      style={{ color: 'var(--color-text-secondary)' }}
    >
      {children}
    </p>
  )
}

function Ul({ children }: { children: React.ReactNode }) {
  return (
    <ul
      className="mb-3 list-inside list-disc space-y-1.5 text-[0.875rem] leading-relaxed"
      style={{ color: 'var(--color-text-secondary)' }}
    >
      {children}
    </ul>
  )
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code
      className="rounded px-1.5 py-0.5 text-[0.8125rem]"
      style={{ background: 'rgba(0,0,0,0.06)' }}
    >
      {children}
    </code>
  )
}

function Formula({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="my-4 rounded-lg px-5 py-3 font-mono text-sm"
      style={{ background: 'var(--color-code-bg)', color: 'var(--color-text-primary)' }}
    >
      {children}
    </div>
  )
}

const CONTRACT_ROWS: { label: string; address: string }[] = [
  { label: 'USDC Oracle', address: ORACLE_ADDRESSES.USDC },
  { label: 'ETH Oracle', address: ORACLE_ADDRESSES.ETH },
  { label: 'BTC Oracle', address: ORACLE_ADDRESSES.BTC },
  { label: 'DAI Oracle', address: ORACLE_ADDRESSES.DAI },
  { label: 'USDT Oracle', address: ORACLE_ADDRESSES.USDT },
  { label: 'Consumer (AdaptiveLending)', address: CONSUMER_ADDRESS },
  { label: 'Swap (IRS)', address: SWAP_ADDRESS },
  { label: 'AI Insight', address: AI_INSIGHT_ADDRESS },
  { label: 'Payment Gate', address: PAYMENT_GATE_ADDRESS },
  { label: 'CCIP Sender', address: CCIP_SENDER_ADDRESS },
  { label: 'CCIP Receiver (Base)', address: CCIP_RECEIVERS['Base Sepolia'].address },
  { label: 'CCIP Receiver (Arb)', address: CCIP_RECEIVERS['Arb Sepolia'].address },
  { label: 'CCIP Receiver (OP)', address: CCIP_RECEIVERS['OP Sepolia'].address },
]

function ContractTable() {
  return (
    <div
      className="my-4 overflow-x-auto rounded-xl"
      style={{
        background: 'var(--color-card)',
        boxShadow: '0 0 0 1px var(--color-border-subtle)',
      }}
    >
      <table className="w-full" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {['Contract', 'Address'].map((h) => (
              <th
                key={h}
                className="px-4 py-2.5 text-left text-xs font-semibold"
                style={{
                  color: 'var(--color-text-secondary)',
                  borderBottom: '1px solid var(--color-border-subtle)',
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {CONTRACT_ROWS.map((row, i) => (
            <tr key={row.label}>
              <td
                className="px-4 py-2.5 text-[0.8125rem]"
                style={{
                  color: 'var(--color-text-primary)',
                  borderBottom:
                    i < CONTRACT_ROWS.length - 1
                      ? '1px solid var(--color-border-subtle)'
                      : 'none',
                }}
              >
                {row.label}
              </td>
              <td
                className="px-4 py-2.5 text-[0.8125rem]"
                style={{
                  borderBottom:
                    i < CONTRACT_ROWS.length - 1
                      ? '1px solid var(--color-border-subtle)'
                      : 'none',
                }}
              >
                <a
                  href={etherscanLink(row.address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono transition-colors duration-100"
                  style={{ color: 'var(--color-accent-pink)' }}
                >
                  {shortenAddress(row.address)}
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div
      className="my-4 overflow-x-auto rounded-xl"
      style={{
        background: 'var(--color-card)',
        boxShadow: '0 0 0 1px var(--color-border-subtle)',
      }}
    >
      <table className="w-full" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {headers.map((h) => (
              <th
                key={h}
                className="px-4 py-2.5 text-left text-xs font-semibold"
                style={{
                  color: 'var(--color-text-secondary)',
                  borderBottom: '1px solid var(--color-border-subtle)',
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td
                  key={j}
                  className="px-4 py-2.5 text-[0.8125rem]"
                  style={{
                    color: 'var(--color-text-primary)',
                    borderBottom:
                      i < rows.length - 1
                        ? '1px solid var(--color-border-subtle)'
                        : 'none',
                  }}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
