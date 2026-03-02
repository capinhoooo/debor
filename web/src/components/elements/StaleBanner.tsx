import { useOracleData } from '@/hooks/useOracleData'

const STALE_WARN_SECONDS = 3600 // 1 hour
const STALE_CRITICAL_SECONDS = 14400 // 4 hours

export default function StaleBanner() {
  const { benchmarks } = useOracleData()

  const now = Math.floor(Date.now() / 1000)
  let maxStaleness = 0
  const staleAssets: string[] = []

  for (const b of benchmarks) {
    if (b.data && b.data.updated > 0n) {
      const age = now - Number(b.data.updated)
      if (age > STALE_WARN_SECONDS) staleAssets.push(b.asset)
      if (age > maxStaleness) maxStaleness = age
    }
  }

  if (maxStaleness < STALE_WARN_SECONDS) return null

  const isCritical = maxStaleness >= STALE_CRITICAL_SECONDS
  const hours = Math.floor(maxStaleness / 3600)
  const minutes = Math.floor((maxStaleness % 3600) / 60)

  return (
    <div
      className="px-6 py-2 text-center text-xs font-medium"
      style={{
        background: isCritical ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)',
        color: isCritical ? '#991b1b' : '#92400e',
      }}
    >
      {staleAssets.length === benchmarks.length
        ? 'All oracles stale'
        : `Stale: ${staleAssets.join(', ')}`}
      {' — last update '}
      {hours > 0 ? `${hours}h ` : ''}{minutes}m ago
      {isCritical && ' — rates may not reflect current market conditions'}
    </div>
  )
}
