import { createFileRoute } from '@tanstack/react-router'
import AIInsightPage from '@/components/AIInsightPage'

export const Route = createFileRoute('/ai')({ component: AIInsightPage })
