import { createFileRoute } from '@tanstack/react-router'
import CrossChainPage from '@/components/CrossChainPage'

export const Route = createFileRoute('/cross-chain')({ component: CrossChainPage })
