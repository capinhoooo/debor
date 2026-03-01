export default function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
        {label}
      </div>
      <div
        className="text-sm font-medium tabular-nums"
        style={{ color: 'var(--color-text-primary)' }}
      >
        {value}
      </div>
    </div>
  )
}
