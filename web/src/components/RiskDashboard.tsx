import { useState } from 'react'
import { motion } from 'motion/react'
import { useConsumerData, useStressTest } from '@/hooks/useConsumerData'
import { useOracleData } from '@/hooks/useOracleData'
import { useRiskMetrics } from '@/hooks/useRiskMetrics'
import { useCircuitBreaker } from '@/hooks/useCircuitBreaker'
import { formatBps, formatEthValue, timeAgo, shortenAddress, etherscanLink } from '@/utils/format'
import { parseEther } from 'viem'
import type { HHIMetrics, RiskBreakdown, StressResult } from '@/utils/risk'
import { ease, fadeIn, stagger } from '@/utils/motion'
import SectionHeading from '@/components/elements/SectionHeading'
import SkeletonCard from '@/components/elements/SkeletonCard'
import CSVButton from '@/components/elements/CSVButton'
import ErrorBanner from '@/components/elements/ErrorBanner'
import { ORACLE_ADDRESSES, CONSUMER_ADDRESS } from '@/lib/contracts'

const REGIME_CONFIG: Record<string, { bg: string; fg: string }> = {
  STABLE: { bg: 'rgba(34,197,94,0.08)', fg: '#166534' },
  NORMAL: { bg: 'rgba(59,130,246,0.08)', fg: '#1e40af' },
  VOLATILE: { bg: 'rgba(245,158,11,0.08)', fg: '#92400e' },
  CRISIS: { bg: 'rgba(239,68,68,0.08)', fg: '#991b1b' },
}

function riskColor(score: number): string {
  if (score <= 25) return '#166534'
  if (score <= 50) return '#92400e'
  if (score <= 75) return '#c2410c'
  return '#991b1b'
}

function riskLabel(score: number): string {
  if (score <= 25) return 'Low'
  if (score <= 50) return 'Moderate'
  if (score <= 75) return 'Elevated'
  return 'High'
}

function varColor(bps: number): string {
  if (bps < 50) return '#166534'
  if (bps < 100) return '#92400e'
  return '#991b1b'
}

