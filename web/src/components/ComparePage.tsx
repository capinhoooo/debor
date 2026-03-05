import { useState, useMemo } from 'react'
import { motion } from 'motion/react'
import { Liveline, type LivelinePoint } from 'liveline'
import { useSOFRData, percentToBps } from '@/hooks/useSOFRData'
import { useDeFiPremium, type AssetPremium } from '@/hooks/useDeFiPremium'
import { formatBps } from '@/utils/format'
import { type MarketRegime } from '@/utils/risk'
import { ease, fadeIn, stagger } from '@/utils/motion'
import SectionHeading from '@/components/elements/SectionHeading'
import SkeletonCard from '@/components/elements/SkeletonCard'
import CSVButton from '@/components/elements/CSVButton'

const REGIME_COLORS: Record<MarketRegime, { bg: string; fg: string }> = {
  CONVERGED: { bg: 'rgba(34,197,94,0.08)', fg: '#166534' },
  NORMAL: { bg: 'rgba(59,130,246,0.08)', fg: '#1e40af' },
  DIVERGED: { bg: 'rgba(245,158,11,0.08)', fg: '#92400e' },
  DISLOCATED: { bg: 'rgba(239,68,68,0.08)', fg: '#991b1b' },
}

export default function ComparePage() {
  const { sofr, effr, sofrai, sofrHistory, isLoading: sofrLoading } = useSOFRData()
  const { summary, isLoading: premiumLoading } = useDeFiPremium()

  const isLoading = sofrLoading || premiumLoading

  return (
    <main className="mx-auto max-w-5xl px-6 pb-16 pt-10">
      <motion.div {...fadeIn}>
        <SectionHeading title="SOFR / TradFi Comparison" />
        <p
          className="mb-8 max-w-xl text-[0.9375rem] leading-relaxed"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          Compare DeBOR benchmark rates against SOFR and EFFR — the institutional
          reference rates published daily by the NY Federal Reserve.
        </p>
      </motion.div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={i} rows={2} />
          ))}
        </div>
      ) : (
        <>
          {/* SOFR / EFFR header cards */}
          <div className="grid gap-4 sm:grid-cols-2">
            {sofr && (
              <motion.div {...stagger(0)}>
                <TradFiCard
                  title="SOFR"
                  subtitle="Secured Overnight Financing Rate"
                  rate={sofr.percentRate}
                  date={sofr.effectiveDate}
                  volume={sofr.volumeInBillions}
                  rangeLabel={`P1–P99: ${sofr.percentPercentile1.toFixed(2)}% – ${sofr.percentPercentile99.toFixed(2)}%`}
                />
              </motion.div>
            )}
            {effr && (
              <motion.div {...stagger(1)}>
                <TradFiCard
                  title="EFFR"
                  subtitle="Effective Federal Funds Rate"
                  rate={effr.percentRate}
                  date={effr.effectiveDate}
                  volume={effr.volumeInBillions}
                  rangeLabel={`Target: ${effr.targetRateFrom.toFixed(2)}% – ${effr.targetRateTo.toFixed(2)}%`}
                />
              </motion.div>
            )}
          </div>

          {/* SOFR Compounded Averages */}
          {sofrai && (
            <motion.div {...fadeIn} transition={{ duration: 0.18, ease, delay: 0.1 }}>
              <div className="mt-6 grid gap-4 sm:grid-cols-3">
                <AvgCard label="30-day avg" value={sofrai.average30day} />
                <AvgCard label="90-day avg" value={sofrai.average90day} />
                <AvgCard label="180-day avg" value={sofrai.average180day} />
              </div>
            </motion.div>
          )}

          {/* SOFR Percentile Distribution */}
          {sofr && (
            <motion.div {...fadeIn} transition={{ duration: 0.18, ease, delay: 0.15 }}>
              <div className="mt-8">
                <SectionHeading title="SOFR Percentile Distribution" />
                <PercentileBar sofr={sofr} />
              </div>
            </motion.div>
          )}

          {/* DeFi Premium Table */}
          {summary && (
            <motion.div {...fadeIn} transition={{ duration: 0.18, ease, delay: 0.2 }}>
              <div className="mt-8">
                <div className="flex items-center justify-between">
                  <SectionHeading title="DeFi Premium vs SOFR" />
                  <CSVButton
                    headers={['Asset', 'DeBOR Rate (bps)', 'SOFR (bps)', 'Premium (bps)', 'Regime']}
                    rows={summary.assets.map((a) => [a.asset, a.deborRateBps, a.sofrBps, a.premiumBps, a.regime])}
                    filename="debor-sofr-comparison"
                  />
                </div>
                <PremiumTable assets={summary.assets} />
                <div className="mt-4 flex items-center gap-6">
                  <PremiumStat
                    label="Avg stablecoin premium"
                    bps={summary.stablecoinAvgPremium}
                  />
                </div>
              </div>
            </motion.div>
          )}

          {/* SOFR Trend */}
          {sofrHistory.length > 1 && (
            <motion.div {...fadeIn} transition={{ duration: 0.18, ease, delay: 0.25 }}>
              <div className="mt-8">
                <SectionHeading title="SOFR Trend" />
                <SOFRTrendChart history={sofrHistory} />
              </div>
            </motion.div>
          )}
        </>
      )}
    </main>
  )
}

