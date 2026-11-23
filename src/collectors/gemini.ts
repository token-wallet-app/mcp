import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { MeterReportItem } from '../api.js'
import { toEpochMs, type QuotaSnapshot } from './types.js'

interface GeminiOAuthCreds {
  access_token?: string
  expiry_date?: number
}

interface GeminiQuotaBucket {
  modelId?: string
  remainingFraction?: number
  resetTime?: string
}

interface GeminiQuotaResponse {
  buckets?: GeminiQuotaBucket[]
}

function readGeminiAccessToken(): string | null {
  const envToken = process.env.GEMINI_OAUTH_TOKEN?.trim()
  if (envToken) return envToken

  const geminiHome = process.env.GEMINI_CLI_HOME || path.join(os.homedir(), '.gemini')
  const credCandidates = [
    path.join(geminiHome, 'oauth_creds.json'),
    path.join(geminiHome, 'antigravity', 'oauth_creds.json'),
  ]
  for (const file of credCandidates) {
    if (!fs.existsSync(file)) continue
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as GeminiOAuthCreds
      if (parsed.access_token?.trim()) {
        return parsed.access_token.trim()
      }
    } catch {
      // Try next candidate
    }
  }
  return null
}

export async function collectGeminiQuota(): Promise<QuotaSnapshot | null> {
  const token = readGeminiAccessToken()
  if (!token) return null

  const res = await fetch('https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(8000),
  }).catch(() => null)

  if (!res || !res.ok) return null
  const data = (await res.json().catch(() => null)) as GeminiQuotaResponse | null
  if (!data?.buckets || data.buckets.length === 0) return null

  const now = Date.now()
  const proBuckets = data.buckets.filter((b) => b.modelId?.toLowerCase().includes('pro'))
  const flashBuckets = data.buckets.filter((b) => b.modelId?.toLowerCase().includes('flash'))

  const meters: MeterReportItem[] = []

  const pickLowest = (list: GeminiQuotaBucket[]) =>
    list
      .filter((b) => typeof b.remainingFraction === 'number')
      .sort((a, b) => (a.remainingFraction ?? 1) - (b.remainingFraction ?? 1))[0]

  const pro = pickLowest(proBuckets)
  if (pro && typeof pro.remainingFraction === 'number') {
    meters.push({
      meterKey: 'pro',
      product: 'gemini',
      label: 'Gemini Pro',
      kind: 'percent',
      window: 'day',
      modelGroup: pro.modelId,
      remaining: Math.max(0, Math.min(100, Math.round(pro.remainingFraction * 1000) / 10)),
      total: 100,
      unit: '%',
      resetsAt: toEpochMs(pro.resetTime),
      observedAt: now,
    })
  }

  const flash = pickLowest(flashBuckets)
  if (flash && typeof flash.remainingFraction === 'number') {
    meters.push({
      meterKey: 'flash',
      product: 'gemini',
      label: 'Gemini Flash',
      kind: 'percent',
      window: 'day',
      modelGroup: flash.modelId,
      remaining: Math.max(0, Math.min(100, Math.round(flash.remainingFraction * 1000) / 10)),
      total: 100,
      unit: '%',
      resetsAt: toEpochMs(flash.resetTime),
      observedAt: now,
    })
  }

  if (meters.length === 0) {
    const first = pickLowest(data.buckets)
    if (first && typeof first.remainingFraction === 'number') {
      meters.push({
        meterKey: 'default',
        product: 'gemini',
        label: first.modelId || 'Google AI',
        kind: 'percent',
        window: 'day',
        remaining: Math.max(0, Math.min(100, Math.round(first.remainingFraction * 1000) / 10)),
        total: 100,
        unit: '%',
        resetsAt: toEpochMs(first.resetTime),
        observedAt: now,
      })
    }
  }

  if (meters.length === 0) return null

  return {
    brand: 'gemini',
    observedAt: now,
    source: 'gemini-cli',
    meters,
  }
}
