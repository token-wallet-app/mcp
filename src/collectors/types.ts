import type { MeterReportItem } from '../api.js'

export interface QuotaSnapshot {
  brand: 'openai' | 'claude' | 'cursor' | 'gemini' | 'grok'
  plan?: string
  accountHint?: string
  observedAt: number
  source: string
  meters: MeterReportItem[]
}

export function maskEmail(email?: string | null): string | undefined {
  if (!email || !email.includes('@')) return undefined
  const [user, domain] = email.trim().split('@')
  if (!user || !domain) return undefined
  const prefix = user.length <= 2 ? user[0] : user.slice(0, 2)
  return `${prefix}***@${domain}`
}

export function toRemainingPercent(usedPercent?: number): number | undefined {
  if (typeof usedPercent !== 'number' || !Number.isFinite(usedPercent)) return undefined
  const remaining = Math.max(0, Math.min(100, 100 - usedPercent))
  return Math.round(remaining * 10) / 10
}

export function toEpochMs(raw?: number | string | null): number | undefined {
  if (typeof raw === 'string' && raw.trim()) {
    const parsed = Date.parse(raw)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return raw < 1_000_000_000_000 ? Math.round(raw * 1000) : Math.round(raw)
  }
  return undefined
}
