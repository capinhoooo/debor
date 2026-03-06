import { motion } from 'motion/react'
import { useOracleData } from '@/hooks/useOracleData'
import { useCircuitBreaker } from '@/hooks/useCircuitBreaker'
import { useAIInsightData } from '@/hooks/useAIInsightData'
import { useCrossChainRates } from '@/hooks/useCrossChainData'
import { ease, fadeIn, stagger } from '@/utils/motion'
import SectionHeading from '@/components/elements/SectionHeading'

const PIPELINE_STAGES = [
  {
    step: '1',
    title: 'Multi-Chain Rate Aggregation',
    capability: 'EVMClient.callContract',
    detail: '43 protocol sources across 6 mainnet chains (Ethereum, Base, Arbitrum, Optimism, Avalanche, Polygon). Reads Aave V3, Compound V3, Spark, Morpho Blue, Moonwell, and Benqi lending rates every 30 minutes.',
    trigger: 'Cron (5 asset triggers)',
  },
  {
    step: '2',
    title: 'TVL-Weighted Benchmark',
    capability: 'HTTPClient + DON Consensus',
    detail: 'DeFiLlama TVL data fetched with DON consensus (5 nodes independently fetch, median aggregation). Benchmark computed as TVL-weighted average across all sources.',
    trigger: 'Cron',
  },
  {
    step: '3',
    title: 'Rate Guard + Risk Gate',
    capability: 'EVMClient.callContract',
    detail: 'Reads current on-chain rate, compares with new benchmark. Flags >500bps deviation. VaR/CVaR thresholds trip circuit breaker if risk is too high.',
    trigger: 'Inline (per update)',
  },
  {
    step: '4',
    title: 'Signed Report + Oracle Write',
    capability: 'runtime.report + EVMClient.writeReport',
    detail: 'DON-signed report encoding 8 uint256 values (rate, supply, spread, vol, sources, configured, TVL, term7d). Written to DeBOROracle ring buffer (336 entries per asset).',
    trigger: 'Cron',
  },
  {
    step: '5',
    title: 'Cross-Chain CCIP Relay',
    capability: 'EVMClient.writeReport (CCIP Sender)',
    detail: 'After oracle write, benchmark data is relayed to Base Sepolia, Arbitrum Sepolia, and OP Sepolia via Chainlink CCIP. Each L2 receiver stores the full benchmark.',
    trigger: 'Cron (chained)',
  },
  {
    step: '6',
    title: 'AI Market Intelligence',
    capability: 'ConfidentialHTTPClient (TEE)',
    detail: 'Groq LLM (llama-3.3-70b) analyzes all 5 benchmarks + SOFR data inside a Trusted Execution Environment. VaultDON injects API key. DON consensus on structured verdict fields.',
    trigger: 'HTTP (action="analyze")',
  },
  {
    step: '7',
    title: 'AI Circuit Breaker',
    capability: 'EVMClient.writeReport (Alert)',
    detail: 'If AI returns CRITICAL + anomalyDetected, an alert report is written to ALL 5 oracle contracts, activating the on-chain circuit breaker. Swap settlement is automatically paused.',
    trigger: 'AI-driven (autonomous)',
  },
  {
    step: '8',
    title: 'Swap Lifecycle Management',
    capability: 'EVMClient.callContract + filterLogs',
    detail: '3-phase pipeline: (1) Rate spike detection via filterLogs trend analysis, (2) Liquidation guard scanning at-risk positions, (3) Settlement + closure of matured swaps. AI risk hold gates all settlements.',
    trigger: 'Cron + EVM Log',
  },
  {
    step: '9',
    title: 'Risk Analysis Engine',
    capability: 'HTTPClient (SOFR) + Compute',
    detail: 'VaR/CVaR at 95/99% confidence, HHI concentration index, Basel IRRBB stress tests (6 scenarios: parallel shift, steepener, flattener, short rate up/down, inversion). Payment-gated.',
    trigger: 'HTTP (action="risk")',
  },
  {
    step: '10',
    title: 'Pre-flight Health Check',
    capability: 'headerByNumber + balanceAt + estimateGas',
    detail: 'Chain liveness, forwarder ETH balance, gas estimation, Chainlink price feed cross-reference. runInNodeMode with consensus timestamp. Confidential secret availability check.',
    trigger: 'Cron',
  },
]