export default function RiskDashboard() {
  const { consumer, isLoading, error } = useConsumerData()
  const { benchmarks } = useOracleData()
  const { metrics } = useRiskMetrics()
  const { statuses: cbStatuses, anyActive: cbAnyActive } = useCircuitBreaker()
  const usdcBenchmark = benchmarks.find((b) => b.asset === 'USDC')

  return (
    <main className="mx-auto max-w-5xl px-6 pb-16 pt-10">
      <motion.div {...fadeIn}>
        <SectionHeading title="Risk Dashboard" />
        <p
          className="mb-8 max-w-xl text-[0.9375rem] leading-relaxed"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          Adaptive lending risk metrics from the DeBOR consumer contract.
          Risk score, market regime, and dynamic collateral requirements
          computed on-chain from live oracle data.
        </p>
      </motion.div>

      {/* Circuit Breaker Status */}
      <motion.div {...fadeIn} transition={{ duration: 0.18, ease, delay: 0.05 }}>
        <div className="mb-8">
          <div className="mb-4 flex items-center gap-4">
            <h2
              className="whitespace-nowrap text-base font-semibold"
              style={{ color: 'var(--color-text-primary)' }}
            >
              Circuit Breaker
            </h2>
            <span
              className="shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold"
              style={{
                background: cbAnyActive ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.08)',
                color: cbAnyActive ? '#991b1b' : '#166534',
              }}
            >
              {cbAnyActive ? 'Active' : 'All clear'}
            </span>
            <div
              className="flex-1"
              style={{ borderTop: '1px dashed var(--color-accent-green)' }}
            />
          </div>
          <div className="flex flex-wrap gap-2.5">
            {cbStatuses.map((cb) => (
              <div
                key={cb.asset}
                className="flex items-center gap-2.5 rounded-lg px-3.5 py-2"
                style={{
                  background: cb.active ? 'rgba(239,68,68,0.04)' : 'var(--color-card)',
                  boxShadow: cb.active
                    ? '0 0 0 1px rgba(239,68,68,0.2)'
                    : '0 0 0 1px var(--color-border-subtle)',
                }}
              >
                <span
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ background: cb.active ? '#ef4444' : '#22c55e' }}
                />
                <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                  {cb.asset}
                </span>
                {cb.active ? (
                  <span className="text-xs font-medium" style={{ color: '#991b1b' }}>
                    {cb.riskLabel}
                    {cb.lastTrip > 0n && ` · ${timeAgo(cb.lastTrip)}`}
                  </span>
                ) : (
                  <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                    Nominal
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </motion.div>

      {error && <ErrorBanner />}

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} rows={2} />
          ))}
        </div>
      ) : consumer ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <motion.div {...stagger(0)}>
              <RiskScoreCard score={consumer.riskScore} />
            </motion.div>
            <motion.div {...stagger(1)}>
              <RegimeCard regime={consumer.regime} />
            </motion.div>
            <motion.div {...stagger(2)}>
              <BorrowRateCard
                adaptiveRate={consumer.borrowRateBps}
                rawRate={usdcBenchmark?.data ? Number(usdcBenchmark.data.rate) : null}
              />
            </motion.div>
            <motion.div {...stagger(3)}>
              <CollateralCard ratioBps={consumer.collateralRatioBps} />
            </motion.div>
            <motion.div {...stagger(4)}>
              <DiversityCard diversityBps={consumer.diversityBps} />
            </motion.div>
            <motion.div {...stagger(5)}>
              <VolatilityCard vol={usdcBenchmark?.data ? Number(usdcBenchmark.data.vol) : null} />
            </motion.div>
          </div>

          {/* Data Sources */}
          <motion.div {...fadeIn} transition={{ duration: 0.18, ease, delay: 0.22 }}>
            <div
              className="mt-6 rounded-xl px-5 py-4"
              style={{ background: 'var(--color-surface)' }}
            >
              <div className="mb-2 text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
                Data sources
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-1.5">
                <DataSourceLink label="Consumer" address={CONSUMER_ADDRESS} />
                <DataSourceLink label="USDC Oracle" address={ORACLE_ADDRESSES.USDC} />
              </div>
            </div>
          </motion.div>

          {/* VaR / CVaR Analytics */}
          {metrics && (
            <motion.div {...fadeIn} transition={{ duration: 0.18, ease, delay: 0.25 }}>
              <div className="mt-16">
                <SectionHeading title="Value-at-Risk Analytics" />
                <p
                  className="mb-6 max-w-xl text-[0.9375rem] leading-relaxed"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  VaR and CVaR computed from on-chain volatility data using standard
                  parametric models. Annualized over 17,520 periods/year.
                </p>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <VaRCard label="VaR 95%" bps={metrics.var.var95} />
                  <VaRCard label="VaR 99%" bps={metrics.var.var99} />
                  <VaRCard label="CVaR 95%" bps={metrics.var.cvar95} />
                  <VaRCard label="CVaR 99%" bps={metrics.var.cvar99} />
                </div>
                <div className="mt-4">
                  <AnnualizedVolCard vol={metrics.var.annualizedVol} />
                </div>
              </div>
            </motion.div>
          )}

          {/* HHI Concentration */}
          {metrics && (
            <motion.div {...fadeIn} transition={{ duration: 0.18, ease, delay: 0.3 }}>
              <div className="mt-16">
                <SectionHeading title="Protocol Concentration (HHI)" />
                <HHICard hhi={metrics.hhi} />
              </div>
            </motion.div>
          )}

          {/* Basel Stress Tests */}
          {metrics && (
            <motion.div {...fadeIn} transition={{ duration: 0.18, ease, delay: 0.35 }}>
              <div className="mt-16">
                <div className="flex items-center justify-between">
                  <SectionHeading title="Basel IRRBB Stress Tests" />
                  <CSVButton
                    headers={['Scenario', 'Shocked Rate (bps)', 'Impact (bps)', 'Breaches VaR']}
                    rows={metrics.stressResults.map((r) => [r.name, r.shockedRate, r.impactBps, r.breachesVaR ? 'Yes' : 'No'])}
                    filename="debor-stress-tests"
                  />
                </div>
                <p
                  className="mb-6 max-w-xl text-[0.9375rem] leading-relaxed"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  Standard interest rate shock scenarios per Basel Committee guidelines,
                  plus DeFi-specific stress events.
                </p>
                <StressTable results={metrics.stressResults} var99={metrics.var.var99} />
              </div>
            </motion.div>
          )}

          {/* Risk Breakdown */}
          {metrics && (
            <motion.div {...fadeIn} transition={{ duration: 0.18, ease, delay: 0.4 }}>
              <div className="mt-16">
                <SectionHeading title="Composite Risk Breakdown" />
                <RiskBreakdownTable breakdown={metrics.breakdown} var99={metrics.var.var99} hhi={metrics.hhi.hhi} sofrSpread={metrics.sofrSpreadBps} vol={usdcBenchmark?.data ? Number(usdcBenchmark.data.vol) : 0} />
              </div>
            </motion.div>
          )}

          {/* Custom Stress Test */}
          <motion.div {...fadeIn} transition={{ duration: 0.18, ease, delay: 0.45 }}>
            <div className="mt-16">
              <SectionHeading title="Custom Stress Test" />
              <p
                className="mb-6 max-w-xl text-[0.9375rem] leading-relaxed"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                Test the impact of rate shocks on a hypothetical swap position.
                Results computed on-chain by the AdaptiveLending consumer.
              </p>
              <StressTestForm />
            </div>
          </motion.div>
        </>
      ) : (
        <motion.div {...fadeIn}>
          <div
            className="rounded-xl py-12 text-center text-sm"
            style={{ color: 'var(--color-text-tertiary)', background: 'var(--color-surface)' }}
          >
            Unable to load consumer data. Connect to Sepolia to view risk metrics.
          </div>
        </motion.div>
      )}
    </main>
  )
}

