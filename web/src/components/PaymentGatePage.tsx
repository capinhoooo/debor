import { useState, useEffect } from 'react'
import { motion } from 'motion/react'
import { usePaymentGateData } from '@/hooks/usePaymentGateData'
import {
  useUsdcAllowance,
  useApproveUsdc,
  usePurchaseCredits,
} from '@/hooks/usePaymentGateWrite'
import { shortenAddress, etherscanLink } from '@/utils/format'
import { fadeIn, stagger } from '@/utils/motion'
import SectionHeading from '@/components/elements/SectionHeading'
import MetricRow from '@/components/elements/MetricRow'
import SkeletonCard from '@/components/elements/SkeletonCard'
import { PAYMENT_GATE_ADDRESS } from '@/lib/contracts'
import ErrorBanner from '@/components/elements/ErrorBanner'

function formatUsdc(raw: bigint): string {
  const val = Number(raw) / 1e6
  if (val === 0) return '0'
  if (val < 0.01) return '<0.01'
  return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function PaymentGatePage() {
  const { gate, userCredits, userSpent, isLoading, isConnected, error } = usePaymentGateData()
  const { allowance, refetchAllowance } = useUsdcAllowance()
  const {
    approve,
    isPending: approvePending,
    isConfirming: approveConfirming,
    isSuccess: approveSuccess,
    reset: resetApprove,
    error: approveError,
  } = useApproveUsdc()
  const {
    purchase,
    isPending: purchasePending,
    isConfirming: purchaseConfirming,
    isSuccess: purchaseSuccess,
    reset: resetPurchase,
    error: purchaseError,
  } = usePurchaseCredits()

  const [creditAmount, setCreditAmount] = useState(1)

  const totalCost = gate ? BigInt(creditAmount) * gate.pricePerCredit : 0n
  const needsApproval = allowance !== undefined && totalCost > 0n && allowance < totalCost

  useEffect(() => {
    if (approveSuccess) refetchAllowance()
  }, [approveSuccess, refetchAllowance])

  useEffect(() => {
    if (purchaseSuccess) {
      const timer = setTimeout(() => {
        resetPurchase()
        resetApprove()
      }, 5000)
      return () => clearTimeout(timer)
    }
  }, [purchaseSuccess, resetPurchase, resetApprove])

  return (
    <main className="mx-auto max-w-5xl px-6 pb-16 pt-10">
      <motion.div {...fadeIn}>
        <SectionHeading title="Credits" />
        <p
          className="mb-8 max-w-xl text-[0.9375rem] leading-relaxed"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          DeBOR premium actions (risk analysis, AI insights) are credit-gated.
          Each API call costs 1 credit. Deposit USDC to purchase credits,
          then the CRE workflow checks your balance before serving premium data.
        </p>
      </motion.div>

      {error && <ErrorBanner />}

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={i} rows={2} />
          ))}
        </div>
      ) : (
        <>
          {/* Wallet balance */}
          <motion.div {...stagger(0)}>
            <div
              className="mb-6 rounded-xl p-5"
              style={{
                background: 'var(--color-card)',
                boxShadow:
                  '0 0 0 1px var(--color-border-subtle), 0 4px 16px rgba(0,0,0,0.06)',
              }}
            >
              <div
                className="mb-1 text-xs font-medium uppercase tracking-wider"
                style={{ color: 'var(--color-text-secondary)', fontSize: '0.6875rem' }}
              >
                Your Balance
              </div>
              {isConnected ? (
                <div className="flex items-end gap-6">
                  <div>
                    <div
                      className="text-3xl font-semibold tabular-nums"
                      style={{ color: 'var(--color-text-primary)' }}
                    >
                      {userCredits !== null ? userCredits : '...'}
                    </div>
                    <div
                      className="mt-0.5 text-xs"
                      style={{ color: 'var(--color-text-secondary)' }}
                    >
                      credits remaining
                    </div>
                  </div>
                  {userSpent !== null && (
                    <div>
                      <div
                        className="text-sm font-medium tabular-nums"
                        style={{ color: 'var(--color-text-primary)' }}
                      >
                        {formatUsdc(userSpent)} USDC
                      </div>
                      <div
                        className="text-xs"
                        style={{ color: 'var(--color-text-secondary)' }}
                      >
                        total spent
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <p
                  className="text-sm"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  Connect your wallet to view your credit balance.
                </p>
              )}
            </div>
          </motion.div>

          {/* Buy credits */}
          {isConnected && gate && (
            <motion.div {...stagger(1)}>
              <div
                className="mb-6 rounded-xl p-5"
                style={{
                  background: 'var(--color-card)',
                  boxShadow:
                    '0 0 0 1px var(--color-border-subtle), 0 4px 16px rgba(0,0,0,0.06)',
                }}
              >
                <div
                  className="mb-3 text-xs font-medium uppercase tracking-wider"
                  style={{ color: 'var(--color-text-secondary)', fontSize: '0.6875rem' }}
                >
                  Buy Credits
                </div>
                <div className="mb-4 flex items-center gap-3">
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={creditAmount}
                    onChange={(e) =>
                      setCreditAmount(
                        Math.max(1, Math.min(100, Number(e.target.value) || 1)),
                      )
                    }
                    className="w-20 rounded-lg border px-3 py-2 text-sm tabular-nums outline-none"
                    style={{
                      borderColor: 'var(--color-border-subtle)',
                      background: 'var(--color-surface)',
                      color: 'var(--color-text-primary)',
                    }}
                  />
                  <span
                    className="text-sm"
                    style={{ color: 'var(--color-text-secondary)' }}
                  >
                    credits = {formatUsdc(totalCost)} USDC
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  {needsApproval ? (
                    <button
                      onClick={() => approve(totalCost)}
                      disabled={approvePending || approveConfirming}
                      className="rounded-lg px-4 py-2 text-sm font-medium transition-opacity disabled:opacity-40"
                      style={{ background: 'var(--color-text-primary)', color: 'var(--color-card)' }}
                    >
                      {approvePending
                        ? 'Confirm in wallet...'
                        : approveConfirming
                          ? 'Approving...'
                          : 'Approve USDC'}
                    </button>
                  ) : (
                    <button
                      onClick={() => purchase(BigInt(creditAmount))}
                      disabled={purchasePending || purchaseConfirming || totalCost === 0n}
                      className="rounded-lg px-4 py-2 text-sm font-medium transition-opacity disabled:opacity-40"
                      style={{ background: 'var(--color-text-primary)', color: 'var(--color-card)' }}
                    >
                      {purchasePending
                        ? 'Confirm in wallet...'
                        : purchaseConfirming
                          ? 'Purchasing...'
                          : 'Buy Credits'}
                    </button>
                  )}
                  {approveSuccess && needsApproval === false && !purchaseSuccess && (
                    <span className="text-xs font-medium" style={{ color: '#166534' }}>
                      Approved. Now purchase.
                    </span>
                  )}
                  {purchaseSuccess && (
                    <span className="text-xs font-medium" style={{ color: '#166534' }}>
                      Purchase complete. Balance updating...
                    </span>
                  )}
                </div>
                {(approveError || purchaseError) && (
                  <div
                    className="mt-3 flex items-center justify-between rounded-lg px-4 py-2.5 text-xs"
                    style={{ background: 'rgba(239,68,68,0.06)', color: '#991b1b' }}
                  >
                    <span>
                      {(approveError || purchaseError)?.message?.includes('User rejected')
                        ? 'Transaction rejected in wallet.'
                        : approveError
                          ? 'Approval failed. Please try again.'
                          : 'Purchase failed. Please try again.'}
                    </span>
                    <button
                      onClick={() => { resetApprove(); resetPurchase() }}
                      className="shrink-0 font-medium underline"
                      style={{ color: '#991b1b' }}
                    >
                      Dismiss
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* Protocol stats */}
          {gate && (
            <>
              <motion.div {...stagger(2)}>
                <SectionHeading title="Protocol Stats" />
              </motion.div>
              <div className="mb-8 grid gap-4 sm:grid-cols-3">
                <motion.div {...stagger(3)}>
                  <StatCard
                    label="Credits issued"
                    value={gate.totalCreditsIssued.toLocaleString()}
                  />
                </motion.div>
                <motion.div {...stagger(4)}>
                  <StatCard
                    label="Credits consumed"
                    value={gate.totalCreditsConsumed.toLocaleString()}
                  />
                </motion.div>
                <motion.div {...stagger(5)}>
                  <StatCard
                    label="Total revenue"
                    value={`${formatUsdc(gate.totalRevenue)} USDC`}
                  />
                </motion.div>
              </div>
            </>
          )}

          {/* How it works */}
          <motion.div {...stagger(6)}>
            <SectionHeading title="How It Works" />
          </motion.div>
          <div className="mb-8 grid gap-4 sm:grid-cols-3">
            {STEPS.map((step, i) => (
              <motion.div key={step.title} {...stagger(7 + i)}>
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
          {gate && (
            <motion.div {...stagger(10)}>
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
                      href={etherscanLink(PAYMENT_GATE_ADDRESS)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-xs transition-colors duration-100"
                      style={{ color: 'var(--color-accent-pink)' }}
                    >
                      {shortenAddress(PAYMENT_GATE_ADDRESS)}
                    </a>
                  </div>
                  <MetricRow
                    label="Price per credit"
                    value={`${formatUsdc(gate.pricePerCredit)} USDC`}
                  />
                  <MetricRow label="Chain" value="Sepolia" />
                  <MetricRow
                    label="Utilization"
                    value={
                      gate.totalCreditsIssued > 0
                        ? `${((gate.totalCreditsConsumed / gate.totalCreditsIssued) * 100).toFixed(1)}%`
                        : 'N/A'
                    }
                  />
                </div>
              </div>
            </motion.div>
          )}
        </>
      )}
    </main>
  )
}

const STEPS = [
  {
    title: 'Deposit USDC',
    desc: 'Call purchaseCredits() on the PaymentGate contract. USDC is transferred to the protocol treasury.',
  },
  {
    title: 'CRE checks balance',
    desc: 'Before serving premium actions, the CRE workflow calls hasCredits() to verify your balance on-chain.',
  },
  {
    title: 'Consume on use',
    desc: 'Each premium call (risk analysis, AI insight) deducts 1 credit. Standard benchmark reads are free.',
  },
]

function StatCard({ label, value }: { label: string; value: string }) {
  return (
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
        {label}
      </div>
      <div
        className="text-xl font-semibold tabular-nums"
        style={{ color: 'var(--color-text-primary)' }}
      >
        {value}
      </div>
    </div>
  )
}
