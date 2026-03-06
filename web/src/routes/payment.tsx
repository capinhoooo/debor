import { createFileRoute } from '@tanstack/react-router'
import PaymentGatePage from '@/components/PaymentGatePage'

export const Route = createFileRoute('/payment')({ component: PaymentGatePage })