// --- On-chain cards (existing) ---

function RiskScoreCard({ score }: { score: number }) {
  const color = riskColor(score)
  const label = riskLabel(score)
  const pct = Math.min(score, 100)

  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: 'var(--color-card)',
        boxShadow: '0 0 0 1px var(--color-border-subtle), 0 4px 16px rgba(0,0,0,0.06)',
      }}
    >
      <div className="mb-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
        Risk Score
      </div>
      <div className="flex items-end gap-3">
        <span className="text-3xl font-semibold tabular-nums tracking-tight" style={{ color }}>
          {score}
        </span>
        <span className="mb-1 text-sm font-medium" style={{ color }}>
          {label}
        </span>
      </div>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--color-surface)' }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <div className="mt-2 flex justify-between text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
        <span>0</span>
        <span>100</span>
      </div>
    </div>
  )
}

function RegimeCard({ regime }: { regime: string }) {
  const config = REGIME_CONFIG[regime] || REGIME_CONFIG.NORMAL
  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: 'var(--color-card)',
        boxShadow: '0 0 0 1px var(--color-border-subtle), 0 4px 16px rgba(0,0,0,0.06)',
      }}
    >
      <div className="mb-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
        Market Regime
      </div>
      <div className="flex items-center gap-3">
        <span
          className="rounded-full px-3 py-1 text-sm font-semibold"
          style={{ background: config.bg, color: config.fg }}
        >
          {regime}
        </span>
      </div>
      <div className="mt-3 text-xs leading-relaxed" style={{ color: 'var(--color-text-tertiary)' }}>
        {regime === 'STABLE' && 'Volatility < 500 — low risk environment'}
        {regime === 'NORMAL' && 'Volatility 500–2000 — standard market conditions'}
        {regime === 'VOLATILE' && 'Volatility 2000–5000 — elevated risk'}
        {regime === 'CRISIS' && 'Volatility > 5000 — extreme market stress'}
      </div>
    </div>
  )
}