const CRE_CAPABILITIES = [
  { name: 'EVMClient.callContract', desc: 'Read contract state on any chain' },
  { name: 'EVMClient.writeReport', desc: 'Write DON-signed reports on-chain' },
  { name: 'EVMClient.filterLogs', desc: 'Query historical event logs' },
  { name: 'EVMClient.headerByNumber', desc: 'Read block headers' },
  { name: 'EVMClient.balanceAt', desc: 'Check native token balances' },
  { name: 'EVMClient.estimateGas', desc: 'Dry-run gas estimation' },
  { name: 'EVMClient.getTransactionByHash', desc: 'Forensic tx analysis' },
  { name: 'EVMClient.getTransactionReceipt', desc: 'Post-write verification' },
  { name: 'EVMClient.logTrigger', desc: 'Push-based event subscription' },
  { name: 'HTTPClient.sendRequest', desc: 'DON consensus HTTP fetches' },
  { name: 'HTTPClient.sendReport', desc: 'Off-chain report distribution' },
  { name: 'ConfidentialHTTPClient', desc: 'TEE-based secret API calls' },
  { name: 'runtime.report', desc: 'DON-signed report generation' },
  { name: 'runtime.getSecret', desc: 'VaultDON secret retrieval' },
  { name: 'runtime.runInNodeMode', desc: 'Per-node independent execution' },
  { name: 'runtime.now', desc: 'DON-trusted timestamp' },
]

const CONSENSUS_STRATEGIES = [
  'Identical', 'Median', 'CommonPrefix', 'CommonSuffix',
  'Field-level identical', 'Field-level median', 'Field-level commonPrefix',
  'Field-level commonSuffix', 'Field-level ignore',
]

