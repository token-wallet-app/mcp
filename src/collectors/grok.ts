import type { MeterReportItem } from '../api.js'
import type { QuotaSnapshot } from './types.js'

interface XaiPrepaidBalanceResponse {
  total?: { val?: string | number }
  remaining?: { val?: string | number }
  remaining_balance?: number
  balance?: number
}

export async function collectGrokQuota(): Promise<QuotaSnapshot | null> {
  const mgmtKey = process.env.XAI_MANAGEMENT_API_KEY?.trim()
  const teamId = process.env.XAI_TEAM_ID?.trim()
  if (!mgmtKey || !teamId) return null

  const res = await fetch(
    `https://management-api.x.ai/v1/billing/teams/${encodeURIComponent(teamId)}/prepaid/balance`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${mgmtKey}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    },
  ).catch(() => null)

  if (!res || !res.ok) return null
  const data = (await res.json().catch(() => null)) as XaiPrepaidBalanceResponse | null
  if (!data) return null

  const rawRemaining =
    data.remaining?.val ?? data.remaining_balance ?? data.balance ?? data.total?.val
  const remainingNum = typeof rawRemaining === 'string' ? Number(rawRemaining) : rawRemaining
  if (typeof remainingNum !== 'number' || !Number.isFinite(remainingNum)) return null

  // xAI billing API may return cents or dollars depending on field; normalize cleanly
  const now = Date.now()
  const meters: MeterReportItem[] = [
    {
      meterKey: 'balance:USD',
      product: 'xai',
      label: '可用余额',
      kind: 'balance',
      remaining: Math.round(remainingNum * 100) / 100,
      unit: 'USD',
      observedAt: now,
    },
  ]

  return {
    brand: 'grok',
    observedAt: now,
    source: 'xai-billing',
    meters,
  }
}
