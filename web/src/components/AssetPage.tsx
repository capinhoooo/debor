import { useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import { motion } from 'motion/react'
import { useSingleOracle } from '@/hooks/useOracleData'
import { useHistoricalRates } from '@/hooks/useHistoricalRates'
import { useSOFRData, percentToBps } from '@/hooks/useSOFRData'
import { useProtocolTVL } from '@/hooks/useProtocolTVL'
import { formatBps, timeAgo, shortenAddress, etherscanLink } from '@/utils/format'
import { computeVaR, computeHHI, computeRiskBreakdown, runStressTests, classifyRegime, type MarketRegime } from '@/utils/risk'
import { fadeIn, stagger, delayedFadeIn } from '@/utils/motion'
import { ASSETS, ORACLE_ADDRESSES, type AssetKey } from '@/lib/contracts'
import SectionHeading from '@/components/elements/SectionHeading'
import CSVButton from '@/components/elements/CSVButton'
import RateChart from '@/components/RateChart'

export default function AssetPage({ symbol }: { symbol: string }) {
  const asset = symbol.toUpperCase() as AssetKey

  if (!ASSETS.includes(asset)) {
    return (
      <main className="mx-auto max-w-5xl px-6 pb-16 pt-10">
        <div
          className="rounded-xl py-12 text-center text-sm"
          style={{ color: 'var(--color-text-tertiary)', background: 'var(--color-surface)' }}
        >
          Unknown asset: {symbol}. Valid assets: {ASSETS.join(', ')}.
        </div>
      </main>
    )
  }

  return <AssetDetail asset={asset} />
}

const REGIME_COLORS: Record<MarketRegime, { bg: string; fg: string }> = {
  CONVERGED: { bg: 'rgba(34,197,94,0.08)', fg: '#166534' },
  NORMAL: { bg: 'rgba(59,130,246,0.08)', fg: '#1e40af' },
  DIVERGED: { bg: 'rgba(245,158,11,0.08)', fg: '#92400e' },
  DISLOCATED: { bg: 'rgba(239,68,68,0.08)', fg: '#991b1b' },
}

function AssetDetail({ asset }: { asset: AssetKey }) {
  const { benchmark, isLoading } = useSingleOracle(asset)
  const { historical } = useHistoricalRates(asset)
  const { sofr, effr, sofrai } = useSOFRData()
  const { tvls } = useProtocolTVL()

  const sofrBps = sofr ? percentToBps(sofr.percentRate) : null
  const effrBps = effr ? percentToBps(effr.percentRate) : null
  const premium = benchmark && sofrBps !== null ? Number(benchmark.rate) - sofrBps : null
  const effrPremium = benchmark && effrBps !== null ? Number(benchmark.rate) - effrBps : null
  const regime = premium !== null ? classifyRegime(premium) : null

  const varMetrics = useMemo(() => {
    if (!benchmark || !historical) return null
    const currentRate = Number(benchmark.rate)
    const vol = Number(benchmark.vol)
    const prevRate = historical.rates.find((r) => r > 0) ?? currentRate
    return computeVaR(currentRate, prevRate, vol)
  }, [benchmark, historical])

  const hhiMetrics = useMemo(() => {
    if (tvls.length === 0) return null
    return computeHHI(tvls)
  }, [tvls])

  const riskBreakdown = useMemo(() => {
    if (!varMetrics || !hhiMetrics || !benchmark) return null
    const uptimeRatio = Number(benchmark.configured) > 0 ? Number(benchmark.sources) / Number(benchmark.configured) : 1
    return computeRiskBreakdown(varMetrics.var99, hhiMetrics.hhi, uptimeRatio, premium ?? 0, Number(benchmark.vol))
  }, [varMetrics, hhiMetrics, benchmark, premium])

  const stressResults = useMemo(() => {
    if (!varMetrics || !hhiMetrics || !benchmark) return null
    return runStressTests(Number(benchmark.rate), varMetrics.var99, hhiMetrics.maxWeight)
  }, [varMetrics, hhiMetrics, benchmark])

  const csvHeaders = ['Field', 'Value']
  const csvRows: (string | number)[][] = benchmark
    ? [
        ['Asset', asset],
        ['Borrow Rate (bps)', Number(benchmark.rate)],
        ['Supply Rate (bps)', Number(benchmark.supply)],
        ['Spread (bps)', Number(benchmark.spread)],
        ['Volatility', Number(benchmark.vol)],
        ['7d Average (bps)', Number(benchmark.term7d)],
        ['Sources', `${Number(benchmark.sources)}/${Number(benchmark.configured)}`],
        ...(sofrBps !== null ? [['SOFR (bps)', sofrBps], ['SOFR Premium (bps)', premium!]] : []),
        ...(effrBps !== null ? [['EFFR (bps)', effrBps], ['EFFR Premium (bps)', effrPremium!]] : []),
        ...(regime ? [['Market Regime', regime]] : []),
      ]
    : []

  return (
    <main className="mx-auto max-w-5xl px-6 pb-16 pt-10">
      <motion.div {...fadeIn}>
        <Link
          to="/"
          className="mb-4 inline-flex items-center gap-1.5 text-sm transition-colors duration-100 hover:opacity-70"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          ← Back to rates
        </Link>
        <div className="mb-8 flex items-center justify-between">
          <div>
            <SectionHeading title={`${asset} Benchmark`} />
            <p
              className="max-w-xl text-[0.9375rem] leading-relaxed"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              Live oracle data, historical chart, risk metrics, and protocol
              breakdown for {asset}.
            </p>
          </div>
          {benchmark && <CSVButton headers={csvHeaders} rows={csvRows} filename={`debor-${asset.toLowerCase()}`} />}
        </div>
      </motion.div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl p-5"
              style={{ background: 'var(--color-card)', boxShadow: '0 0 0 1px var(--color-border-subtle)' }}
            >
              <div className="mb-3 h-3 w-16 rounded" style={{ background: 'var(--color-surface)' }} />
              <div className="h-8 w-20 rounded" style={{ background: 'var(--color-surface)' }} />
            </div>
          ))}
        </div>
      ) : benchmark ? (
        <>
          {/* Primary metrics */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <motion.div {...stagger(0)}>
              <BigMetricCard label="Borrow Rate" value={formatBps(benchmark.rate)} />
            </motion.div>
            <motion.div {...stagger(1)}>
              <BigMetricCard label="Supply Rate" value={formatBps(benchmark.supply)} />
            </motion.div>
            <motion.div {...stagger(2)}>
              <BigMetricCard label="Spread" value={formatBps(benchmark.spread)} />
            </motion.div>
            <motion.div {...stagger(3)}>
              <BigMetricCard label="7d Average" value={formatBps(benchmark.term7d)} />
            </motion.div>
          </div>

          {/* Secondary metrics */}
          <motion.div {...delayedFadeIn(0.16)}>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <SmallMetricCard label="Volatility" value={String(Number(benchmark.vol))} subtitle="bps std dev" />
              <SmallMetricCard
                label="Sources"
                value={`${Number(benchmark.sources)}/${Number(benchmark.configured)}`}
                subtitle={Number(benchmark.sources) === Number(benchmark.configured) ? 'all reporting' : 'degraded'}
                alert={Number(benchmark.sources) < Number(benchmark.configured)}
              />
              <SmallMetricCard
                label="Last Updated"
                value={benchmark.updated > 0n ? timeAgo(benchmark.updated) : 'Never'}
                subtitle={benchmark.updated > 0n ? new Date(Number(benchmark.updated) * 1000).toLocaleString() : ''}
              />
              {premium !== null && (
                <SmallMetricCard
                  label="SOFR Premium"
                  value={`${premium >= 0 ? '+' : ''}${premium} bps`}
                  subtitle={`SOFR: ${formatBps(sofrBps!)}`}
                />
              )}
            </div>
          </motion.div>

          {/* Chart */}
          <motion.div {...delayedFadeIn(0.2)}>
            <div className="mt-12">
              <SectionHeading title="Rate History" />
              <RateChart
                defaultAsset={asset}
                hideAssetSelector
                referenceLine={sofrBps !== null ? { value: sofrBps, label: 'SOFR' } : undefined}
              />
            </div>
          </motion.div>

          {/* TradFi Comparison */}
          {(sofr || effr) && (
            <motion.div {...delayedFadeIn(0.25)}>
              <div className="mt-12">
                <SectionHeading title="TradFi Rate Comparison" />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {sofr && (
                    <TradFiCard
                      title="SOFR"
                      subtitle="Secured Overnight Financing Rate"
                      rate={sofr.percentRate}
                      date={sofr.effectiveDate}
                      detail={`P1: ${sofr.percentPercentile1.toFixed(2)}%  P99: ${sofr.percentPercentile99.toFixed(2)}%`}
                    />
                  )}
                  {effr && (
                    <TradFiCard
                      title="EFFR"
                      subtitle="Effective Federal Funds Rate"
                      rate={effr.percentRate}
                      date={effr.effectiveDate}
                      detail={`Target: ${effr.targetRateFrom.toFixed(2)}% \u2013 ${effr.targetRateTo.toFixed(2)}%`}
                    />
                  )}
                  {sofrai && (
                    <div
                      className="rounded-xl p-5"
                      style={{
                        background: 'var(--color-card)',
                        boxShadow: '0 0 0 1px var(--color-border-subtle), 0 4px 16px rgba(0,0,0,0.06)',
                      }}
                    >
                      <div className="mb-1 text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                        SOFR Averages
                      </div>
                      <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Compounded</div>
                      <div className="mt-3 grid grid-cols-3 gap-3">
                        {[
                          { label: '30d', val: sofrai.average30day },
                          { label: '90d', val: sofrai.average90day },
                          { label: '180d', val: sofrai.average180day },
                        ].map(({ label, val }) => (
                          <div key={label}>
                            <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{label}</div>
                            <div className="mt-0.5 text-sm font-semibold tabular-nums" style={{ color: 'var(--color-text-primary)' }}>
                              {val.toFixed(3)}%
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Premium + Regime row */}
                <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {premium !== null && (
                    <SmallMetricCard
                      label="DeBOR vs SOFR"
                      value={`${premium >= 0 ? '+' : ''}${premium} bps`}
                      subtitle={`${asset} ${formatBps(benchmark!.rate)} vs SOFR ${formatBps(sofrBps!)}`}
                      alert={Math.abs(premium) > 200}
                    />
                  )}
                  {effrPremium !== null && (
                    <SmallMetricCard
                      label="DeBOR vs EFFR"
                      value={`${effrPremium >= 0 ? '+' : ''}${effrPremium} bps`}
                      subtitle={`${asset} ${formatBps(benchmark!.rate)} vs EFFR ${formatBps(effrBps!)}`}
                      alert={Math.abs(effrPremium) > 200}
                    />
                  )}
                  {regime && (
                    <div className="rounded-xl px-5 py-4" style={{ background: 'var(--color-surface)' }}>
                      <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>Market Regime</div>
                      <div className="mt-2">
                        <span
                          className="rounded-full px-2.5 py-1 text-xs font-semibold"
                          style={{ background: REGIME_COLORS[regime].bg, color: REGIME_COLORS[regime].fg }}
                        >
                          {regime}
                        </span>
                      </div>
                      <div className="mt-1.5 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                        Based on DeFi-to-SOFR spread
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {/* VaR metrics */}
          {varMetrics && (
            <motion.div {...delayedFadeIn(0.3)}>
              <div className="mt-12">
                <SectionHeading title="Risk Metrics" />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <MetricCard label="VaR 95%" value={`${varMetrics.var95} bps`} />
                  <MetricCard label="VaR 99%" value={`${varMetrics.var99} bps`} />
                  <MetricCard label="CVaR 95%" value={`${varMetrics.cvar95} bps`} />
                  <MetricCard label="CVaR 99%" value={`${varMetrics.cvar99} bps`} />
                </div>
              </div>
            </motion.div>
          )}

          {/* Risk Score Breakdown */}
          {riskBreakdown && (
            <motion.div {...delayedFadeIn(0.35)}>
              <div className="mt-8">
                <SectionHeading title="Risk Score Breakdown" />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <RiskScoreCard label="VaR Score" score={riskBreakdown.varScore} max={30} />
                  <RiskScoreCard label="Concentration (HHI)" score={riskBreakdown.hhiScore} max={25} />
                  <RiskScoreCard label="Uptime Score" score={riskBreakdown.uptimeScore} max={20} />
                  <RiskScoreCard label="SOFR Spread" score={riskBreakdown.sofrScore} max={15} />
                  <RiskScoreCard label="Volatility Score" score={riskBreakdown.volScore} max={10} />
                  <div
                    className="rounded-xl p-5"
                    style={{
                      background: 'var(--color-card)',
                      boxShadow: '0 0 0 1px var(--color-border-subtle), 0 4px 16px rgba(0,0,0,0.06)',
                    }}
                  >
                    <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>Overall Risk</div>
                    <div className="mt-1 text-2xl font-semibold tabular-nums" style={{ color: 'var(--color-text-primary)' }}>
                      {riskBreakdown.total} / 100
                    </div>
                    <div className="mt-2">
                      <span
                        className="rounded-full px-2.5 py-1 text-xs font-semibold"
                        style={{
                          background: riskBreakdown.classification === 'LOW' ? 'rgba(34,197,94,0.08)' :
                            riskBreakdown.classification === 'MEDIUM' ? 'rgba(59,130,246,0.08)' :
                            riskBreakdown.classification === 'HIGH' ? 'rgba(245,158,11,0.08)' :
                            'rgba(239,68,68,0.08)',
                          color: riskBreakdown.classification === 'LOW' ? '#166534' :
                            riskBreakdown.classification === 'MEDIUM' ? '#1e40af' :
                            riskBreakdown.classification === 'HIGH' ? '#92400e' :
                            '#991b1b',
                        }}
                      >
                        {riskBreakdown.classification}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* Stress Tests */}
          {stressResults && (
            <motion.div {...delayedFadeIn(0.4)}>
              <div className="mt-12">
                <SectionHeading title="Stress Tests (Basel IRRBB)" />
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
                        {['Scenario', 'Shocked Rate', 'Impact', 'VaR Breach'].map((h) => (
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
                      {stressResults.map((s) => (
                        <tr key={s.name}>
                          <td className="px-5 py-3 text-sm font-medium" style={{ color: 'var(--color-text-primary)', borderBottom: '1px solid var(--color-border-subtle)' }}>
                            {s.name}
                          </td>
                          <td className="px-5 py-3 text-sm tabular-nums" style={{ color: 'var(--color-text-primary)', borderBottom: '1px solid var(--color-border-subtle)' }}>
                            {formatBps(s.shockedRate)}
                          </td>
                          <td className="px-5 py-3 text-sm font-medium tabular-nums" style={{ color: s.impactBps >= 0 ? '#166534' : '#991b1b', borderBottom: '1px solid var(--color-border-subtle)' }}>
                            {s.impactBps >= 0 ? '+' : ''}{s.impactBps} bps
                          </td>
                          <td className="px-5 py-3" style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                            <span
                              className="rounded-full px-2 py-0.5 text-xs font-semibold"
                              style={{
                                background: s.breachesVaR ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.08)',
                                color: s.breachesVaR ? '#991b1b' : '#166534',
                              }}
                            >
                              {s.breachesVaR ? 'YES' : 'NO'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}

          {/* Protocol TVL breakdown */}
          {tvls.length > 0 && hhiMetrics && (
            <motion.div {...delayedFadeIn(0.45)}>
              <div className="mt-12">
                <SectionHeading title="Protocol Breakdown" />
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
                        {['Protocol', 'TVL', 'Weight', 'Status'].map((h) => (
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
                      {tvls
                        .filter((t) => t.tvl > 0)
                        .sort((a, b) => b.tvl - a.tvl)
                        .map((t) => {
                          const total = tvls.reduce((s, x) => s + x.tvl, 0)
                          const weight = total > 0 ? (t.tvl / total) * 100 : 0
                          return (
                            <tr key={t.protocol}>
                              <td className="px-5 py-3 text-sm font-medium" style={{ color: 'var(--color-text-primary)', borderBottom: '1px solid var(--color-border-subtle)' }}>
                                {t.protocol}
                              </td>
                              <td className="px-5 py-3 text-sm tabular-nums" style={{ color: 'var(--color-text-primary)', borderBottom: '1px solid var(--color-border-subtle)' }}>
                                ${(t.tvl / 1e9).toFixed(2)}B
                              </td>
                              <td className="px-5 py-3" style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                                <div className="flex items-center gap-2">
                                  <div className="h-1.5 w-16 overflow-hidden rounded-full" style={{ background: 'var(--color-surface)' }}>
                                    <div className="h-full rounded-full" style={{ width: `${weight}%`, background: 'var(--color-text-primary)', opacity: 0.4 }} />
                                  </div>
                                  <span className="text-sm tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>
                                    {weight.toFixed(1)}%
                                  </span>
                                </div>
                              </td>
                              <td className="px-5 py-3" style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                                <span
                                  className="rounded-full px-2 py-0.5 text-xs font-medium"
                                  style={{ background: 'rgba(34,197,94,0.08)', color: '#166534' }}
                                >
                                  Active
                                </span>
                              </td>
                            </tr>
                          )
                        })}
                    </tbody>
                  </table>
                  <div className="flex items-center justify-between px-5 py-3 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                    <span>HHI: {hhiMetrics.hhi.toFixed(4)} ({hhiMetrics.level})</span>
                    <span>Effective sources: {hhiMetrics.effectiveSources}</span>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
          {/* Oracle contract */}
          <motion.div {...delayedFadeIn(0.5)}>
            <div className="mt-8 flex items-center gap-2 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              <span>Oracle contract:</span>
              <a
                href={etherscanLink(ORACLE_ADDRESSES[asset])}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono transition-colors duration-100"
                style={{ color: 'var(--color-accent-pink)' }}
              >
                {shortenAddress(ORACLE_ADDRESSES[asset])}
              </a>
              <span>Network: Sepolia</span>
            </div>
          </motion.div>
        </>
      ) : (
        <div
          className="rounded-xl py-12 text-center text-sm"
          style={{ color: 'var(--color-text-tertiary)', background: 'var(--color-surface)' }}
        >
          No data available for {asset}. Connect to Sepolia.
        </div>
      )}
    </main>
  )
}

function BigMetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: 'var(--color-card)',
        boxShadow: '0 0 0 1px var(--color-border-subtle), 0 4px 16px rgba(0,0,0,0.06)',
      }}
    >
      <div className="mb-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{label}</div>
      <div className="text-2xl font-semibold tabular-nums tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
        {value}
      </div>
    </div>
  )
}

function SmallMetricCard({ label, value, subtitle, alert }: { label: string; value: string; subtitle?: string; alert?: boolean }) {
  return (
    <div className="rounded-xl px-5 py-4" style={{ background: 'var(--color-surface)' }}>
      <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{label}</div>
      <div
        className="mt-1 text-sm font-semibold tabular-nums"
        style={{ color: alert ? '#991b1b' : 'var(--color-text-primary)' }}
      >
        {value}
      </div>
      {subtitle && (
        <div className="mt-0.5 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{subtitle}</div>
      )}
    </div>
  )
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl px-5 py-4" style={{ background: 'var(--color-surface)' }}>
      <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums" style={{ color: 'var(--color-text-primary)' }}>
        {value}
      </div>
    </div>
  )
}

function TradFiCard({ title, subtitle, rate, date, detail }: { title: string; subtitle: string; rate: number; date: string; detail: string }) {
  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: 'var(--color-card)',
        boxShadow: '0 0 0 1px var(--color-border-subtle), 0 4px 16px rgba(0,0,0,0.06)',
      }}
    >
      <div className="mb-1 flex items-center gap-2">
        <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{title}</span>
        <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{subtitle}</span>
      </div>
      <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{date}</div>
      <div className="mt-3 text-2xl font-semibold tabular-nums tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
        {rate.toFixed(2)}%
      </div>
      <div className="mt-2 text-xs tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{detail}</div>
    </div>
  )
}

function RiskScoreCard({ label, score, max }: { label: string; score: number; max: number }) {
  const pct = max > 0 ? (score / max) * 100 : 0
  return (
    <div className="rounded-xl px-5 py-4" style={{ background: 'var(--color-surface)' }}>
      <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{label}</div>
      <div className="mt-1 text-sm font-semibold tabular-nums" style={{ color: 'var(--color-text-primary)' }}>
        {score} / {max}
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--color-border-medium)' }}>
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${pct}%`,
            background: pct === 0 ? 'var(--color-accent-green)' : pct < 50 ? 'var(--color-text-primary)' : 'var(--color-accent-pink)',
            opacity: pct === 0 ? 0.5 : 0.6,
          }}
        />
      </div>
    </div>
  )
}

