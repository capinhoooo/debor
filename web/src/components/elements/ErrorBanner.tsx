interface ErrorBannerProps {
  message?: string
  onRetry?: () => void
}

export default function ErrorBanner({ message, onRetry }: ErrorBannerProps) {
  return (
    <div
      className="my-4 rounded-lg px-4 py-3 text-sm"
      style={{
        background: 'rgba(239,68,68,0.06)',
        color: '#991b1b',
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <span>{message || 'Failed to load data. Check your network connection.'}</span>
        {onRetry && (
          <button
            onClick={onRetry}
            className="shrink-0 text-xs font-medium underline transition-colors duration-100"
            style={{ color: '#991b1b' }}
          >
            Retry
          </button>
        )}
      </div>
    </div>
  )
}