function TradFiCard({
  title,
  subtitle,
  rate,
  date,
  volume,
  rangeLabel,
}: {
  title: string
  subtitle: string
  rate: number
  date: string
  volume: number
  rangeLabel: string
}) {
  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: 'var(--color-card)',
        boxShadow: '0 0 0 1px var(--color-border-subtle), 0 4px 16px rgba(0,0,0,0.06)',
      }}
    >
      <div className="mb-1 flex items-center gap-2">
        <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          {title}
        </span>
        <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
          {subtitle}
        </span>
      </div>
      <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{date}</div>
      <div className="mt-3 text-2xl font-semibold tabular-nums tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
        {rate.toFixed(2)}%
      </div>
      <div className="mt-3 flex items-center justify-between text-xs">
        <span style={{ color: 'var(--color-text-secondary)' }}>
          Volume: ${Math.round(volume).toLocaleString()}B
        </span>
        <span className="tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>
          {rangeLabel}
        </span>
      </div>
    </div>
  )
}

function AvgCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl px-5 py-4" style={{ background: 'var(--color-surface)' }}>
      <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums" style={{ color: 'var(--color-text-primary)' }}>
        {value.toFixed(3)}%
      </div>
    </div>
  )
}

function PercentileBar({ sofr }: { sofr: { percentRate: number; percentPercentile1: number; percentPercentile25: number; percentPercentile75: number; percentPercentile99: number } }) {
  const p1 = sofr.percentPercentile1
  const p25 = sofr.percentPercentile25
  const median = sofr.percentRate
  const p75 = sofr.percentPercentile75
  const p99 = sofr.percentPercentile99
  const range = p99 - p1 || 0.01

  const toPos = (v: number) => ((v - p1) / range) * 100

  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: 'var(--color-card)',
        boxShadow: '0 0 0 1px var(--color-border-subtle), 0 4px 16px rgba(0,0,0,0.06)',
      }}
    >
      <div className="relative mx-auto" style={{ maxWidth: 600 }}>
        <svg viewBox="0 0 600 50" className="w-full" style={{ height: 'auto' }}>
          {/* Track */}
          <rect x={0} y={20} width={600} height={8} rx={4} fill="var(--color-surface)" />
          {/* IQR range (P25-P75) */}
          <rect
            x={toPos(p25) * 6}
            y={20}
            width={Math.max((toPos(p75) - toPos(p25)) * 6, 4)}
            height={8}
            rx={4}
            fill="var(--color-text-primary)"
            opacity={0.2}
          />
          {/* Median marker */}
          <line
            x1={toPos(median) * 6}
            y1={16}
            x2={toPos(median) * 6}
            y2={32}
            stroke="var(--color-accent-pink)"
            strokeWidth={2}
          />
          {/* Labels */}
          <text x={0} y={46} fontSize={10} fill="rgba(0,0,0,0.35)" fontFamily="Inter Variable, sans-serif">
            P1: {p1.toFixed(2)}%
          </text>
          <text x={toPos(p25) * 6} y={14} fontSize={10} fill="rgba(0,0,0,0.35)" fontFamily="Inter Variable, sans-serif" textAnchor="middle">
            P25: {p25.toFixed(2)}%
          </text>
          <text x={toPos(median) * 6} y={46} fontSize={10} fill="var(--color-accent-pink)" fontFamily="Inter Variable, sans-serif" fontWeight={600} textAnchor="middle">
            {median.toFixed(2)}%
          </text>
          <text x={toPos(p75) * 6} y={14} fontSize={10} fill="rgba(0,0,0,0.35)" fontFamily="Inter Variable, sans-serif" textAnchor="middle">
            P75: {p75.toFixed(2)}%
          </text>
          <text x={600} y={46} fontSize={10} fill="rgba(0,0,0,0.35)" fontFamily="Inter Variable, sans-serif" textAnchor="end">
            P99: {p99.toFixed(2)}%
          </text>
        </svg>
      </div>
    </div>
  )
}

