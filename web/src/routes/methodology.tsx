import { createFileRoute } from '@tanstack/react-router'
import MethodologyPage from '@/components/MethodologyPage'

export const Route = createFileRoute('/methodology')({ component: MethodologyPage })
