import { Link } from '@tanstack/react-router'

const footerLinks = [
  { to: '/', label: 'Rates' },
  { to: '/compare', label: 'Compare' },
  { to: '/risk', label: 'Risk' },
  { to: '/swap', label: 'Swap' },
  { to: '/cross-chain', label: 'Cross-Chain' },
  { to: '/ai', label: 'AI' },
  { to: '/payment', label: 'Credits' },
  { to: '/methodology', label: 'Methodology' },
] as const

export default function Footer() {
  return (
    <footer className="mt-auto">
      <div className="mx-auto max-w-5xl mb-4">
        <img
          src="/debor-brands/debor-stripe.png"
          alt=""
          className="w-full"
          draggable={false}
        />
      </div>

      <div
        className="border-t"
        style={{
          background: 'var(--color-surface)',
          borderColor: 'var(--color-border-subtle)',
        }}
      >
        <div className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-8 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <img
              src="/debor-brands/debor-logo-only-dark.svg"
              alt="DeBOR"
              className="h-6 w-6"
            />
            <span
              className="text-sm"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              Decentralized Benchmark Oracle Rate
            </span>
          </div>

          <nav className="flex flex-wrap items-center gap-4">
            {footerLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className="text-sm transition-colors duration-100 hover:opacity-70"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        <div
          className="mx-auto max-w-5xl border-t px-6 py-4"
          style={{ borderColor: 'var(--color-border-subtle)' }}
        >
          <p
            className="text-xs"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            Powered by Chainlink CRE. Built on Sepolia testnet.
          </p>
        </div>
      </div>
    </footer>
  )
}