export default function PipelinePage() {
  const { benchmarks } = useOracleData()
  const { anyActive } = useCircuitBreaker()
  const { insight } = useAIInsightData()
  const { rates: ccRates } = useCrossChainRates()

  const liveAssets = benchmarks.filter((b) => b.data && b.data.rate > 0n).length
  const liveL2s = ccRates.filter((r) => r.rate > 0n && r.chain !== 'Sepolia').length
  const totalSources = benchmarks.reduce((sum, b) => sum + (b.data ? Number(b.data.sources) : 0), 0)

  return (
    <main className="mx-auto max-w-5xl px-6 pb-16 pt-10">
      <motion.div {...fadeIn}>
        <SectionHeading title="CRE Pipeline" />
        <p
          className="mb-8 max-w-2xl text-[0.9375rem] leading-relaxed"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          End-to-end view of the DeBOR Chainlink CRE workflow. 10 handlers
          across 3 trigger types, using 16 CRE SDK capabilities and all 9 DON
          consensus strategies. Every stage runs on decentralized oracle infrastructure.
        </p>
      </motion.div>

      {/* Live stats */}
      <motion.div {...fadeIn} transition={{ duration: 0.18, ease, delay: 0.04 }}>
        <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <LiveStatCard label="Live assets" value={`${liveAssets}/5`} />
          <LiveStatCard label="Active sources" value={String(totalSources)} />
          <LiveStatCard label="L2 destinations" value={`${liveL2s}/3`} />
          <LiveStatCard
            label="Circuit breaker"
            value={anyActive ? 'ACTIVE' : 'Nominal'}
            highlight={anyActive}
          />
        </div>
      </motion.div>

      {/* AI feedback loop visualization */}
      <motion.div {...stagger(1)}>
        <SectionHeading title="AI Feedback Loop" />
        <div
          className="mb-8 rounded-xl p-5"
          style={{
            background: 'var(--color-card)',
            boxShadow: '0 0 0 1px var(--color-border-subtle)',
          }}
        >
          <div className="flex flex-wrap items-center justify-center gap-2 text-xs font-medium">
            {[
              { label: 'CRE reads 43 sources', icon: '1' },
              { label: 'Benchmark computed', icon: '2' },
              { label: 'AI analyzes (TEE)', icon: '3' },
              { label: 'DON consensus', icon: '4' },
              { label: 'Verdict on-chain', icon: '5' },
              { label: 'Circuit breaker check', icon: '6' },
              { label: 'Swap settlement gated', icon: '7' },
            ].map((step, i, arr) => (
              <div key={step.icon} className="flex items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <span
                    className="flex h-5 w-5 items-center justify-center rounded-full text-[0.625rem] font-semibold"
                    style={{
                      background: 'var(--color-accent-pink-bg)',
                      color: 'var(--color-accent-pink)',
                    }}
                  >
                    {step.icon}
                  </span>
                  <span style={{ color: 'var(--color-text-primary)' }}>{step.label}</span>
                </div>
                {i < arr.length - 1 && (
                  <span style={{ color: 'var(--color-text-tertiary)' }}>&#8594;</span>
                )}
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-center gap-2">
            <span
              className="rounded-full border border-dashed px-3 py-1 text-[0.6875rem]"
              style={{
                borderColor: 'var(--color-accent-green)',
                color: 'var(--color-text-secondary)',
              }}
            >
              Loop: next cycle reads updated on-chain state
            </span>
          </div>

          {/* Live status */}
          {insight && insight.lastAnalyzedAt > 0 && (
            <div
              className="mt-4 flex flex-wrap items-center gap-3 border-t pt-3"
              style={{ borderColor: 'var(--color-border-subtle)' }}
            >
              <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                Current AI verdict:
              </span>
              <span
                className="rounded-full px-2 py-0.5 text-xs font-medium"
                style={{
                  background: insight.riskLevel === 'Critical' || insight.riskLevel === 'High'
                    ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.08)',
                  color: insight.riskLevel === 'Critical' || insight.riskLevel === 'High'
                    ? '#991b1b' : '#166534',
                }}
              >
                {insight.riskLevel} (score: {insight.riskScore})
              </span>
              <span
                className="rounded-full px-2 py-0.5 text-xs font-medium"
                style={{
                  background: 'rgba(59,130,246,0.08)',
                  color: '#1e40af',
                }}
              >
                {insight.marketRegime}
              </span>
              {insight.anomalyDetected && (
                <span
                  className="rounded-full px-2 py-0.5 text-xs font-semibold"
                  style={{ background: 'rgba(239,68,68,0.08)', color: '#991b1b' }}
                >
                  Anomaly flagged
                </span>
              )}
            </div>
          )}
        </div>
      </motion.div>

      {/* Pipeline stages */}
      <motion.div {...stagger(2)}>
        <SectionHeading title="10-Stage Pipeline" />
      </motion.div>
      <div className="mb-8 space-y-3">
        {PIPELINE_STAGES.map((stage, i) => (
          <motion.div key={stage.step} {...stagger(3 + i * 0.3)}>
            <div
              className="rounded-xl p-5"
              style={{
                background: 'var(--color-card)',
                boxShadow: '0 0 0 1px var(--color-border-subtle)',
              }}
            >
              <div className="flex items-start gap-4">
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                  style={{
                    background: 'var(--color-accent-pink-bg)',
                    color: 'var(--color-accent-pink)',
                  }}
                >
                  {stage.step}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span
                      className="text-sm font-medium"
                      style={{ color: 'var(--color-text-primary)' }}
                    >
                      {stage.title}
                    </span>
                    <span
                      className="rounded px-1.5 py-0.5 font-mono text-[0.625rem]"
                      style={{
                        background: 'var(--color-surface)',
                        color: 'var(--color-text-secondary)',
                      }}
                    >
                      {stage.capability}
                    </span>
                  </div>
                  <p
                    className="text-[0.8125rem] leading-relaxed"
                    style={{ color: 'var(--color-text-secondary)' }}
                  >
                    {stage.detail}
                  </p>
                  <div className="mt-2">
                    <span
                      className="rounded-full border px-2 py-0.5 text-[0.625rem] font-medium"
                      style={{
                        borderColor: 'var(--color-border-subtle)',
                        color: 'var(--color-text-tertiary)',
                      }}
                    >
                      Trigger: {stage.trigger}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* CRE capabilities used */}
      <motion.div {...stagger(6)}>
        <SectionHeading title="CRE SDK Capabilities Used" />
        <div
          className="mb-8 rounded-xl p-5"
          style={{
            background: 'var(--color-card)',
            boxShadow: '0 0 0 1px var(--color-border-subtle)',
          }}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            {CRE_CAPABILITIES.map((cap) => (
              <div key={cap.name} className="flex items-center gap-2">
                <span
                  className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: 'var(--color-accent-green)' }}
                />
                <span className="font-mono text-xs" style={{ color: 'var(--color-text-primary)' }}>
                  {cap.name}
                </span>
                <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                  {cap.desc}
                </span>
              </div>
            ))}
          </div>
        </div>
      </motion.div>

      {/* DON consensus strategies */}
      <motion.div {...stagger(7)}>
        <SectionHeading title="DON Consensus Strategies" />
        <div
          className="mb-8 rounded-xl p-5"
          style={{
            background: 'var(--color-card)',
            boxShadow: '0 0 0 1px var(--color-border-subtle)',
          }}
        >
          <div className="flex flex-wrap gap-2">
            {CONSENSUS_STRATEGIES.map((s) => (
              <span
                key={s}
                className="rounded-full border px-2.5 py-1 text-xs font-medium"
                style={{
                  borderColor: 'var(--color-border-subtle)',
                  color: 'var(--color-text-primary)',
                }}
              >
                {s}
              </span>
            ))}
          </div>
          <p
            className="mt-3 text-xs leading-relaxed"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            All 9 consensus aggregation strategies available in the CRE SDK are actively used.
            DON nodes independently fetch data and reach consensus before any on-chain write.
          </p>
        </div>
      </motion.div>

      {/* By the numbers */}
      <motion.div {...stagger(8)}>
        <SectionHeading title="By the Numbers" />
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {[
            { label: 'Protocol sources', value: '43' },
            { label: 'DeFi protocols', value: '6' },
            { label: 'Mainnet chains', value: '6' },
            { label: 'Asset benchmarks', value: '5' },
            { label: 'CRE triggers', value: '10' },
            { label: 'Trigger types', value: '3' },
            { label: 'SDK capabilities', value: '16' },
            { label: 'Consensus strategies', value: '9' },
            { label: 'Smart contracts', value: '13' },
            { label: 'Contract tests', value: '146' },
            { label: 'L2 destinations', value: '3' },
            { label: 'Oracle ring buffer', value: '336' },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl px-4 py-3"
              style={{ background: 'var(--color-surface)' }}
            >
              <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                {stat.label}
              </div>
              <div
                className="mt-0.5 text-lg font-semibold tabular-nums"
                style={{ color: 'var(--color-text-primary)' }}
              >
                {stat.value}
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </main>
  )
}

function LiveStatCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div
      className="rounded-xl px-4 py-3"
      style={{
        background: highlight ? 'rgba(239,68,68,0.06)' : 'var(--color-surface)',
      }}
    >
      <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
        {label}
      </div>
      <div
        className="mt-0.5 text-lg font-semibold tabular-nums"
        style={{ color: highlight ? '#991b1b' : 'var(--color-text-primary)' }}
      >
        {value}
      </div>
    </div>
  )
}
