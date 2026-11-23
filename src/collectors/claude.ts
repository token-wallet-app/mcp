import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { MeterReportItem } from '../api.js'
import { toEpochMs, toRemainingPercent, type QuotaSnapshot } from './types.js'

interface ClaudeCredentials {
  claudeAiOauth?: {
    accessToken?: string
    subscriptionType?: string
    rateLimitTier?: string
  }
}

interface ClaudeUsageResponse {
  five_hour?: { utilization?: number; resets_at?: string | null } | null
  seven_day?: { utilization?: number; resets_at?: string | null } | null
  seven_day_sonnet?: { utilization?: number; resets_at?: string | null } | null
  extra_usage?: {
    is_enabled?: boolean
    used_credits?: number
    monthly_limit?: number
  } | null
}

function readClaudeCredentials(): { token: string; plan?: string } | null {
  const envToken = process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim()
  if (envToken) return { token: envToken }

  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
  const credFile = path.join(configDir, '.credentials.json')
  if (!fs.existsSync(credFile)) return null

  try {
    const parsed = JSON.parse(fs.readFileSync(credFile, 'utf8')) as ClaudeCredentials
    const token = parsed.claudeAiOauth?.accessToken?.trim()
    if (!token) return null
    const sub = parsed.claudeAiOauth?.subscriptionType
    const plan = sub ? sub.charAt(0).toUpperCase() + sub.slice(1) : undefined
    return { token, plan }
  } catch {
    return null
  }
}

export async function collectClaudeQuota(): Promise<QuotaSnapshot | null> {
  const creds = readClaudeCredentials()
  if (!creds) return null

  const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${creds.token}`,
      'anthropic-beta': 'oauth-2025-04-20',
      Accept: 'application/json',
      'User-Agent': 'tokenwallet-mcp/1.0',
    },
    signal: AbortSignal.timeout(8000),
  }).catch(() => null)

  if (!res || !res.ok) return null
  const data = (await res.json().catch(() => null)) as ClaudeUsageResponse | null
  if (!data) return null

  const now = Date.now()
  const meters: MeterReportItem[] = []

  if (data.five_hour && typeof data.five_hour.utilization === 'number') {
    const remaining = toRemainingPercent(data.five_hour.utilization)
    if (remaining !== undefined) {
      meters.push({
        meterKey: '5h',
        product: 'claude-code',
        label: '5 小时',
        kind: 'percent',
        window: '5h',
        remaining,
        total: 100,
        unit: '%',
        resetsAt: toEpochMs(data.five_hour.resets_at),
        observedAt: now,
      })
    }
  }

  if (data.seven_day && typeof data.seven_day.utilization === 'number') {
    const remaining = toRemainingPercent(data.seven_day.utilization)
    if (remaining !== undefined) {
      meters.push({
        meterKey: '7d',
        product: 'claude-code',
        label: '每周额度',
        kind: 'percent',
        window: 'week',
        remaining,
        total: 100,
        unit: '%',
        resetsAt: toEpochMs(data.seven_day.resets_at),
        observedAt: now,
      })
    }
  }

  if (
    data.extra_usage?.is_enabled &&
    typeof data.extra_usage.monthly_limit === 'number' &&
    data.extra_usage.monthly_limit > 0
  ) {
    const used = Number(data.extra_usage.used_credits ?? 0)
    const remaining = Math.max(0, Math.round((data.extra_usage.monthly_limit - used) * 100) / 100)
    meters.push({
      meterKey: 'extra',
      product: 'claude-code',
      label: '额外额度',
      kind: 'balance',
      window: 'month',
      remaining,
      total: data.extra_usage.monthly_limit,
      unit: 'USD',
      observedAt: now,
    })
  }

  if (meters.length === 0) return null

  return {
    brand: 'claude',
    plan: creds.plan,
    observedAt: now,
    source: 'claude-code',
    meters,
  }
}
