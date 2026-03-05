import { createFileRoute } from '@tanstack/react-router'
import ComparePage from '@/components/ComparePage'

export const Route = createFileRoute('/compare')({ component: ComparePage })
