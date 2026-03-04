import { motion } from 'motion/react'
import {
  useAIInsightData,
  type RiskLevel,
  type RateDirection,
  type SpreadHealth,
  type MarketRegime,
} from '@/hooks/useAIInsightData'
import { useAIInsightHistory } from '@/hooks/useAIInsightHistory'
import { shortenAddress, etherscanLink } from '@/utils/format'
import { fadeIn, stagger } from '@/utils/motion'
import SectionHeading from '@/components/elements/SectionHeading'
import MetricRow from '@/components/elements/MetricRow'
import SkeletonCard from '@/components/elements/SkeletonCard'
import { AI_INSIGHT_ADDRESS } from '@/lib/contracts'
import ErrorBanner from '@/components/elements/ErrorBanner'

const RISK_COLORS: Record<RiskLevel, { bg: string; fg: string }> = {
  Low: { bg: 'rgba(34,197,94,0.08)', fg: '#166534' },
  Medium: { bg: 'rgba(245,158,11,0.08)', fg: '#92400e' },
  High: { bg: 'rgba(239,68,68,0.08)', fg: '#991b1b' },
  Critical: { bg: 'rgba(239,68,68,0.12)', fg: '#7f1d1d' },
}

const DIRECTION_COLORS: Record<RateDirection, { bg: string; fg: string }> = {
  Stable: { bg: 'rgba(59,130,246,0.08)', fg: '#1e40af' },
  Rising: { bg: 'rgba(34,197,94,0.08)', fg: '#166534' },
  Falling: { bg: 'rgba(239,68,68,0.08)', fg: '#991b1b' },
}

const SPREAD_COLORS: Record<SpreadHealth, { bg: string; fg: string }> = {
  Normal: { bg: 'rgba(34,197,94,0.08)', fg: '#166534' },
  Compressed: { bg: 'rgba(245,158,11,0.08)', fg: '#92400e' },
  Inverted: { bg: 'rgba(239,68,68,0.08)', fg: '#991b1b' },
}

const REGIME_COLORS: Record<MarketRegime, { bg: string; fg: string }> = {
  Converged: { bg: 'rgba(34,197,94,0.08)', fg: '#166534' },
  Normal: { bg: 'rgba(59,130,246,0.08)', fg: '#1e40af' },
  Diverged: { bg: 'rgba(245,158,11,0.08)', fg: '#92400e' },
  Dislocated: { bg: 'rgba(239,68,68,0.08)', fg: '#991b1b' },
}

function riskScoreColor(score: number): string {
  if (score <= 25) return '#166534'
  if (score <= 50) return '#1e40af'
  if (score <= 75) return '#92400e'
  return '#991b1b'
}