function PremiumTable({ assets }: { assets: AssetPremium[] }) {
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
            {['Asset', 'DeBOR Rate', 'SOFR', 'Premium', 'Regime'].map((h) => (
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
          {assets.map((a) => {
            const regime = REGIME_COLORS[a.regime]
            return (
              <tr key={a.asset}>
                <td
                  className="px-5 py-3 text-sm font-medium"
                  style={{ color: 'var(--color-text-primary)', borderBottom: '1px solid var(--color-border-subtle)' }}
                >
                  {a.asset}
                </td>
                <td
                  className="px-5 py-3 text-sm tabular-nums"
                  style={{ color: 'var(--color-text-primary)', borderBottom: '1px solid var(--color-border-subtle)' }}
                >
                  {formatBps(a.deborRateBps)}
                </td>
                <td
                  className="px-5 py-3 text-sm tabular-nums"
                  style={{ color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border-subtle)' }}
                >
                  {formatBps(a.sofrBps)}
                </td>
                <td
                  className="px-5 py-3 text-sm font-medium tabular-nums"
                  style={{
                    color: a.premiumBps >= 0 ? '#166534' : '#991b1b',
                    borderBottom: '1px solid var(--color-border-subtle)',
                  }}
                >
                  {a.premiumBps >= 0 ? '+' : ''}{a.premiumBps} bps
                </td>
                <td
                  className="px-5 py-3"
                  style={{ borderBottom: '1px solid var(--color-border-subtle)' }}
                >
                  <span
                    className="rounded-full px-2 py-0.5 text-xs font-semibold"
                    style={{ background: regime.bg, color: regime.fg }}
                  >
                    {a.regime}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function PremiumStat({ label, bps }: { label: string; bps: number }) {
  const color = Math.abs(bps) < 10 ? '#22c55e' : Math.abs(bps) > 50 ? 'var(--color-accent-pink)' : 'var(--color-text-primary)'
  return (
    <div
      className="rounded-xl px-5 py-4"
      style={{ background: 'var(--color-surface)' }}
    >
      <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums" style={{ color }}>
        {bps >= 0 ? '+' : ''}{bps} bps
      </div>
      <div className="mt-0.5 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
        Stablecoins (USDC, DAI, USDT) averaged
      </div>
    </div>
  )
}

type SOFRRange = '1d' | '3d' | '7d' | '30d' | '90d'
const SOFR_RANGE_DAYS: Record<SOFRRange, number> = { '1d': 2, '3d': 5, '7d': 7, '30d': 22, '90d': 66 }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function formatSOFRTime(range: SOFRRange) {
  return (t: number) => {
    const d = new Date(t * 1000)
    if (range === '1d') {
      return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
    }
    return `${MONTHS[d.getMonth()]} ${d.getDate()}`
  }
}

interface SOFRHistoryEntry {
  effectiveDate: string
  percentRate: number
  volumeInBillions: number
}

function SOFRTrendChart({ history }: { history: SOFRHistoryEntry[] }) {
  const [range, setRange] = useState<SOFRRange>('30d')

  const { data, value, windowSecs, stats, volumes } = useMemo(() => {
    if (history.length < 2) return { data: [] as LivelinePoint[], value: 0, windowSecs: 86400 * 30, stats: null, volumes: [] as { date: string; vol: number }[] }

    const limit = SOFR_RANGE_DAYS[range]
    const sliced = history.slice(0, limit).reverse()
    if (sliced.length < 1) return { data: [] as LivelinePoint[], value: 0, windowSecs: 86400 * 30, stats: null, volumes: [] as { date: string; vol: number }[] }

    // Build points from actual dates, then densify for Liveline
    const raw: LivelinePoint[] = sliced.map((h) => ({
      time: Math.floor(new Date(h.effectiveDate + 'T12:00:00').getTime() / 1000),
      value: percentToBps(h.percentRate),
    }))

    // Extract volume data for bar chart
    const vols = sliced.map((h) => ({ date: h.effectiveDate, vol: h.volumeInBillions ?? 0 }))

    // Liveline needs density to render well; interpolate between sparse daily points
    const points: LivelinePoint[] = []
    const STEPS = 8
    for (let i = 0; i < raw.length; i++) {
      points.push(raw[i])
      if (i < raw.length - 1) {
        const dt = raw[i + 1].time - raw[i].time
        const dv = raw[i + 1].value - raw[i].value
        for (let s = 1; s < STEPS; s++) {
          points.push({
            time: raw[i].time + Math.round((dt * s) / STEPS),
            value: Math.round(raw[i].value + (dv * s) / STEPS),
          })
        }
      }
    }

    const latest = points[points.length - 1].value
    const span = points[points.length - 1].time - points[0].time
    const values = points.map((p) => p.value)
    return {
      data: points,
      value: latest,
      windowSecs: Math.max(Math.round(span * 1.15), 86400),
      stats: {
        min: Math.min(...values),
        max: Math.max(...values),
        avg: Math.round(values.reduce((a, b) => a + b, 0) / values.length),
      },
      volumes: vols,
    }
  }, [history, range])

  return (
    <div>
      <div className="mb-4 flex items-center gap-1">
        {(['1d', '3d', '7d', '30d', '90d'] as SOFRRange[]).map((r) => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
            style={{
              background: range === r ? 'var(--color-accent-pink-bg)' : 'transparent',
              color: range === r ? 'var(--color-accent-pink)' : 'var(--color-text-tertiary)',
            }}
          >
            {r}
          </button>
        ))}
      </div>

      <div
        className="liveline-chart rounded-xl"
        style={{
          background: 'var(--color-card)',
          boxShadow: '0 0 0 1px var(--color-border-subtle), 0 4px 16px rgba(0,0,0,0.06)',
          height: 280,
        }}
      >
        <Liveline
          data={data}
          value={value}
          theme="light"
          color="rgba(0, 0, 0, 0.8)"
          grid={true}
          badge={true}
          scrub={true}
          momentum={false}
          fill={true}
          exaggerate={true}
          showValue={true}
          valueMomentumColor={false}
          pulse={false}
          formatValue={(v) => formatBps(v)}
          formatTime={formatSOFRTime(range)}
          window={windowSecs}
          padding={{ top: 48, right: 80, bottom: 44, left: 12 }}
        />
      </div>

      {/* Volume bars */}
      {volumes.length > 1 && <VolumeChart volumes={volumes} range={range} />}

      {stats && (
        <div className="mt-4 flex items-center gap-6">
          {[
            { label: 'Min', val: formatBps(stats.min) },
            { label: 'Max', val: formatBps(stats.max) },
            { label: 'Avg', val: formatBps(stats.avg) },
          ].map(({ label, val }) => (
            <div key={label} className="flex items-baseline gap-1.5">
              <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{label}</span>
              <span className="text-sm font-semibold tabular-nums" style={{ color: 'var(--color-text-primary)' }}>
                {val}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function VolumeChart({ volumes, range }: { volumes: { date: string; vol: number }[]; range: SOFRRange }) {
  const maxVol = Math.max(...volumes.map((v) => v.vol), 1)

  return (
    <div
      className="mt-2 rounded-xl px-5 py-3"
      style={{
        background: 'var(--color-card)',
        boxShadow: '0 0 0 1px var(--color-border-subtle)',
      }}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
          Volume ($B)
        </span>
        <span className="text-xs tabular-nums" style={{ color: 'var(--color-text-tertiary)' }}>
          Latest: ${Math.round(volumes[volumes.length - 1].vol).toLocaleString()}B
        </span>
      </div>
      <div className="flex items-end gap-px" style={{ height: 56 }}>
        {volumes.map((v, i) => {
          const pct = maxVol > 0 ? (v.vol / maxVol) * 100 : 0
          const d = new Date(v.date + 'T12:00:00')
          const label = range === '1d'
            ? `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
            : `${MONTHS[d.getMonth()]} ${d.getDate()}`
          return (
            <div
              key={i}
              className="group relative flex-1"
              style={{ height: '100%', display: 'flex', alignItems: 'flex-end' }}
            >
              <div
                className="w-full rounded-sm transition-colors"
                style={{
                  height: `${Math.max(pct, 2)}%`,
                  background: 'var(--color-text-primary)',
                  opacity: 0.15,
                }}
              />
              <div
                className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded px-2 py-1 text-xs tabular-nums group-hover:block"
                style={{ background: 'var(--color-text-primary)', color: 'var(--color-card)' }}
              >
                {label}: ${Math.round(v.vol).toLocaleString()}B
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

