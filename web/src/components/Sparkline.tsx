import { useMemo } from 'react'
import { Liveline, type LivelinePoint } from 'liveline'

const INTERVAL_SECS = 1800

export default function Sparkline({ rates }: { rates: number[] }) {
  const { data, value, windowSecs } = useMemo(() => {
    const now = Math.floor(Date.now() / 1000)
    const points: LivelinePoint[] = []
    for (let i = 0; i < rates.length; i++) {
      if (rates[i] === 0) continue
      points.push({ time: now - (rates.length - 1 - i) * INTERVAL_SECS, value: rates[i] })
    }
    const latest = points.length > 0 ? points[points.length - 1].value : 0
    const span = points.length > 1
      ? points[points.length - 1].time - points[0].time
      : 86400
    return { data: points, value: latest, windowSecs: Math.max(Math.round(span * 1.1), 3600) }
  }, [rates])

  if (data.length < 2) return null

  return (
    <div style={{ height: 48, pointerEvents: 'none' }}>
      <Liveline
        data={data}
        value={value}
        theme="light"
        color="rgba(0,0,0,0.4)"
        grid={false}
        badge={false}
        scrub={false}
        momentum={false}
        fill={true}
        pulse={false}
        exaggerate={true}
        showValue={false}
        window={windowSecs}
        padding={{ top: 4, right: 4, bottom: 4, left: 4 }}
      />
    </div>
  )
}
