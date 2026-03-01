export default function SkeletonCard({ rows = 4 }: { rows?: number }) {
  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: 'var(--color-card)',
        boxShadow: '0 0 0 1px var(--color-border-subtle)',
      }}
    >
      <div
        className="mb-4 h-4 w-12 rounded"
        style={{ background: 'var(--color-surface)' }}
      />
      <div
        className="mb-4 h-8 w-20 rounded"
        style={{ background: 'var(--color-surface)' }}
      />
      {rows > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i}>
              <div
                className="mb-1 h-3 w-10 rounded"
                style={{ background: 'var(--color-surface)' }}
              />
              <div
                className="h-4 w-14 rounded"
                style={{ background: 'var(--color-surface)' }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