function BorrowRateCard({ adaptiveRate, rawRate }: { adaptiveRate: number; rawRate: number | null }) {
  const spread = rawRate !== null ? adaptiveRate - rawRate : null
  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: 'var(--color-card)',
        boxShadow: '0 0 0 1px var(--color-border-subtle), 0 4px 16px rgba(0,0,0,0.06)',
      }}
    >
      <div className="mb-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
        Adaptive Borrow Rate
      </div>
      <div className="text-2xl font-semibold tabular-nums tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
        {formatBps(adaptiveRate)}
      </div>
      {rawRate !== null && (
        <div className="mt-2 space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span style={{ color: 'var(--color-text-secondary)' }}>Raw DeBOR rate</span>
            <span className="tabular-nums" style={{ color: 'var(--color-text-primary)' }}>{formatBps(rawRate)}</span>
          </div>
          {spread !== null && (
            <div className="flex items-center justify-between text-xs">
              <span style={{ color: 'var(--color-text-secondary)' }}>Risk premium</span>
              <span className="tabular-nums" style={{ color: 'var(--color-accent-pink)' }}>
                +{formatBps(spread)}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function CollateralCard({ ratioBps }: { ratioBps: number }) {
  const pct = (ratioBps / 100).toFixed(0)
  const isElevated = ratioBps > 15000
  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: 'var(--color-card)',
        boxShadow: '0 0 0 1px var(--color-border-subtle), 0 4px 16px rgba(0,0,0,0.06)',
      }}
    >
      <div className="mb-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
        Collateral Ratio
      </div>
      <div className="flex items-end gap-2">
        <span className="text-2xl font-semibold tabular-nums tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
          {pct}%
        </span>
        {isElevated && (
          <span className="mb-1 text-xs" style={{ color: 'var(--color-accent-pink)' }}>
            above 150% base
          </span>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between text-xs">
        <span style={{ color: 'var(--color-text-secondary)' }}>Static base</span>
        <span className="tabular-nums" style={{ color: 'var(--color-text-primary)' }}>150%</span>
      </div>
    </div>
  )
}

function DiversityCard({ diversityBps }: { diversityBps: number }) {
  const pct = Math.round(diversityBps / 100)
  const isHealthy = diversityBps >= 8000
  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: 'var(--color-card)',
        boxShadow: '0 0 0 1px var(--color-border-subtle), 0 4px 16px rgba(0,0,0,0.06)',
      }}
    >
      <div className="mb-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
        Source Diversity
      </div>
      <div className="text-2xl font-semibold tabular-nums tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
        {pct}%
      </div>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--color-surface)' }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            background: isHealthy ? '#22c55e' : '#f59e0b',
          }}
        />
      </div>
      <div className="mt-2 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
        {isHealthy ? 'Healthy — sufficient source coverage' : 'Degraded — some sources offline'}
      </div>
    </div>
  )
}

function VolatilityCard({ vol }: { vol: number | null }) {
  if (vol === null) return null
  const level = vol < 500 ? 'Low' : vol < 2000 ? 'Normal' : vol < 5000 ? 'High' : 'Extreme'
  const color = vol < 500 ? '#166534' : vol < 2000 ? '#1e40af' : vol < 5000 ? '#c2410c' : '#991b1b'
  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: 'var(--color-card)',
        boxShadow: '0 0 0 1px var(--color-border-subtle), 0 4px 16px rgba(0,0,0,0.06)',
      }}
    >
      <div className="mb-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
        Rate Volatility
      </div>
      <div className="flex items-end gap-2">
        <span className="text-2xl font-semibold tabular-nums tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
          {vol}
        </span>
        <span className="mb-1 text-xs font-medium" style={{ color }}>{level}</span>
      </div>
      <div className="mt-2 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
        bps standard deviation
      </div>
    </div>
  )
}

