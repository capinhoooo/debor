import { useQuery } from '@tanstack/react-query'

const NY_FED_BASE = 'https://markets.newyorkfed.org/api/rates'

export interface SOFRRate {
  effectiveDate: string
  type: string
  percentRate: number
  percentPercentile1: number
  percentPercentile25: number
  percentPercentile75: number
  percentPercentile99: number
  volumeInBillions: number
  revisionIndicator: string
}

export interface EFFRRate {
  effectiveDate: string
  type: string
  percentRate: number
  percentPercentile1: number
  percentPercentile25: number
  percentPercentile75: number
  percentPercentile99: number
  targetRateFrom: number
  targetRateTo: number
  volumeInBillions: number
  revisionIndicator: string
}

export interface SOFRAIRate {
  effectiveDate: string
  type: string
  average30day: number
  average90day: number
  average180day: number
  index: number
  revisionIndicator: string
}

export interface SOFRData {
  sofr: SOFRRate | null
  effr: EFFRRate | null
  sofrai: SOFRAIRate | null
  sofrHistory: SOFRRate[]
}

async function fetchJSON<T>(url: string): Promise<T[]> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`NY Fed API error: ${res.status}`)
  const json = await res.json()
  return json.refRates ?? []
}

async function fetchSOFRData(): Promise<SOFRData> {
  const [sofrRates, effrRates, sofraiRates, sofrHistory] = await Promise.all([
    fetchJSON<SOFRRate>(`${NY_FED_BASE}/secured/sofr/last/1.json`),
    fetchJSON<EFFRRate>(`${NY_FED_BASE}/unsecured/effr/last/1.json`),
    fetchJSON<SOFRAIRate>(`${NY_FED_BASE}/secured/sofrai/last/1.json`),
    fetchJSON<SOFRRate>(`${NY_FED_BASE}/secured/sofr/last/90.json`),
  ])

  return {
    sofr: sofrRates[0] ?? null,
    effr: effrRates[0] ?? null,
    sofrai: sofraiRates[0] ?? null,
    sofrHistory,
  }
}

export function useSOFRData() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['sofr-data'],
    queryFn: fetchSOFRData,
    staleTime: 60 * 60 * 1000, // 1hr — SOFR publishes once daily
    refetchInterval: 60 * 60 * 1000,
    retry: 2,
  })

  return {
    sofr: data?.sofr ?? null,
    effr: data?.effr ?? null,
    sofrai: data?.sofrai ?? null,
    sofrHistory: data?.sofrHistory ?? [],
    isLoading,
    error,
  }
}

/** Convert percent (e.g. 4.33) to bps (e.g. 433) */
export function percentToBps(pct: number): number {
  return Math.round(pct * 100)
}
