import { useState, useMemo } from 'react'
import { Liveline, type LivelinePoint } from 'liveline'
import { useHistoricalRates } from '@/hooks/useHistoricalRates'
import { useHistoricalTVL } from '@/hooks/useHistoricalTVL'
import { formatBps, bpsToPercent } from '@/utils/format'
import { downloadCSV } from '@/utils/export'
import { ASSETS, type AssetKey } from '@/lib/contracts'

type TimeRange = '1d' | '3d' | '7d' | '30d'
const RANGE_POINTS: Record<TimeRange, number> = { '1d': 48, '3d': 144, '7d': 336, '30d': 336 }
const RANGE_DAYS: Record<TimeRange, number> = { '1d': 1, '3d': 3, '7d': 7, '30d': 30 }
const INTERVAL_SECS = 1800
const CHART_COLOR = 'rgba(0, 0, 0, 0.8)'
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function formatChartTime(range: TimeRange) {
  return (t: number) => {
    const d = new Date(t * 1000)
    if (range === '1d') {
      return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
    }
    return `${MONTHS[d.getMonth()]} ${d.getDate()}`
  }
}

interface RateChartProps {
  defaultAsset?: AssetKey
  hideAssetSelector?: boolean
  referenceLine?: { value: number; label?: string }
}

export default function RateChart({ defaultAsset, hideAssetSelector, referenceLine }: RateChartProps) {
  const [selectedAsset, setSelectedAsset] = useState<AssetKey>(defaultAsset ?? 'USDC')
  const [range, setRange] = useState<TimeRange>('7d')
  const { historical, isLoading } = useHistoricalRates(selectedAsset)
  const { tvlHistory } = useHistoricalTVL(selectedAsset)

  const { data, value, stats } = useMemo(() => {
    if (!historical) return { data: [] as LivelinePoint[], value: 0, stats: null }
    const limit = RANGE_POINTS[range]
    const rates = historical.rates.slice(0, limit)
    const nonZero = rates.filter((r) => r > 0)
    if (nonZero.length === 0) return { data: [] as LivelinePoint[], value: 0, stats: null }

    const now = Math.floor(Date.now() / 1000)
    const points: LivelinePoint[] = []
    for (let i = rates.length - 1; i >= 0; i--) {
      if (rates[i] === 0) continue
      points.push({ time: now - i * INTERVAL_SECS, value: rates[i] })
    }
    const latest = points.length > 0 ? points[points.length - 1].value : 0
    return {
      data: points,
      value: latest,
      stats: {
        min: Math.min(...nonZero),
        max: Math.max(...nonZero),
        avg: Math.round(nonZero.reduce((a, b) => a + b, 0) / nonZero.length),
      },
    }
  }, [historical, range])

  const windowSecs = useMemo(() => {
    if (data.length < 2) return 86400
    const span = data[data.length - 1].time - data[0].time
    return Math.max(Math.round(span * 1.15), 3600)
  }, [data])

  const volumeBars = useMemo(() => {
    if (tvlHistory.length === 0) return []
    const days = RANGE_DAYS[range]
    return tvlHistory.slice(-days)
  }, [tvlHistory, range])

  const handleExport = () => {
    if (!historical) return
    const limit = RANGE_POINTS[range]
    const headers = ['Period', 'Rate (bps)', 'Rate (%)']
    const rows = historical.rates.slice(0, limit).map((r, i) => [i, r, bpsToPercent(r)] as (string | number)[])
    downloadCSV(headers, rows, `debor-${selectedAsset.toLowerCase()}-${range}`)
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {!hideAssetSelector && (
          <div className="flex flex-wrap items-center gap-1">
            {ASSETS.map((asset) => (
              <button
                key={asset}
                onClick={() => setSelectedAsset(asset)}
                className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
                style={{
                  background: selectedAsset === asset ? 'var(--color-text-primary)' : 'transparent',
                  color: selectedAsset === asset ? 'var(--color-card)' : 'var(--color-text-secondary)',
                  border: selectedAsset === asset ? 'none' : '1px solid var(--color-border-medium)',
                }}
              >
                {asset}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-1">
          {(['1d', '3d', '7d', '30d'] as TimeRange[]).map((r) => (
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

        <button
          onClick={handleExport}
          className="ml-auto rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
          style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-border-medium)' }}
        >
          Export CSV
        </button>
      </div>

      <div
        className="rounded-xl overflow-hidden"
        style={{
          background: 'var(--color-card)',
          boxShadow: '0 0 0 1px var(--color-border-subtle), 0 4px 16px rgba(0,0,0,0.06)',
        }}
      >
        <div className="liveline-chart" style={{ height: 360 }}>
          <Liveline
            data={data}
            value={value}
            theme="light"
            color={CHART_COLOR}
            momentum={true}
            showValue={true}
            valueMomentumColor={false}
            scrub={true}
            grid={true}
            exaggerate={true}
            loading={isLoading && data.length === 0}
            fill={true}
            badge={true}
            pulse={true}
            formatValue={(v) => formatBps(v)}
            formatTime={formatChartTime(range)}
            window={windowSecs}
            padding={{ top: 48, right: 80, bottom: 48, left: 56 }}
            referenceLine={referenceLine}
          />
        </div>

        {volumeBars.length > 0 && (() => {
          const maxTvl = Math.max(...volumeBars.map((v) => v.tvl), 1)
          const latestTvl = volumeBars[volumeBars.length - 1].tvl
          const fmt = (n: number) => n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : `$${(n / 1e6).toFixed(0)}M`
          return (
            <div className="px-5 pb-4 pt-3" style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>
                  {selectedAsset} Lending TVL
                </span>
                <span className="text-[10px] tabular-nums" style={{ color: 'var(--color-text-tertiary)' }}>
                  {fmt(latestTvl)}
                </span>
              </div>
              <div className="flex items-end gap-px" style={{ height: 48 }}>
                {volumeBars.map((v, i) => {
                  const pct = maxTvl > 0 ? (v.tvl / maxTvl) * 100 : 0
                  const d = new Date(v.date * 1000)
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
                          opacity: 0.12,
                        }}
                      />
                      <div
                        className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded px-2 py-1 text-[10px] tabular-nums group-hover:block"
                        style={{ background: 'var(--color-text-primary)', color: 'var(--color-card)' }}
                      >
                        {label}: {fmt(v.tvl)}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })()}
      </div>

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
