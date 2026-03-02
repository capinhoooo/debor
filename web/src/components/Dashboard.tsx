import { Link } from '@tanstack/react-router'
import { motion } from 'motion/react'
import { useOracleData, type AssetBenchmark } from '@/hooks/useOracleData'
import { useSparklineData } from '@/hooks/useSparklineData'
import { useCircuitBreaker } from '@/hooks/useCircuitBreaker'
import { formatBps, timeAgo } from '@/utils/format'
import { cnm } from '@/utils/style'
import type { AssetKey } from '@/lib/contracts'
import { ease, fadeIn, stagger } from '@/utils/motion'
import SectionHeading from '@/components/elements/SectionHeading'
import MetricRow from '@/components/elements/MetricRow'
import SkeletonCard from '@/components/elements/SkeletonCard'
import RateChart from './RateChart'
import Sparkline from './Sparkline'
import ErrorBanner from '@/components/elements/ErrorBanner'

export default function Dashboard() {
  const { benchmarks, isLoading, error, refetch } = useOracleData()
  const { sparklines } = useSparklineData()
  const { statuses: cbStatuses, anyActive: cbAnyActive } = useCircuitBreaker()

  return (
    <main className="mx-auto max-w-5xl px-6 pb-16 pt-10">
      <motion.div {...fadeIn}>
        <SectionHeading title="Benchmark Rates" />
        <p
          className="mb-8 max-w-xl text-[0.9375rem] leading-relaxed"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          Live TVL-weighted benchmark rates across five assets, aggregated from
          major DeFi lending protocols via Chainlink CRE.
        </p>
      </motion.div>

      {error && <ErrorBanner onRetry={refetch} />}

      {/* Circuit breaker status */}
      {cbStatuses.some((s) => s.active || s.riskLevel >= 2) && (
        <motion.div {...fadeIn} transition={{ duration: 0.18, ease, delay: 0.02 }}>
          <div
            className="mb-6 rounded-xl p-4"
            style={{
              background: cbAnyActive ? 'rgba(239,68,68,0.06)' : 'rgba(245,158,11,0.06)',
              border: `1px solid ${cbAnyActive ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.15)'}`,
            }}
          >
            <div className="mb-2 flex items-center gap-2">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: cbAnyActive ? '#ef4444' : '#f59e0b' }}
              />
              <span
                className="text-sm font-medium"
                style={{ color: cbAnyActive ? '#991b1b' : '#92400e' }}
              >
                {cbAnyActive ? 'Circuit Breaker Active' : 'Elevated Risk Detected'}
              </span>
            </div>
            <div className="flex flex-wrap gap-3">
              {cbStatuses.filter((s) => s.active || s.riskLevel >= 2).map((s) => (
                <span
                  key={s.asset}
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
                  style={{
                    background: s.active ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)',
                    color: s.active ? '#991b1b' : '#92400e',
                  }}
                >
                  {s.asset}
                  <span style={{ color: s.active ? '#ef4444' : '#f59e0b' }}>{s.riskLabel}</span>
                </span>
              ))}
            </div>
            <p
              className="mt-2 text-xs leading-relaxed"
              style={{ color: cbAnyActive ? '#991b1b' : '#92400e', opacity: 0.8 }}
            >
              AI risk analysis has flagged elevated conditions. Swap settlement is paused for affected assets.
            </p>
          </div>
        </motion.div>
      )}

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {benchmarks.map((b, i) => {
            const cb = cbStatuses.find((s) => s.asset === b.asset)
            return (
              <motion.div key={b.asset} {...stagger(i)}>
                <Link to="/asset/$symbol" params={{ symbol: b.asset.toLowerCase() }} className="block">
                  <RateCard benchmark={b} sparklineRates={sparklines[b.asset as AssetKey]} cbStatus={cb} />
                </Link>
              </motion.div>
            )
          })}
        </div>
      )}

      <motion.div {...fadeIn} transition={{ duration: 0.18, ease, delay: 0.25 }}>
        <div className="mt-16">
          <SectionHeading title="Historical Rates" />
          <p
            className="mb-6 max-w-xl text-[0.9375rem] leading-relaxed"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            7-day rate history from the on-chain ring buffer — 336 data points
            at 30-minute intervals.
          </p>
          <RateChart />
        </div>
      </motion.div>

      <motion.div {...fadeIn} transition={{ duration: 0.18, ease, delay: 0.3 }}>
        <div className="mt-16">
          <SectionHeading title="Protocol Overview" />
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <StatCard label="Assets tracked" value="5" />
            <StatCard label="Network" value="Sepolia" />
            <StatCard label="Update frequency" value="30 min" />
          </div>
        </div>
      </motion.div>

      <motion.div {...fadeIn} transition={{ duration: 0.18, ease, delay: 0.4 }}>
        <div className="mt-16">
          <SectionHeading title="How it works" />
          <div className="mt-6 grid gap-6 sm:grid-cols-3">
            <StepCard
              step="1"
              title="Aggregate"
              desc="CRE workflow fetches rates from Aave, Compound, Morpho, and Spark every 30 minutes."
            />
            <StepCard
              step="2"
              title="Compute"
              desc="TVL-weighted benchmark calculated in a confidential TEE environment with anomaly detection."
            />
            <StepCard
              step="3"
              title="Publish"
              desc="Signed reports delivered to on-chain oracles on Sepolia and relayed cross-chain via CCIP."
            />
          </div>
        </div>
      </motion.div>
    </main>
  )
}