// --- New VaR/CVaR cards ---

function VaRCard({ label, bps }: { label: string; bps: number }) {
  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: 'var(--color-card)',
        boxShadow: '0 0 0 1px var(--color-border-subtle), 0 4px 16px rgba(0,0,0,0.06)',
      }}
    >
      <div className="mb-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
        {label}
      </div>
      <div className="text-2xl font-semibold tabular-nums tracking-tight" style={{ color: varColor(bps) }}>
        {bps} bps
      </div>
    </div>
  )
}

function AnnualizedVolCard({ vol }: { vol: number }) {
  return (
    <div
      className="rounded-xl px-5 py-4"
      style={{ background: 'var(--color-surface)' }}
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>Annualized Volatility</div>
          <div className="mt-1 text-lg font-semibold tabular-nums" style={{ color: 'var(--color-text-primary)' }}>
            {vol.toLocaleString()} bps
          </div>
        </div>
        <div className="text-right text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
          Based on 30-min observations,<br />annualized over 17,520 periods/year
        </div>
      </div>
    </div>
  )
}

// --- HHI card ---

function HHICard({ hhi }: { hhi: HHIMetrics }) {
  const barPct = Math.min(hhi.hhi * 100, 100)
  const barColor = hhi.level === 'LOW' ? '#166534' : hhi.level === 'MODERATE' ? '#92400e' : '#991b1b'

  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: 'var(--color-card)',
        boxShadow: '0 0 0 1px var(--color-border-subtle), 0 4px 16px rgba(0,0,0,0.06)',
      }}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-end gap-2">
            <span className="text-2xl font-semibold tabular-nums tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
              {hhi.hhi.toFixed(4)}
            </span>
            <span
              className="mb-0.5 rounded-full px-2 py-0.5 text-xs font-semibold"
              style={{
                background: hhi.level === 'LOW' ? 'rgba(34,197,94,0.08)' : hhi.level === 'MODERATE' ? 'rgba(245,158,11,0.08)' : 'rgba(239,68,68,0.08)',
                color: barColor,
              }}
            >
              {hhi.level}
            </span>
          </div>
          <div className="mt-2 space-y-1 text-xs">
            <div className="flex items-center gap-4">
              <span style={{ color: 'var(--color-text-secondary)' }}>
                Effective sources: <span className="tabular-nums font-medium" style={{ color: 'var(--color-text-primary)' }}>{hhi.effectiveSources}</span>
              </span>
              <span style={{ color: 'var(--color-text-secondary)' }}>
                Max weight: <span className="tabular-nums font-medium" style={{ color: 'var(--color-text-primary)' }}>{(hhi.maxWeight * 100).toFixed(1)}% ({hhi.maxProtocol})</span>
              </span>
            </div>
          </div>
        </div>
      </div>
      <div className="mt-4">
        <div className="relative h-2 w-full overflow-hidden rounded-full" style={{ background: 'var(--color-surface)' }}>
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${barPct}%`, background: barColor }}
          />
          {/* Threshold markers */}
          <div className="absolute top-0 h-full w-px" style={{ left: '15%', background: 'rgba(0,0,0,0.15)' }} />
          <div className="absolute top-0 h-full w-px" style={{ left: '25%', background: 'rgba(0,0,0,0.15)' }} />
        </div>
        <div className="mt-1.5 flex justify-between text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
          <span>0</span>
          <span style={{ position: 'relative', left: '-35%' }}>0.15</span>
          <span style={{ position: 'relative', left: '-25%' }}>0.25</span>
          <span>1.0</span>
        </div>
      </div>
    </div>
  )
}

// --- Basel stress table ---

function StressTable({ results, var99 }: { results: StressResult[]; var99: number }) {
  return (
    <div
      className="overflow-x-auto rounded-xl"
      style={{
        background: 'var(--color-card)',
        boxShadow: '0 0 0 1px var(--color-border-subtle), 0 4px 16px rgba(0,0,0,0.06)',
      }}
    >
      <table className="w-full" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {['Scenario', 'Shocked Rate', 'Impact', 'Breaches VaR?'].map((h) => (
              <th
                key={h}
                className="px-5 py-3 text-left text-xs font-semibold"
                style={{ color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border-subtle)' }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {results.map((r) => (
            <tr key={r.name}>
              <td className="px-5 py-3 text-sm" style={{ color: 'var(--color-text-primary)', borderBottom: '1px solid var(--color-border-subtle)' }}>
                {r.name}
              </td>
              <td className="px-5 py-3 text-sm tabular-nums" style={{ color: 'var(--color-text-primary)', borderBottom: '1px solid var(--color-border-subtle)' }}>
                {formatBps(r.shockedRate)}
              </td>
              <td
                className="px-5 py-3 text-sm font-medium tabular-nums"
                style={{
                  color: r.impactBps >= 0 ? '#166534' : '#991b1b',
                  borderBottom: '1px solid var(--color-border-subtle)',
                }}
              >
                {r.impactBps >= 0 ? '+' : ''}{r.impactBps} bps
              </td>
              <td className="px-5 py-3" style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ background: r.breachesVaR ? '#991b1b' : '#166534' }}
                  />
                  <span className="text-sm" style={{ color: r.breachesVaR ? '#991b1b' : '#166534' }}>
                    {r.breachesVaR ? 'Yes' : 'No'}
                  </span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-5 py-3 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
        VaR 99% threshold: {var99} bps
      </div>
    </div>
  )
}

// --- Risk breakdown table ---

function RiskBreakdownTable({
  breakdown,
  var99,
  hhi,
  sofrSpread,
  vol,
}: {
  breakdown: RiskBreakdown
  var99: number
  hhi: number
  sofrSpread: number
  vol: number
}) {
  const classColor = breakdown.classification === 'LOW' ? '#166534' : breakdown.classification === 'MEDIUM' ? '#92400e' : breakdown.classification === 'HIGH' ? '#c2410c' : '#991b1b'

  const rows = [
    { component: 'VaR (99%)', value: `${var99} bps`, score: breakdown.varScore, max: 30, threshold: '200+' },
    { component: 'Concentration', value: hhi.toFixed(4), score: breakdown.hhiScore, max: 25, threshold: '0.25+' },
    { component: 'Source Uptime', value: '-', score: breakdown.uptimeScore, max: 20, threshold: '<50%' },
    { component: 'SOFR Spread', value: `${sofrSpread >= 0 ? '+' : ''}${sofrSpread} bps`, score: breakdown.sofrScore, max: 15, threshold: '200+' },
    { component: 'Protocol Vol', value: String(vol), score: breakdown.volScore, max: 10, threshold: '5000+' },
  ]

  return (
    <div
      className="overflow-x-auto rounded-xl"
      style={{
        background: 'var(--color-card)',
        boxShadow: '0 0 0 1px var(--color-border-subtle), 0 4px 16px rgba(0,0,0,0.06)',
      }}
    >
      <table className="w-full" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {['Component', 'Value', 'Score', 'Max', 'Trigger'].map((h) => (
              <th
                key={h}
                className="px-5 py-3 text-left text-xs font-semibold"
                style={{ color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border-subtle)' }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.component}>
              <td className="px-5 py-3 text-sm" style={{ color: 'var(--color-text-primary)', borderBottom: '1px solid var(--color-border-subtle)' }}>
                {r.component}
              </td>
              <td className="px-5 py-3 text-sm tabular-nums" style={{ color: 'var(--color-text-primary)', borderBottom: '1px solid var(--color-border-subtle)' }}>
                {r.value}
              </td>
              <td className="px-5 py-3 text-sm font-medium tabular-nums" style={{ color: r.score > 0 ? '#92400e' : 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border-subtle)' }}>
                {r.score}/{r.max}
              </td>
              <td className="px-5 py-3 text-sm tabular-nums" style={{ color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border-subtle)' }}>
                {r.max}
              </td>
              <td className="px-5 py-3 text-xs" style={{ color: 'var(--color-text-tertiary)', borderBottom: '1px solid var(--color-border-subtle)' }}>
                {r.threshold}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center justify-between px-5 py-3">
        <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          Total: {breakdown.total}/100
        </span>
        <span
          className="rounded-full px-2 py-0.5 text-xs font-semibold"
          style={{
            background: breakdown.classification === 'LOW' ? 'rgba(34,197,94,0.08)' : breakdown.classification === 'MEDIUM' ? 'rgba(245,158,11,0.08)' : 'rgba(239,68,68,0.08)',
            color: classColor,
          }}
        >
          {breakdown.classification}
        </span>
      </div>
    </div>
  )
}

function DataSourceLink({ label, address }: { label: string; address: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span style={{ color: 'var(--color-text-tertiary)' }}>{label}:</span>
      <a
        href={etherscanLink(address)}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono transition-colors duration-100"
        style={{ color: 'var(--color-accent-pink)' }}
      >
        {shortenAddress(address)}
      </a>
    </span>
  )
}

// --- Custom stress test form (existing) ---

function StressTestForm() {
  const [fixedRate, setFixedRate] = useState('500')
  const [notional, setNotional] = useState('0.1')
  const [shock, setShock] = useState('200')
  const [submitted, setSubmitted] = useState(false)

  const notionalWei = (() => {
    try { return parseEther(notional || '0') } catch { return 0n }
  })()

  const { pnlImpact, isLoading } = useStressTest(
    submitted ? Number(fixedRate) : 0,
    submitted ? notionalWei : 0n,
    submitted ? Number(shock) : 0,
  )

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
  }

  return (
    <div
      className="rounded-xl p-5"
      style={{ background: 'var(--color-card)', border: '1px solid var(--color-border-medium)' }}
    >
      <form onSubmit={handleSubmit}>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              Fixed rate (bps)
            </label>
            <input
              type="number"
              value={fixedRate}
              onChange={(e) => { setFixedRate(e.target.value); setSubmitted(false) }}
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
              style={{ borderColor: 'rgba(0,0,0,0.12)', background: 'transparent', color: 'var(--color-text-primary)' }}
              min={1}
              required
            />
            <div className="mt-1 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              = {formatBps(Number(fixedRate) || 0)} APR
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              Notional (ETH)
            </label>
            <input
              type="text"
              value={notional}
              onChange={(e) => { setNotional(e.target.value); setSubmitted(false) }}
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
              style={{ borderColor: 'rgba(0,0,0,0.12)', background: 'transparent', color: 'var(--color-text-primary)' }}
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              Rate shock (bps)
            </label>
            <input
              type="number"
              value={shock}
              onChange={(e) => { setShock(e.target.value); setSubmitted(false) }}
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
              style={{ borderColor: 'rgba(0,0,0,0.12)', background: 'transparent', color: 'var(--color-text-primary)' }}
              required
            />
            <div className="mt-1 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              +/- {formatBps(Math.abs(Number(shock) || 0))} shock
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-center gap-4">
          <button
            type="submit"
            className="rounded-lg px-4 py-2 text-sm font-medium transition-opacity duration-100 hover:opacity-85"
            style={{ background: 'var(--color-text-primary)', color: 'var(--color-page)' }}
          >
            Run stress test
          </button>

          {submitted && pnlImpact !== null && !isLoading && (
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>P&L Impact:</span>
              <span
                className="text-sm font-semibold tabular-nums"
                style={{ color: pnlImpact >= 0n ? '#166534' : '#991b1b' }}
              >
                {pnlImpact >= 0n ? '+' : ''}{formatEthValue(pnlImpact < 0n ? -pnlImpact : pnlImpact)} ETH
                {pnlImpact < 0n && ' (loss)'}
              </span>
            </div>
          )}
          {submitted && isLoading && (
            <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Computing...</span>
          )}
        </div>
      </form>
    </div>
  )
}

