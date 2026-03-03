import { createFileRoute } from '@tanstack/react-router'
import AssetPage from '@/components/AssetPage'

export const Route = createFileRoute('/asset/$symbol')({
  component: () => {
    const { symbol } = Route.useParams()
    return <AssetPage symbol={symbol} />
  },
})
