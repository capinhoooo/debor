import { createFileRoute } from '@tanstack/react-router'
import PipelinePage from '@/components/PipelinePage'

export const Route = createFileRoute('/pipeline')({ component: PipelinePage })
