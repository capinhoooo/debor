import { createFileRoute } from '@tanstack/react-router'
import SwapPage from '@/components/SwapPage'

export const Route = createFileRoute('/swap')({ component: SwapPage })
