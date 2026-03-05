import { useMemo } from 'react'
import { motion } from 'motion/react'
import { useCrossChainRates, type CrossChainRate } from '@/hooks/useCrossChainData'
import { formatBps, timeAgo, formatTimeRemaining, shortenAddress, etherscanLink } from '@/utils/format'
import { CCIP_RECEIVERS, CCIP_SENDER_ADDRESS } from '@/lib/contracts'
import { ease, fadeIn, stagger } from '@/utils/motion'
import SectionHeading from '@/components/elements/SectionHeading'
import MetricRow from '@/components/elements/MetricRow'
import ErrorBanner from '@/components/elements/ErrorBanner'

export default function CrossChainPage() {
  const { rates, isLoading, error } = useCrossChainRates()

  const divergence = useMemo(() => {
    const validRates = rates.filter((r) => r.rate > 0n).map((r) => Number(r.rate))
    if (validRates.length < 2) return null
    return Math.max(...validRates) - Math.min(...validRates)
  }, [rates])

  return (
    <main className="mx-auto max-w-5xl px-6 pb-16 pt-10">
      <motion.div {...fadeIn}>
        <SectionHeading title="Cross-Chain Rates" />
        <p
          className="mb-8 max-w-xl text-[0.9375rem] leading-relaxed"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          DeBOR benchmark rates relayed from Sepolia to L2 chains via Chainlink
          CCIP. Same data, available everywhere.
        </p>
      </motion.div>

      {divergence !== null && !isLoading && (
        <motion.div {...fadeIn} transition={{ duration: 0.18, ease, delay: 0.04 }}>
          <div className="mb-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl px-5 py-4" style={{ background: 'var(--color-surface)' }}>
              <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>Max rate divergence</div>
              <div className="mt-1 text-lg font-semibold tabular-nums" style={{ color: divergence > 50 ? 'var(--color-accent-pink)' : 'var(--color-text-primary)' }}>
                {divergence} bps
              </div>
            </div>
            <div className="rounded-xl px-5 py-4" style={{ background: 'var(--color-surface)' }}>
              <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>Active destinations</div>
              <div className="mt-1 text-lg font-semibold tabular-nums" style={{ color: 'var(--color-text-primary)' }}>
                {rates.filter((r) => r.rate > 0n).length} chains
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {error && <ErrorBanner />}

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl p-5"
              style={{ background: 'var(--color-card)', boxShadow: '0 0 0 1px var(--color-border-subtle)' }}
            >
              <div className="h-4 w-28 rounded" style={{ background: 'var(--color-surface)' }} />
              <div className="mt-3 h-8 w-20 rounded" style={{ background: 'var(--color-surface)' }} />
            </div>
          ))}
        </div>
      ) : rates.length === 0 ? (
        <div
          className="rounded-xl py-12 text-center text-sm"
          style={{ color: 'var(--color-text-tertiary)', background: 'var(--color-surface)' }}
        >
          No cross-chain data available. Connect to Sepolia to view rates.
        </div>
      ) : (
        <div className="space-y-3">
          {rates.map((rate, i) => (
            <motion.div key={rate.chain} {...stagger(i)}>
              <ChainCard rate={rate} isOrigin={i === 0} />
            </motion.div>
          ))}
        </div>
      )}

      <motion.div {...fadeIn} transition={{ duration: 0.18, ease, delay: 0.25 }}>
        <div className="mt-16">
          <SectionHeading title="CCIP Infrastructure" />
          <div className="mt-6 rounded-xl p-5" style={{ background: 'var(--color-card)', border: '1px solid var(--color-border-medium)' }}>
            <div className="mb-4">
              <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>CCIP Sender (Sepolia)</div>
              <div className="mt-1 font-mono text-sm" style={{ color: 'var(--color-text-primary)' }}>
                {CCIP_SENDER_ADDRESS}
              </div>
            </div>

            <div
              className="border-t pt-4"
              style={{ borderColor: 'var(--color-border-subtle)' }}
            >
              <div className="mb-3 text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                Active destinations
              </div>
              <div className="space-y-2">
                {(Object.keys(CCIP_RECEIVERS) as (keyof typeof CCIP_RECEIVERS)[]).map((chain) => (
                  <div key={chain} className="flex items-center justify-between">
                    <span className="text-sm" style={{ color: 'var(--color-text-primary)' }}>{chain}</span>
                    <a
                      href={etherscanLink(CCIP_RECEIVERS[chain].address)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-xs transition-colors duration-100"
                      style={{ color: 'var(--color-accent-pink)' }}
                    >
                      {shortenAddress(CCIP_RECEIVERS[chain].address)}
                    </a>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </main>
  )
}

function ChainCard({ rate, isOrigin }: { rate: CrossChainRate; isOrigin: boolean }) {
  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: 'var(--color-card)',
        boxShadow: '0 0 0 1px var(--color-border-subtle), 0 4px 16px rgba(0,0,0,0.06)',
      }}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            {rate.chain}
          </span>
          {isOrigin && (
            <span
              className="rounded-full px-2 py-0.5 text-xs font-medium"
              style={{ background: 'var(--color-accent-pink-bg)', color: 'var(--color-accent-pink)' }}
            >
              Source
            </span>
          )}
          {rate.updated > 0n && (
            <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              {timeAgo(rate.updated)}
            </span>
          )}
        </div>
        <div className="text-right">
          <div className="text-xl font-semibold tabular-nums tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
            {rate.rate > 0n ? formatBps(rate.rate) : '--'}
          </div>
          <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>borrow rate</div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <MetricRow label="Supply" value={rate.supply > 0n ? formatBps(rate.supply) : '--'} />
        <MetricRow label="Spread" value={rate.spread > 0n ? formatBps(rate.spread) : '--'} />
        <MetricRow label="Volatility" value={rate.vol > 0n ? String(Number(rate.vol)) : '--'} />
        <MetricRow
          label="Sources"
          value={rate.sources > 0n ? `${Number(rate.sources)}/${Number(rate.configured)}` : '--'}
        />
        {!isOrigin && rate.updated > 0n && (
          <RelayLagMetric updated={rate.updated} />
        )}
      </div>

      {rate.riskLevel !== null && (
        <div
          className="mt-3 flex items-center gap-4 border-t pt-3"
          style={{ borderColor: 'var(--color-border-subtle)' }}
        >
          <RiskLevelBadge level={rate.riskLevel} />
          {rate.cbActive && (
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: '#ef4444' }} />
              <span className="text-xs font-medium" style={{ color: '#991b1b' }}>CB Active</span>
            </div>
          )}
          {rate.riskScore !== null && (
            <div className="ml-auto flex items-center gap-1.5">
              <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>Risk</span>
              <span
                className="rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums"
                style={{
                  background: riskScoreColor(rate.riskScore).bg,
                  color: riskScoreColor(rate.riskScore).fg,
                }}
              >
                {rate.riskScore}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const RISK_LABELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const
const RISK_COLORS = [
  { bg: 'rgba(34,197,94,0.08)', fg: '#166534' },
  { bg: 'rgba(59,130,246,0.08)', fg: '#1e40af' },
  { bg: 'rgba(245,158,11,0.08)', fg: '#92400e' },
  { bg: 'rgba(239,68,68,0.12)', fg: '#7f1d1d' },
]

function RiskLevelBadge({ level }: { level: number }) {
  const c = RISK_COLORS[level] ?? RISK_COLORS[0]
  return (
    <span
      className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
      style={{ background: c.bg, color: c.fg }}
    >
      {RISK_LABELS[level] ?? 'UNKNOWN'}
    </span>
  )
}

function riskScoreColor(score: number) {
  if (score <= 25) return { bg: 'rgba(34,197,94,0.08)', fg: '#166534' }
  if (score <= 50) return { bg: 'rgba(59,130,246,0.08)', fg: '#1e40af' }
  if (score <= 75) return { bg: 'rgba(245,158,11,0.08)', fg: '#92400e' }
  return { bg: 'rgba(239,68,68,0.12)', fg: '#7f1d1d' }
}

function RelayLagMetric({ updated }: { updated: bigint }) {
  const now = Math.floor(Date.now() / 1000)
  const lag = now - Number(updated)
  const isStale = lag > 3600 // >1hr
  return (
    <div>
      <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>Relay lag</div>
      <div
        className="text-sm font-medium tabular-nums"
        style={{ color: isStale ? '#991b1b' : 'var(--color-text-primary)' }}
      >
        {formatTimeRemaining(lag)}
      </div>
    </div>
  )
}

