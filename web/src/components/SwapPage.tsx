import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useAccount } from 'wagmi'
import {
  useSwapCount,
  useMultipleSwaps,
  useCreateSwap,
  useJoinSwap,
  useCancelSwap,
  useSettleSwap,
  useCloseSwap,
  useSwapCategories,
  SWAP_STATUS,
  type SwapWithPnL,
} from '@/hooks/useSwapData'
import {
  formatBps,
  formatEthValue,
  formatDuration,
  shortenAddress,
  formatTimestamp,
  formatSignedEth,
  formatTimeRemaining,
  etherscanLink,
} from '@/utils/format'
import { ease, fadeIn, stagger } from '@/utils/motion'
import { SWAP_ADDRESS } from '@/lib/contracts'
import { useAIInsightData, type RiskLevel, type RateDirection, type SpreadHealth, type MarketRegime } from '@/hooks/useAIInsightData'
import SectionHeading from '@/components/elements/SectionHeading'
import MetricRow from '@/components/elements/MetricRow'
import RateChart from '@/components/RateChart'
import ErrorBanner from '@/components/elements/ErrorBanner'

type FilterTab = 'all' | 'open' | 'active' | 'my-positions' | 'settleable' | 'at-risk' | 'expired'

export default function SwapPage() {
  const [showCreate, setShowCreate] = useState(false)
  const [activeTab, setActiveTab] = useState<FilterTab>('all')
  const [chartSwapId, setChartSwapId] = useState<number | null>(null)
  const { address } = useAccount()
  const { data: swapCount } = useSwapCount()
  const count = swapCount ? Number(swapCount) : 0
  const { swaps, isLoading, error: swapError } = useMultipleSwaps(count)
  const { settleable, expired, atRisk, currentRate } = useSwapCategories()
  const { insight: aiInsight } = useAIInsightData()

  const settleableSet = new Set(settleable)
  const expiredSet = new Set(expired)
  const atRiskSet = new Set(atRisk)

  // My positions: swaps where connected wallet holds the NFT (not just original party)
  const myPositions = useMemo(() => {
    if (!address) return []
    const addr = address.toLowerCase()
    return swaps.filter((s) => {
      // Check NFT ownership first (active swaps)
      if (s.nft) {
        if (s.nft.fixedHolder?.toLowerCase() === addr) return true
        if (s.nft.floatingHolder?.toLowerCase() === addr) return true
      }
      // Fallback: original party for non-active swaps
      if (s.fixedPayer.toLowerCase() === addr) return true
      if (s.floatingPayer.toLowerCase() === addr) return true
      return false
    })
  }, [swaps, address])

  const filteredSwaps = swaps.filter((s) => {
    switch (activeTab) {
      case 'open': return s.status === 0
      case 'active': return s.status === 1
      case 'my-positions': return myPositions.some((p) => p.id === s.id)
      case 'settleable': return settleableSet.has(s.id)
      case 'at-risk': return atRiskSet.has(s.id)
      case 'expired': return expiredSet.has(s.id)
      default: return true
    }
  })

  // Market overview stats
  const marketStats = useMemo(() => {
    const active = swaps.filter((s) => s.status === 1)
    const open = swaps.filter((s) => s.status === 0)
    const totalNotional = active.reduce((acc, s) => acc + s.notional, 0n)
    const avgFixed = active.length > 0
      ? Math.round(active.reduce((acc, s) => acc + Number(s.fixedRateBps), 0) / active.length)
      : 0
    const totalMargin = active.reduce((acc, s) => acc + s.fixedPayerMargin + s.floatingPayerMargin, 0n)
    const marginHealth = totalNotional > 0n
      ? Number(totalMargin * 10000n / totalNotional) / 100
      : 0
    const transferred = active.filter((s) => s.nft && (s.nft.fixedTransferred || s.nft.floatingTransferred)).length
    return { activeCount: active.length, openCount: open.length, totalNotional, avgFixed, totalMargin, marginHealth, transferred }
  }, [swaps])

  const tabs: { key: FilterTab; label: string; count?: number }[] = [
    { key: 'all', label: 'All', count: swaps.length },
    { key: 'my-positions', label: 'My positions', count: myPositions.length },
    { key: 'open', label: 'Open', count: swaps.filter((s) => s.status === 0).length },
    { key: 'active', label: 'Active', count: swaps.filter((s) => s.status === 1).length },
    { key: 'settleable', label: 'Settleable', count: settleable.length },
    { key: 'at-risk', label: 'At Risk', count: atRisk.length },
    { key: 'expired', label: 'Expired', count: expired.length },
  ]

  return (
    <main className="mx-auto max-w-5xl px-6 pb-16 pt-10">
      <motion.div {...fadeIn}>
        <SectionHeading title="Interest Rate Swaps" />
        <p
          className="mb-6 max-w-xl text-[0.9375rem] leading-relaxed"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          Trade fixed vs floating rates settled against the DeBOR benchmark.
          Each position is an ERC-721 NFT, fully transferable on any marketplace.
        </p>
      </motion.div>

      {swapError && <ErrorBanner />}

      {/* AI Risk Hold Banner */}
      {aiInsight && aiInsight.isHighRisk && (
        <motion.div {...fadeIn} transition={{ duration: 0.18, ease, delay: 0.01 }}>
          <div
            className="mb-4 rounded-xl px-5 py-3"
            style={{
              background: 'rgba(239,68,68,0.06)',
              border: '1px solid rgba(239,68,68,0.15)',
            }}
          >
            <div className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: '#ef4444' }} />
              <span className="text-sm font-medium" style={{ color: '#991b1b' }}>
                AI Risk Hold Active
              </span>
            </div>
            <p className="mt-1 text-xs leading-relaxed" style={{ color: '#991b1b', opacity: 0.8 }}>
              The CRE AI analysis has flagged high risk conditions. Automated swap settlement is paused until risk level normalizes.
            </p>
          </div>
        </motion.div>
      )}

      {/* AI Market Intelligence Banner */}
      {aiInsight && aiInsight.lastAnalyzedAt > 0 && (
        <motion.div {...fadeIn} transition={{ duration: 0.18, ease, delay: 0.02 }}>
          <div
            className="mb-6 rounded-xl px-5 py-4"
            style={{
              background: 'var(--color-card)',
              boxShadow: '0 0 0 1px var(--color-border-subtle), 0 4px 16px rgba(0,0,0,0.06)',
            }}
          >
            <div className="mb-2.5 flex items-center gap-2">
              <span className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
                AI Market Intelligence
              </span>
              <span className="text-[0.625rem]" style={{ color: 'var(--color-text-tertiary)' }}>
                via CRE + Groq LLM
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <AiBadge label="Direction" value={aiInsight.rateDirection} colors={AI_DIRECTION_COLORS[aiInsight.rateDirection]} />
              <AiBadge label="Risk" value={aiInsight.riskLevel} colors={AI_RISK_COLORS[aiInsight.riskLevel]} />
              <AiBadge label="Regime" value={aiInsight.marketRegime} colors={AI_REGIME_COLORS[aiInsight.marketRegime]} />
              <AiBadge label="Spread" value={aiInsight.spreadHealth} colors={AI_SPREAD_COLORS[aiInsight.spreadHealth]} />
              {aiInsight.anomalyDetected && (
                <span
                  className="rounded-full px-2 py-0.5 text-xs font-medium"
                  style={{ background: 'rgba(239,68,68,0.08)', color: '#991b1b' }}
                >
                  Anomaly detected
                </span>
              )}
              <span className="ml-auto text-[0.625rem] tabular-nums" style={{ color: 'var(--color-text-tertiary)' }}>
                Score: {aiInsight.riskScore}/100
              </span>
            </div>
          </div>
        </motion.div>
      )}

      {/* Market Overview */}
      {!isLoading && swaps.length > 0 && (
        <motion.div {...fadeIn} transition={{ duration: 0.18, ease, delay: 0.04 }}>
          <div className="mb-8 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <OverviewStat label="Active swaps" value={String(marketStats.activeCount)} />
            <OverviewStat label="Open orders" value={String(marketStats.openCount)} />
            <OverviewStat label="Total notional" value={`${formatEthValue(marketStats.totalNotional)} ETH`} />
            <OverviewStat label="Avg fixed rate" value={marketStats.avgFixed > 0 ? formatBps(marketStats.avgFixed) : 'n/a'} />
            <OverviewStat label="Floating rate" value={currentRate !== null ? formatBps(currentRate) : '...'} />
            <OverviewStat
              label="Margin health"
              value={`${marketStats.marginHealth.toFixed(1)}%`}
              color={marketStats.marginHealth > 5 ? '#166534' : marketStats.marginHealth > 2 ? '#92400e' : '#991b1b'}
            />
            <OverviewStat label="Positions traded" value={String(marketStats.transferred)} accent />
          </div>
        </motion.div>
      )}

      <motion.div {...fadeIn} transition={{ duration: 0.18, ease, delay: 0.08 }}>
        <div className="mb-6 flex items-center gap-3">
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="rounded-lg px-4 py-2 text-sm font-medium transition-opacity duration-100 hover:opacity-85"
            style={{ background: 'var(--color-text-primary)', color: 'var(--color-page)' }}
          >
            {showCreate ? 'Cancel' : 'Create swap'}
          </button>
          <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            {count} swap{count !== 1 ? 's' : ''} total
          </span>
        </div>
      </motion.div>

      <motion.div {...fadeIn} transition={{ duration: 0.18, ease, delay: 0.1 }}>
        <div className="mb-6 flex flex-wrap gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className="rounded-lg px-3 py-1.5 text-sm transition-colors duration-100"
              style={{
                background: activeTab === tab.key ? 'var(--color-text-primary)' : 'transparent',
                color: activeTab === tab.key ? 'var(--color-page)' : 'var(--color-text-secondary)',
              }}
            >
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span className="ml-1.5 opacity-60">{tab.count}</span>
              )}
            </button>
          ))}
        </div>
      </motion.div>

      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <CreateSwapForm onClose={() => setShowCreate(false)} />
          </motion.div>
        )}
      </AnimatePresence>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl p-5"
              style={{ background: 'var(--color-card)', boxShadow: '0 0 0 1px var(--color-border-subtle)' }}
            >
              <div className="h-4 w-32 rounded" style={{ background: 'var(--color-surface)' }} />
              <div className="mt-3 h-3 w-48 rounded" style={{ background: 'var(--color-surface)' }} />
            </div>
          ))}
        </div>
      ) : filteredSwaps.length === 0 ? (
        <motion.div {...fadeIn}>
          <div
            className="rounded-xl py-12 text-center text-sm"
            style={{ color: 'var(--color-text-tertiary)', background: 'var(--color-surface)' }}
          >
            {activeTab === 'all'
              ? 'No swaps yet. Create the first one.'
              : activeTab === 'my-positions'
                ? 'No positions found. Create a swap or join one to get started.'
                : `No ${activeTab} swaps.`}
          </div>
        </motion.div>
      ) : (
        <div className="space-y-3">
          {[...filteredSwaps].reverse().map((swap, i) => (
            <motion.div key={swap.id} {...fadeIn} transition={{ duration: 0.18, ease, delay: i * 0.03 }}>
              <SwapCard
                swap={swap}
                userAddress={address}
                isSettleable={settleableSet.has(swap.id)}
                isExpired={expiredSet.has(swap.id)}
                isAtRisk={atRiskSet.has(swap.id)}
              />
            </motion.div>
          ))}
        </div>
      )}

      {/* Rate vs Fixed Comparison */}
      {swaps.filter((s) => s.status === 1).length > 0 && (
        <motion.div {...fadeIn} transition={{ duration: 0.18, ease, delay: 0.2 }}>
          <div className="mt-12">
            <SectionHeading title="Rate vs Fixed" />
            <p
              className="mb-4 max-w-xl text-[0.9375rem] leading-relaxed"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              Compare the live DeBOR floating rate against a swap's locked-in fixed rate.
              The reference line shows your fixed position.
            </p>
            <div className="mb-4 flex flex-wrap items-center gap-1">
              {swaps.filter((s) => s.status === 1).map((s) => (
                <button
                  key={s.id}
                  onClick={() => setChartSwapId(s.id === chartSwapId ? null : s.id)}
                  className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
                  style={{
                    background: chartSwapId === s.id ? 'var(--color-text-primary)' : 'transparent',
                    color: chartSwapId === s.id ? 'var(--color-card)' : 'var(--color-text-secondary)',
                    border: chartSwapId === s.id ? 'none' : '1px solid var(--color-border-medium)',
                  }}
                >
                  #{s.id} ({formatBps(s.fixedRateBps)} fixed)
                </button>
              ))}
            </div>
            {chartSwapId !== null && (() => {
              const selectedSwap = swaps.find((s) => s.id === chartSwapId)
              if (!selectedSwap) return null
              return (
                <RateChart
                  defaultAsset="USDC"
                  hideAssetSelector
                  referenceLine={{ value: Number(selectedSwap.fixedRateBps), label: `Swap #${chartSwapId} fixed` }}
                />
              )
            })()}
            {chartSwapId === null && (
              <div
                className="rounded-xl py-8 text-center text-sm"
                style={{ color: 'var(--color-text-tertiary)', background: 'var(--color-surface)' }}
              >
                Select an active swap above to see how its fixed rate compares to the floating DeBOR benchmark.
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* CRE Automation */}
      <motion.div {...fadeIn} transition={{ duration: 0.18, ease, delay: 0.25 }}>
        <div className="mt-16">
          <SectionHeading title="Automated Clearing (CRE)" />
          <p
            className="mb-6 max-w-xl text-[0.9375rem] leading-relaxed"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            Every swap is managed by Chainlink CRE, acting as a decentralized clearinghouse.
            No manual intervention required after creation.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {CRE_STEPS.map((step, i) => (
              <motion.div key={step.title} {...stagger(i)}>
                <div
                  className="rounded-xl p-5"
                  style={{ background: 'var(--color-card)', border: '1px solid var(--color-border-medium)' }}
                >
                  <div
                    className="mb-3 flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold"
                    style={{ background: 'var(--color-accent-pink-bg)', color: 'var(--color-accent-pink)' }}
                  >
                    {i + 1}
                  </div>
                  <div className="mb-1 text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                    {step.title}
                  </div>
                  <div className="text-[0.8125rem] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                    {step.desc}
                  </div>
                  <div
                    className="mt-2 text-[0.6875rem] tabular-nums"
                    style={{ color: 'var(--color-text-tertiary)' }}
                  >
                    {step.schedule}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </motion.div>

      {/* NFT Secondary Market */}
      <motion.div {...fadeIn} transition={{ duration: 0.18, ease, delay: 0.3 }}>
        <div className="mt-16">
          <SectionHeading title="Position NFTs" />
          <p
            className="mb-6 max-w-xl text-[0.9375rem] leading-relaxed"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            Each swap mints two ERC-721 tokens: one for the fixed payer, one for the floating payer.
            Transfer your NFT to sell your position. The new holder receives all future settlements.
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <NftInfoCard
              title="Transferable while active"
              desc="NFTs can be traded on any marketplace (OpenSea, Blur) while the swap is active. Locked after settlement."
            />
            <NftInfoCard
              title="Settlement follows holder"
              desc="closeSwap() pays margins to the current ownerOf(), not the original creator. Buyers inherit the position."
            />
            <NftInfoCard
              title="On-chain metadata"
              desc="tokenURI() returns base64 JSON with role, fixed rate, notional, and status. Fully composable."
            />
          </div>
          <div className="mt-4 flex items-center gap-2 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
            <span>Contract:</span>
            <a
              href={etherscanLink(SWAP_ADDRESS)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono transition-colors duration-100"
              style={{ color: 'var(--color-accent-pink)' }}
            >
              {shortenAddress(SWAP_ADDRESS)}
            </a>
            <span>Token name: DeBOR Swap Position (DEBOR-SWAP)</span>
          </div>
        </div>
      </motion.div>
    </main>
  )
}

const CRE_STEPS = [
  {
    title: 'Auto-settlement',
    desc: 'Settles all active swaps daily. Net payment flows from losing side to winning side based on DeBOR rate vs fixed rate.',
    schedule: 'Every 30 min at :05/:35',
  },
  {
    title: 'Liquidation guard',
    desc: 'Monitors margin health hourly. When either side drops below 2% of notional, triggers emergency settlement.',
    schedule: 'Continuous monitoring',
  },
  {
    title: 'Rate spike detector',
    desc: 'Analyzes rate trends via filterLogs. When rates move more than 100bps in an hour, triggers emergency settlement.',
    schedule: 'After each benchmark update',
  },
  {
    title: 'Anomaly detector',
    desc: 'EVM Log trigger on BenchmarkUpdated events. Detects manipulated rates (200bps+ sudden move) and protects margins.',
    schedule: 'Event-driven (real-time)',
  },
]

function OverviewStat({ label, value, accent, color }: { label: string; value: string; accent?: boolean; color?: string }) {
  return (
    <div className="rounded-xl px-4 py-3" style={{ background: 'var(--color-surface)' }}>
      <div className="text-[0.6875rem] font-medium" style={{ color: 'var(--color-text-secondary)' }}>
        {label}
      </div>
      <div
        className="mt-0.5 text-sm font-semibold tabular-nums"
        style={{ color: color || (accent ? 'var(--color-accent-pink)' : 'var(--color-text-primary)') }}
      >
        {value}
      </div>
    </div>
  )
}

function NftInfoCard({ title, desc }: { title: string; desc: string }) {
  return (
    <div
      className="rounded-xl p-5"
      style={{ background: 'var(--color-card)', boxShadow: '0 0 0 1px var(--color-border-subtle)' }}
    >
      <div className="mb-1 text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
        {title}
      </div>
      <div className="text-[0.8125rem] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
        {desc}
      </div>
    </div>
  )
}

function CreateSwapForm({ onClose }: { onClose: () => void }) {
  const [fixedRate, setFixedRate] = useState('500')
  const [duration, setDuration] = useState('30')
  const [margin, setMargin] = useState('0.01')
  const { createSwap, isPending, isConfirming, isSuccess, error, reset } = useCreateSwap()
  const { address } = useAccount()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    createSwap(Number(fixedRate), Number(duration), margin)
  }

  if (isSuccess) {
    return (
      <div
        className="mb-8 rounded-xl p-5"
        style={{ background: 'rgba(34,197,94,0.06)', color: '#166534' }}
      >
        <div className="text-sm font-medium">Swap created</div>
        <div className="mt-1 text-xs opacity-70">Your swap is now open for a counterparty to join.</div>
      </div>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-8 rounded-xl p-5"
      style={{ background: 'var(--color-card)', border: '1px solid var(--color-border-medium)' }}
    >
      <div className="mb-4 text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
        Create new swap (fixed payer)
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            Fixed rate (bps)
          </label>
          <input
            type="number"
            value={fixedRate}
            onChange={(e) => setFixedRate(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style={{
              borderColor: 'rgba(0,0,0,0.12)',
              background: 'transparent',
              color: 'var(--color-text-primary)',
            }}
            min={1}
            max={5000}
            required
          />
          <div className="mt-1 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
            = {formatBps(Number(fixedRate))} APR
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            Duration (days)
          </label>
          <input
            type="number"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style={{
              borderColor: 'rgba(0,0,0,0.12)',
              background: 'transparent',
              color: 'var(--color-text-primary)',
            }}
            min={1}
            max={365}
            required
          />
        </div>

        <div>
          <label className="mb-1 block text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            Margin (ETH)
          </label>
          <input
            type="text"
            value={margin}
            onChange={(e) => setMargin(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style={{
              borderColor: 'rgba(0,0,0,0.12)',
              background: 'transparent',
              color: 'var(--color-text-primary)',
            }}
            required
          />
          <div className="mt-1 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
            10% margin = {margin ? (Number(margin) * 10).toFixed(4) : '0'} ETH notional
          </div>
        </div>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <button
          type="submit"
          disabled={!address || isPending || isConfirming}
          className="rounded-lg px-4 py-2 text-sm font-medium transition-opacity duration-100 hover:opacity-85 disabled:opacity-35 disabled:cursor-not-allowed"
          style={{ background: 'var(--color-text-primary)', color: 'var(--color-page)' }}
        >
          {isPending ? 'Confirm in wallet...' : isConfirming ? 'Confirming...' : 'Create swap'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border px-4 py-2 text-sm font-medium transition-colors duration-100"
          style={{ borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-secondary)' }}
        >
          Cancel
        </button>
        {!address && (
          <span className="text-xs" style={{ color: 'var(--color-accent-pink)' }}>
            Connect wallet first
          </span>
        )}
      </div>
      {error && (
        <div
          className="mt-3 flex items-center justify-between rounded-lg px-4 py-2.5 text-xs"
          style={{ background: 'rgba(239,68,68,0.06)', color: '#991b1b' }}
        >
          <span>{error.message?.includes('User rejected') ? 'Transaction rejected in wallet.' : 'Transaction failed. Please try again.'}</span>
          <button onClick={reset} className="shrink-0 font-medium underline" style={{ color: '#991b1b' }}>
            Dismiss
          </button>
        </div>
      )}
    </form>
  )
}

function SwapCard({
  swap,
  userAddress,
  isSettleable,
  isExpired,
  isAtRisk,
}: {
  swap: SwapWithPnL
  userAddress?: string
  isSettleable: boolean
  isExpired: boolean
  isAtRisk: boolean
}) {
  const [showJoin, setShowJoin] = useState(false)
  const statusLabel = SWAP_STATUS[swap.status]
  const isOpen = swap.status === 0
  const isActive = swap.status === 1

  // Check ownership via NFT holder (secondary market aware)
  const addr = userAddress?.toLowerCase()
  const isUserFixedHolder = swap.nft?.fixedHolder?.toLowerCase() === addr
  const isUserFloatingHolder = swap.nft?.floatingHolder?.toLowerCase() === addr
  const isUserFixed = addr === swap.fixedPayer.toLowerCase() || isUserFixedHolder
  const isUserFloating = addr === swap.floatingPayer.toLowerCase() || isUserFloatingHolder

  const { joinSwap, isPending: joinPending, isConfirming: joinConfirming } = useJoinSwap()
  const { cancelSwap, isPending: cancelPending } = useCancelSwap()
  const { settle, isPending: settlePending, isConfirming: settleConfirming } = useSettleSwap()
  const { closeSwap, isPending: closePending, isConfirming: closeConfirming } = useCloseSwap()

  const requiredMargin = formatEthValue((swap.notional * 1000n) / 10000n)

  const userPnl = swap.pnl && (isUserFixed || isUserFloating)
    ? formatSignedEth(isUserFixed ? swap.pnl.fixed : swap.pnl.floating)
    : null

  // Expiration countdown
  const now = Math.floor(Date.now() / 1000)
  const expiresAt = Number(swap.startedAt) + Number(swap.duration)
  const remaining = isActive ? Math.max(0, expiresAt - now) : 0
  const isExpiring = remaining > 0 && remaining < 86400

  // Margin adequacy
  const totalMargin = swap.fixedPayerMargin + swap.floatingPayerMargin
  const marginPct = swap.notional > 0n ? Number(totalMargin * 10000n / swap.notional) / 100 : 0
  const marginColor = marginPct > 5 ? '#166534' : marginPct > 2 ? '#92400e' : '#991b1b'

  // Settlement hint
  const SETTLEMENT_INTERVAL = 86400
  const lastSettlement = Number(swap.startedAt) + Number(swap.totalSettlements) * SETTLEMENT_INTERVAL
  const nextSettlement = lastSettlement + SETTLEMENT_INTERVAL
  const timeUntilSettlement = isActive ? Math.max(0, nextSettlement - now) : 0

  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: 'var(--color-card)',
        boxShadow: isAtRisk
          ? '0 0 0 1px rgba(239,68,68,0.3), 0 4px 16px rgba(239,68,68,0.08)'
          : '0 0 0 1px var(--color-border-subtle), 0 4px 16px rgba(0,0,0,0.06)',
      }}
    >
      <div className="flex items-start justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            Swap #{swap.id}
          </span>
          <StatusBadge status={statusLabel} />
          {isUserFixedHolder && <RoleBadge role="Fixed holder" />}
          {isUserFloatingHolder && <RoleBadge role="Float holder" />}
          {!isUserFixedHolder && isUserFixed && isOpen && <RoleBadge role="Fixed" />}
          {isAtRisk && <WarningBadge label="At risk" />}
          {isSettleable && <ActionBadge label="Settleable" />}
          {isExpired && <ActionBadge label="Expired" />}
          {isActive && <NftBadge />}
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold tabular-nums tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
            {formatBps(swap.fixedRateBps)}
          </div>
          <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>fixed rate</div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricRow label="Notional" value={`${formatEthValue(swap.notional)} ETH`} />
        <MetricRow label="Duration" value={formatDuration(swap.duration)} />
        <MetricRow label="Fixed margin" value={`${formatEthValue(swap.fixedPayerMargin)} ETH`} />
        {isActive && (
          <MetricRow label="Float margin" value={`${formatEthValue(swap.floatingPayerMargin)} ETH`} />
        )}
        {isActive && (
          <MetricRow label="Settlements" value={String(Number(swap.totalSettlements))} />
        )}
        {swap.startedAt > 0n && (
          <MetricRow label="Started" value={formatTimestamp(swap.startedAt)} />
        )}
        <MetricRow label="Fixed payer" value={shortenAddress(swap.fixedPayer)} />
        {swap.floatingPayer !== '0x0000000000000000000000000000000000000000' && (
          <MetricRow label="Float payer" value={shortenAddress(swap.floatingPayer)} />
        )}
      </div>

      {/* NFT Ownership section */}
      {swap.nft && (
        <div
          className="mt-4 rounded-lg px-3 py-2.5"
          style={{ background: 'var(--color-surface)' }}
        >
          <div className="mb-1.5 text-[0.6875rem] font-medium" style={{ color: 'var(--color-text-tertiary)' }}>
            Position NFTs
          </div>
          <div className="grid grid-cols-2 gap-3">
            <NftPosition
              label="Fixed"
              tokenId={swap.nft.fixedTokenId}
              holder={swap.nft.fixedHolder}
              original={swap.fixedPayer}
              transferred={swap.nft.fixedTransferred}
            />
            <NftPosition
              label="Floating"
              tokenId={swap.nft.floatingTokenId}
              holder={swap.nft.floatingHolder}
              original={swap.floatingPayer}
              transferred={swap.nft.floatingTransferred}
            />
          </div>
        </div>
      )}

      {/* Swap enhancements: expiration, margin, settlement */}
      {isActive && (
        <div className="mt-4 flex flex-wrap items-center gap-4">
          {remaining > 0 && (
            <div className="flex items-center gap-1.5 text-xs">
              <span style={{ color: 'var(--color-text-secondary)' }}>Expires in</span>
              <span
                className="font-medium tabular-nums"
                style={{ color: isExpiring ? '#991b1b' : 'var(--color-text-primary)' }}
              >
                {formatTimeRemaining(remaining)}
              </span>
            </div>
          )}
          <div className="flex items-center gap-1.5 text-xs">
            <span style={{ color: 'var(--color-text-secondary)' }}>Margin</span>
            <div className="flex items-center gap-1.5">
              <div className="h-1.5 w-16 overflow-hidden rounded-full" style={{ background: 'var(--color-surface)' }}>
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.min(marginPct * 10, 100)}%`, background: marginColor }}
                />
              </div>
              <span className="font-medium tabular-nums" style={{ color: marginColor }}>
                {marginPct.toFixed(1)}%
              </span>
            </div>
          </div>
          {timeUntilSettlement > 0 && (
            <div className="flex items-center gap-1.5 text-xs">
              <span style={{ color: 'var(--color-text-secondary)' }}>Next settlement</span>
              <span className="font-medium tabular-nums" style={{ color: 'var(--color-text-primary)' }}>
                {formatTimeRemaining(timeUntilSettlement)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Per-swap CRE handler indicators */}
      {isActive && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[0.625rem] font-medium" style={{ color: 'var(--color-text-tertiary)' }}>
            CRE:
          </span>
          <CreIndicator label="Auto-settle" active={isSettleable} />
          <CreIndicator label="Liquidation guard" active={isAtRisk} warning />
          <CreIndicator label="Expiry close" active={isExpired} />
          <CreIndicator label="Spike monitor" active />
        </div>
      )}

      {isActive && userPnl && !userPnl.isZero && (
        <div
          className="mt-4 rounded-lg px-3 py-2"
          style={{
            background: userPnl.isPositive ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
          }}
        >
          <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>Your P&L </span>
          <span
            className="text-sm font-semibold tabular-nums"
            style={{ color: userPnl.isPositive ? '#166534' : '#991b1b' }}
          >
            {userPnl.text}
          </span>
        </div>
      )}

      {isActive && swap.pnl && !isUserFixed && !isUserFloating && (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <PnlRow label="Fixed payer P&L" pnl={swap.pnl.fixed} />
          <PnlRow label="Float payer P&L" pnl={swap.pnl.floating} />
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {isOpen && !isUserFixed && userAddress && (
          showJoin ? (
            <>
              <button
                onClick={() => joinSwap(swap.id, requiredMargin)}
                disabled={joinPending || joinConfirming}
                className="rounded-lg px-4 py-2 text-sm font-medium transition-opacity duration-100 hover:opacity-85 disabled:opacity-35"
                style={{ background: 'var(--color-text-primary)', color: 'var(--color-page)' }}
              >
                {joinPending ? 'Confirm...' : joinConfirming ? 'Confirming...' : `Join (${requiredMargin} ETH)`}
              </button>
              <button
                onClick={() => setShowJoin(false)}
                className="text-sm underline"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={() => setShowJoin(true)}
              className="rounded-lg border px-4 py-2 text-sm font-medium transition-colors duration-100"
              style={{ borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-primary)' }}
            >
              Join as floating payer
            </button>
          )
        )}

        {isOpen && isUserFixed && (
          <button
            onClick={() => cancelSwap(swap.id)}
            disabled={cancelPending}
            className="text-sm underline transition-colors duration-100"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            {cancelPending ? 'Cancelling...' : 'Cancel swap'}
          </button>
        )}

        {isSettleable && (
          <button
            onClick={() => settle(swap.id)}
            disabled={settlePending || settleConfirming}
            className="rounded-lg px-4 py-2 text-sm font-medium transition-opacity duration-100 hover:opacity-85 disabled:opacity-35"
            style={{ background: '#166534', color: '#fff' }}
          >
            {settlePending ? 'Confirm...' : settleConfirming ? 'Settling...' : 'Settle'}
          </button>
        )}

        {isExpired && (
          <button
            onClick={() => closeSwap(swap.id)}
            disabled={closePending || closeConfirming}
            className="rounded-lg border px-4 py-2 text-sm font-medium transition-opacity duration-100 hover:opacity-85 disabled:opacity-35"
            style={{ borderColor: 'var(--color-border-medium)', color: 'var(--color-text-primary)' }}
          >
            {closePending ? 'Confirm...' : closeConfirming ? 'Closing...' : 'Close swap'}
          </button>
        )}
      </div>
    </div>
  )
}

function NftPosition({
  label,
  tokenId,
  holder,
  original,
  transferred,
}: {
  label: string
  tokenId: number
  holder: string | null
  original: string
  transferred: boolean
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
          {label} #{tokenId}
        </span>
        {transferred && (
          <span
            className="rounded-full px-1.5 py-px text-[0.625rem] font-medium"
            style={{ background: 'var(--color-accent-pink-bg)', color: 'var(--color-accent-pink)' }}
          >
            Traded
          </span>
        )}
      </div>
      <div className="mt-0.5 text-xs tabular-nums" style={{ color: 'var(--color-text-primary)' }}>
        {holder ? shortenAddress(holder) : 'n/a'}
      </div>
      {transferred && (
        <div className="text-[0.625rem]" style={{ color: 'var(--color-text-tertiary)' }}>
          was {shortenAddress(original)}
        </div>
      )}
    </div>
  )
}

function PnlRow({ label, pnl }: { label: string; pnl: bigint }) {
  const formatted = formatSignedEth(pnl)
  return (
    <div>
      <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{label}</div>
      <div
        className="text-sm font-medium tabular-nums"
        style={{ color: formatted.isZero ? 'var(--color-text-primary)' : formatted.isPositive ? '#166534' : '#991b1b' }}
      >
        {formatted.text}
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; fg: string }> = {
    Open: { bg: 'rgba(59,130,246,0.08)', fg: '#1e40af' },
    Active: { bg: 'rgba(34,197,94,0.08)', fg: '#166534' },
    Settled: { bg: 'rgba(0,0,0,0.04)', fg: 'var(--color-text-secondary)' },
    Liquidated: { bg: 'rgba(239,68,68,0.08)', fg: '#991b1b' },
  }
  const c = colors[status] || colors.Settled
  return (
    <span
      className="rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ background: c.bg, color: c.fg }}
    >
      {status}
    </span>
  )
}

function RoleBadge({ role }: { role: string }) {
  return (
    <span
      className="rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ background: 'var(--color-accent-pink-bg)', color: 'var(--color-accent-pink)' }}
    >
      You: {role}
    </span>
  )
}

function NftBadge() {
  return (
    <span
      className="rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ background: 'rgba(59,130,246,0.08)', color: '#1e40af' }}
    >
      NFT
    </span>
  )
}

function WarningBadge({ label }: { label: string }) {
  return (
    <span
      className="rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ background: 'rgba(239,68,68,0.08)', color: '#991b1b' }}
    >
      {label}
    </span>
  )
}

function ActionBadge({ label }: { label: string }) {
  return (
    <span
      className="rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ background: 'rgba(34,197,94,0.08)', color: '#166534' }}
    >
      {label}
    </span>
  )
}

function CreIndicator({ label, active, warning }: { label: string; active?: boolean; warning?: boolean }) {
  const dotColor = active
    ? (warning ? '#991b1b' : '#166534')
    : 'var(--color-text-tertiary)'
  return (
    <span className="flex items-center gap-1 text-[0.625rem]" style={{ color: 'var(--color-text-secondary)' }}>
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: dotColor }}
      />
      {label}
    </span>
  )
}

// AI Insight color maps (matching AIInsightPage)
const AI_RISK_COLORS: Record<RiskLevel, { bg: string; fg: string }> = {
  Low: { bg: 'rgba(34,197,94,0.08)', fg: '#166534' },
  Medium: { bg: 'rgba(245,158,11,0.08)', fg: '#92400e' },
  High: { bg: 'rgba(239,68,68,0.08)', fg: '#991b1b' },
  Critical: { bg: 'rgba(239,68,68,0.12)', fg: '#7f1d1d' },
}
const AI_DIRECTION_COLORS: Record<RateDirection, { bg: string; fg: string }> = {
  Stable: { bg: 'rgba(59,130,246,0.08)', fg: '#1e40af' },
  Rising: { bg: 'rgba(34,197,94,0.08)', fg: '#166534' },
  Falling: { bg: 'rgba(239,68,68,0.08)', fg: '#991b1b' },
}
const AI_SPREAD_COLORS: Record<SpreadHealth, { bg: string; fg: string }> = {
  Normal: { bg: 'rgba(34,197,94,0.08)', fg: '#166534' },
  Compressed: { bg: 'rgba(245,158,11,0.08)', fg: '#92400e' },
  Inverted: { bg: 'rgba(239,68,68,0.08)', fg: '#991b1b' },
}
const AI_REGIME_COLORS: Record<MarketRegime, { bg: string; fg: string }> = {
  Converged: { bg: 'rgba(34,197,94,0.08)', fg: '#166534' },
  Normal: { bg: 'rgba(59,130,246,0.08)', fg: '#1e40af' },
  Diverged: { bg: 'rgba(245,158,11,0.08)', fg: '#92400e' },
  Dislocated: { bg: 'rgba(239,68,68,0.08)', fg: '#991b1b' },
}

function AiBadge({ label, value, colors }: { label: string; value: string; colors: { bg: string; fg: string } }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-[0.625rem]" style={{ color: 'var(--color-text-tertiary)' }}>{label}</span>
      <span
        className="rounded-full px-2 py-0.5 text-xs font-medium"
        style={{ background: colors.bg, color: colors.fg }}
      >
        {value}
      </span>
    </span>
  )
}