function RateCard({ benchmark, sparklineRates, cbStatus }: { benchmark: AssetBenchmark; sparklineRates?: number[]; cbStatus?: { active: boolean; riskLevel: number; riskLabel: string } }) {
  const { asset, data } = benchmark
  const hasData = data !== null
  const hasSparkline = sparklineRates && sparklineRates.some((r) => r > 0)

  return (
    <div
      className="rounded-xl p-5 transition-colors duration-100"
      style={{
        background: 'var(--color-card)',
        boxShadow: '0 0 0 1px var(--color-border-subtle), 0 4px 16px rgba(0,0,0,0.06)',
      }}
    >
      <div className="mb-4 flex items-center justify-between">
        <span className="flex items-center gap-2">
          <span className="text-sm font-semibold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
            {asset}
          </span>
          {cbStatus && cbStatus.riskLevel >= 1 && (
            <span
              className="rounded-full px-1.5 py-0.5 text-[0.625rem] font-semibold leading-none"
              style={{
                background: cbStatus.active ? 'rgba(239,68,68,0.08)' : cbStatus.riskLevel >= 2 ? 'rgba(245,158,11,0.08)' : 'rgba(59,130,246,0.08)',
                color: cbStatus.active ? '#991b1b' : cbStatus.riskLevel >= 2 ? '#92400e' : '#1e40af',
              }}
            >
              {cbStatus.riskLabel}
            </span>
          )}
        </span>
        {hasData && data.updated > 0n && (
          <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            {timeAgo(data.updated)}
          </span>
        )}
      </div>

      {hasData ? (
        <>
          <div className="mb-2">
            <div className="text-2xl font-semibold tabular-nums tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
              {formatBps(data.rate)}
            </div>
            <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              Borrow rate
            </div>
          </div>

          {hasSparkline && (
            <div className="mb-3">
              <Sparkline rates={sparklineRates!} />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <MetricRow label="Supply" value={formatBps(data.supply)} />
            <MetricRow label="Spread" value={formatBps(data.spread)} />
            <MetricRow label="Volatility" value={String(Number(data.vol))} />
            <MetricRow label="7d avg" value={formatBps(data.term7d)} />
            <MetricRow
              label="Sources"
              value={`${Number(data.sources)}/${Number(data.configured)}`}
            />
          </div>
        </>
      ) : (
        <div className="py-6 text-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
          No data yet
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-xl px-5 py-4"
      style={{
        background: 'var(--color-surface)',
      }}
    >
      <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums" style={{ color: 'var(--color-text-primary)' }}>{value}</div>
    </div>
  )
}

function StepCard({ step, title, desc }: { step: string; title: string; desc: string }) {
  return (
    <div className="rounded-xl p-5" style={{ background: 'var(--color-card)', border: '1px solid var(--color-border-medium)' }}>
      <div
        className={cnm(
          'mb-3 flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold',
        )}
        style={{ background: 'var(--color-accent-pink-bg)', color: 'var(--color-accent-pink)' }}
      >
        {step}
      </div>
      <div className="mb-1 text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{title}</div>
      <div className="text-[0.8125rem] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>{desc}</div>
    </div>
  )
}

