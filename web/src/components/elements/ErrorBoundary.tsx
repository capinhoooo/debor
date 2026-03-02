import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallbackMessage?: string
}

interface State {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="rounded-xl px-5 py-8 text-center"
          style={{
            background: 'rgba(239,68,68,0.04)',
            border: '1px solid rgba(239,68,68,0.12)',
          }}
        >
          <div className="mb-2 text-sm font-medium" style={{ color: '#991b1b' }}>
            {this.props.fallbackMessage || 'This section failed to load'}
          </div>
          <div className="mb-3 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
            {this.state.error?.message}
          </div>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="rounded-lg px-3 py-1.5 text-xs font-medium transition-opacity duration-100 hover:opacity-85"
            style={{ background: 'var(--color-text-primary)', color: 'var(--color-page)' }}
          >
            Retry
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