function formatTimestamp(ts: number): string {
  if (ts === 0) return 'Never'
  const date = new Date(ts * 1000)
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function AIInsightPage() {
  const { insight, isLoading, error } = useAIInsightData()
  const { history } = useAIInsightHistory()

  const isEmpty = insight && insight.lastAnalyzedAt === 0

  return (
    <main className="mx-auto max-w-5xl px-6 pb-16 pt-10">
      <motion.div {...fadeIn}>
        <SectionHeading title="AI Market Intelligence" />
        <p
          className="mb-8 max-w-xl text-[0.9375rem] leading-relaxed"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          DON-signed AI analysis from the CRE workflow. Groq LLM processes
          all 5 oracle benchmarks plus SOFR data, DON nodes reach consensus
          on the verdict, and the signed report is written on-chain.
        </p>
      </motion.div>

      {error && <ErrorBanner />}

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} rows={1} />
          ))}
        </div>
      ) : isEmpty ? (
        <motion.div {...stagger(0)}>
          <div
            className="rounded-xl p-6 text-center"
            style={{
              background: 'var(--color-card)',
              boxShadow: '0 0 0 1px var(--color-border-subtle)',
            }}
          >
            <div
              className="mb-2 text-sm font-medium"
              style={{ color: 'var(--color-text-primary)' }}
            >
              No AI insight data yet
            </div>
            <p
              className="mx-auto max-w-md text-[0.8125rem] leading-relaxed"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              Run the CRE broadcast with{' '}
              <code
                className="rounded px-1.5 py-0.5 text-xs"
                style={{ background: 'var(--color-surface)' }}
              >
                action="analyze"
              </code>{' '}
              to write the first AI verdict on-chain.
            </p>
          </div>
        </motion.div>
      ) : insight ? (
        <>
          {/* Verdict cards */}
          <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <motion.div {...stagger(0)}>
              <VerdictCard
                label="Risk Level"
                value={insight.riskLevel}
                colors={RISK_COLORS[insight.riskLevel]}
              />
            </motion.div>
            <motion.div {...stagger(1)}>
              <div
                className="rounded-xl p-5"
                style={{
                  background: 'var(--color-card)',
                  boxShadow: '0 0 0 1px var(--color-border-subtle)',
                }}
              >
                <div
                  className="mb-1 text-xs"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  Risk Score
                </div>
                <div
                  className="text-3xl font-semibold tabular-nums"
                  style={{ color: riskScoreColor(insight.riskScore) }}
                >
                  {insight.riskScore}
                  <span
                    className="ml-1 text-sm font-normal"
                    style={{ color: 'var(--color-text-secondary)' }}
                  >
                    / 100
                  </span>
                </div>
              </div>
            </motion.div>
            <motion.div {...stagger(2)}>
              <VerdictCard
                label="Rate Direction"
                value={insight.rateDirection}
                colors={DIRECTION_COLORS[insight.rateDirection]}
              />
            </motion.div>
            <motion.div {...stagger(3)}>
              <VerdictCard
                label="Spread Health"
                value={insight.spreadHealth}
                colors={SPREAD_COLORS[insight.spreadHealth]}
              />
            </motion.div>
            <motion.div {...stagger(4)}>
              <VerdictCard
                label="Market Regime"
                value={insight.marketRegime}
                colors={REGIME_COLORS[insight.marketRegime]}
              />
            </motion.div>
            <motion.div {...stagger(5)}>
              <div
                className="rounded-xl p-5"
                style={{
                  background: 'var(--color-card)',
                  boxShadow: '0 0 0 1px var(--color-border-subtle)',
                }}
              >
                <div
                  className="mb-1 text-xs"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  Anomaly Status
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{
                      background: insight.anomalyDetected ? '#ef4444' : '#22c55e',
                    }}
                  />
                  <span
                    className="text-sm font-medium"
                    style={{ color: 'var(--color-text-primary)' }}
                  >
                    {insight.anomalyDetected ? 'Anomaly flagged' : 'None detected'}
                  </span>
                </div>
              </div>
            </motion.div>
          </div>

          {/* Metadata row */}
          <motion.div {...stagger(6)}>
            <div className="mb-8 flex flex-wrap items-center gap-4">
              <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                Last analyzed: {formatTimestamp(insight.lastAnalyzedAt)}
              </span>
              {insight.isHighRisk && (
                <span
                  className="rounded-full px-2.5 py-1 text-xs font-semibold"
                  style={{
                    background: 'rgba(239,68,68,0.08)',
                    color: '#991b1b',
                  }}
                >
                  High risk
                </span>
              )}
            </div>
          </motion.div>

          {/* Risk score history */}
          {history.length > 0 && (
            <>
              <motion.div {...stagger(7)}>
                <SectionHeading title="Risk Score History" />
              </motion.div>
              <motion.div {...stagger(8)}>
                <div
                  className="mb-8 rounded-xl p-5"
                  style={{
                    background: 'var(--color-card)',
                    boxShadow: '0 0 0 1px var(--color-border-subtle)',
                  }}
                >
                  <div className="flex items-end gap-1" style={{ height: 120 }}>
                    {history.slice().reverse().map((entry) => {
                      const pct = Math.max(entry.riskScore, 2)
                      return (
                        <div
                          key={entry.periodsBack}
                          className="group relative flex-1"
                          style={{ height: '100%' }}
                        >
                          <div
                            className="absolute bottom-0 w-full rounded-t"
                            style={{
                              height: `${pct}%`,
                              background: historyBarColor(entry.riskScore),
                              transition: 'height 0.2s ease',
                            }}
                          />
                          <div
                            className="pointer-events-none absolute bottom-full left-1/2 mb-1 hidden -translate-x-1/2 rounded px-2 py-1 text-xs font-medium whitespace-nowrap group-hover:block"
                            style={{
                              background: 'var(--color-text-primary)',
                              color: 'var(--color-card)',
                            }}
                          >
                            Score: {entry.riskScore}{' '}
                            ({entry.periodsBack === 0 ? 'latest' : `${entry.periodsBack}p ago`})
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <div
                    className="mt-2 flex justify-between text-xs"
                    style={{ color: 'var(--color-text-secondary)' }}
                  >
                    <span>Oldest</span>
                    <span>Latest</span>
                  </div>
                </div>
              </motion.div>
            </>
          )}

          {/* How it works */}
          <motion.div {...stagger(9)}>
            <SectionHeading title="How It Works" />
          </motion.div>
          <div className="mb-8 grid gap-4 sm:grid-cols-3">
            {HOW_STEPS.map((step, i) => (
              <motion.div key={step.title} {...stagger(10 + i)}>
                <div
                  className="rounded-xl p-5"
                  style={{
                    background: 'var(--color-card)',
                    boxShadow: '0 0 0 1px var(--color-border-subtle)',
                  }}
                >
                  <div
                    className="mb-2 text-xs font-medium tabular-nums"
                    style={{ color: 'var(--color-text-secondary)' }}
                  >
                    Step {i + 1}
                  </div>
                  <div
                    className="mb-1 text-sm font-medium"
                    style={{ color: 'var(--color-text-primary)' }}
                  >
                    {step.title}
                  </div>
                  <p
                    className="text-[0.8125rem] leading-relaxed"
                    style={{ color: 'var(--color-text-secondary)' }}
                  >
                    {step.desc}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>

          {/* Contract info */}
          <motion.div {...stagger(13)}>
            <SectionHeading title="Contract Info" />
            <div
              className="rounded-xl p-5"
              style={{
                background: 'var(--color-card)',
                boxShadow: '0 0 0 1px var(--color-border-subtle)',
              }}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>Contract</span>
                  <a
                    href={etherscanLink(AI_INSIGHT_ADDRESS)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-xs transition-colors duration-100"
                    style={{ color: 'var(--color-accent-pink)' }}
                  >
                    {shortenAddress(AI_INSIGHT_ADDRESS)}
                  </a>
                </div>
                <MetricRow label="Total insights" value={insight.insightIndex.toString()} />
                <MetricRow label="Chain" value="Sepolia" />
                <MetricRow label="History buffer" value="48 entries" />
              </div>
            </div>
          </motion.div>
        </>
      ) : null}
    </main>
  )
}

const HOW_STEPS = [
  {
    title: 'LLM analysis',
    desc: 'CRE workflow sends all 5 oracle benchmarks plus SOFR data to Groq LLM (llama-3.3-70b) for risk assessment.',
  },
  {
    title: 'DON consensus',
    desc: 'Multiple DON nodes independently call the LLM and reach consensus on the verdict via median aggregation.',
  },
  {
    title: 'On-chain report',
    desc: 'The signed report is written to DeBORAIInsight, storing risk level, direction, regime, and anomaly flags.',
  },
]

function historyBarColor(score: number): string {
  if (score < 25) return '#22c55e'
  if (score < 50) return '#3b82f6'
  if (score < 75) return '#f59e0b'
  return '#ef4444'
}

function VerdictCard({
  label,
  value,
  colors,
}: {
  label: string
  value: string
  colors: { bg: string; fg: string }
}) {
  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: 'var(--color-card)',
        boxShadow: '0 0 0 1px var(--color-border-subtle)',
      }}
    >
      <div
        className="mb-2 text-xs"
        style={{ color: 'var(--color-text-secondary)' }}
      >
        {label}
      </div>
      <span
        className="inline-block rounded-full px-3 py-1 text-sm font-semibold"
        style={{ background: colors.bg, color: colors.fg }}
      >
        {value}
      </span>
    </div>
  )
}
