import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/react-router'

import Web3Provider from '../providers/Web3Provider'
import HeroUIProvider from '../providers/HeroUIProvider'
import LenisSmoothScrollProvider from '../providers/LenisSmoothScrollProvider'
import ErrorPage from '../components/ErrorPage'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import StaleBanner from '../components/elements/StaleBanner'

import appCss from '../styles.css?url'

import type { QueryClient } from '@tanstack/react-query'

interface MyRouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
  errorComponent: ({ error, reset }) => <ErrorPage error={error} reset={reset} />,
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'DeBOR — Decentralized Benchmark Oracle Rate' },
      {
        name: 'description',
        content:
          'On-chain benchmark interest rates powered by Chainlink CRE. Five asset oracles, interest rate swaps, cross-chain via CCIP.',
      },
      { property: 'og:title', content: 'DeBOR — Decentralized Benchmark Oracle Rate' },
      {
        property: 'og:description',
        content:
          'On-chain benchmark interest rates powered by Chainlink CRE. Five asset oracles, interest rate swaps, cross-chain via CCIP.',
      },
      { property: 'og:image', content: '/debor-brands/debor-thumbnail.png' },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:image', content: '/debor-brands/debor-thumbnail.png' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', type: 'image/svg+xml', href: '/debor-brands/debor-logo-only-dark.svg' },
    ],
  }),

  component: RootComponent,
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="light">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}

function RootComponent() {
  return (
    <Web3Provider>
      <HeroUIProvider>
        <LenisSmoothScrollProvider />
        <div className="flex min-h-screen flex-col">
          <StaleBanner />
          <Navbar />
          <div className="flex-1">
            <Outlet />
          </div>
          <Footer />
        </div>
      </HeroUIProvider>
    </Web3Provider>
  )
}
