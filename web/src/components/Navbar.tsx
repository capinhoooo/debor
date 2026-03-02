import { useState } from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { motion, AnimatePresence } from 'motion/react'
import { cnm } from '@/utils/style'

const navLinks = [
  { to: '/', label: 'Rates' },
  { to: '/compare', label: 'Compare' },
  { to: '/risk', label: 'Risk' },
  { to: '/swap', label: 'Swap' },
  { to: '/cross-chain', label: 'Cross-Chain' },
  { to: '/ai', label: 'AI' },
  { to: '/payment', label: 'Credits' },
  { to: '/pipeline', label: 'Pipeline' },
  { to: '/methodology', label: 'Methodology' },
] as const

export default function Navbar() {
  const router = useRouter()
  const currentPath = router.state.location.pathname
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <motion.header
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] as const }}
      className="sticky top-0 z-50 border-b"
      style={{
        borderColor: 'var(--color-border-subtle)',
        background: 'rgba(247, 247, 245, 0.85)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
        <div className="flex items-center gap-8">
          <Link to="/" className="flex items-center gap-2.5">
            <img
              src="/debor-brands/debor-logo-only-dark.svg"
              alt="DeBOR"
              className="h-7 w-7"
            />
            <span
              className="text-base font-semibold tracking-tight"
              style={{ color: 'var(--color-text-primary)' }}
            >
              DeBOR
            </span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden items-center gap-1 md:flex">
            {navLinks.map((link) => {
              const isActive =
                link.to === '/'
                  ? currentPath === '/'
                  : currentPath.startsWith(link.to)
              return (
                <Link
                  key={link.to}
                  to={link.to}
                  className={cnm(
                    'rounded-lg px-3 py-1.5 text-sm transition-colors duration-100',
                    isActive
                      ? 'font-medium'
                      : 'hover:bg-black/[0.04]',
                  )}
                  style={{
                    color: isActive
                      ? 'var(--color-text-primary)'
                      : 'var(--color-text-secondary)',
                  }}
                >
                  {link.label}
                </Link>
              )
            })}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <ConnectButton
            chainStatus="icon"
            accountStatus="address"
            showBalance={false}
          />

          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="flex h-8 w-8 items-center justify-center rounded-lg md:hidden"
            style={{ color: 'var(--color-text-primary)' }}
            aria-label="Toggle menu"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              {mobileOpen ? (
                <>
                  <line x1="4" y1="4" x2="14" y2="14" />
                  <line x1="14" y1="4" x2="4" y2="14" />
                </>
              ) : (
                <>
                  <line x1="3" y1="5" x2="15" y2="5" />
                  <line x1="3" y1="9" x2="15" y2="9" />
                  <line x1="3" y1="13" x2="15" y2="13" />
                </>
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.nav
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden border-t md:hidden"
            style={{ borderColor: 'var(--color-border-subtle)' }}
          >
            <div className="mx-auto max-w-5xl space-y-1 px-6 py-3">
              {navLinks.map((link) => {
                const isActive =
                  link.to === '/'
                    ? currentPath === '/'
                    : currentPath.startsWith(link.to)
                return (
                  <Link
                    key={link.to}
                    to={link.to}
                    onClick={() => setMobileOpen(false)}
                    className={cnm(
                      'block rounded-lg px-3 py-2 text-sm transition-colors duration-100',
                      isActive ? 'font-medium' : '',
                    )}
                    style={{
                      color: isActive
                        ? 'var(--color-text-primary)'
                        : 'var(--color-text-secondary)',
                    }}
                  >
                    {link.label}
                  </Link>
                )
              })}
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </motion.header>
  )
}
