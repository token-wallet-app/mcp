import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { MeterReportItem } from '../api.js'
import { maskEmail, toEpochMs, type QuotaSnapshot } from './types.js'

interface CursorUsageSummary {
  billingCycleEnd?: string | number | null
  membershipType?: string | null
  individualUsage?: {
    plan?: {
      enabled?: boolean
      used?: number
      limit?: number
      remaining?: number
    } | null
    onDemand?: {
      enabled?: boolean
      used?: number
      limit?: number | null
      remaining?: number | null
    } | null
  } | null
}

function getCursorStateDbPath(): string {
  if (process.env.CURSOR_STATE_DB) return process.env.CURSOR_STATE_DB
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
    return path.join(appData, 'Cursor', 'User', 'globalStorage', 'state.vscdb')
  }
  if (process.platform === 'darwin') {
    return path.join(
      os.homedir(),
      'Library',
      'Application Support',
      'Cursor',
      'User',
      'globalStorage',
      'state.vscdb',
    )
  }
  return path.join(os.homedir(), '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb')
}

async function readCursorLocalAuth(): Promise<{ token: string; email?: string } | null> {
  const envToken = process.env.CURSOR_ACCESS_TOKEN?.trim()
  if (envToken) return { token: envToken }

  const dbPath = getCursorStateDbPath()
  if (!fs.existsSync(dbPath)) return null

  try {
    const sqlite = await import('node:sqlite')
    const db = new sqlite.DatabaseSync(dbPath, { readOnly: true })
    try {
      const tokenRow = db
        .prepare("SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken'")
        .get() as { value?: string } | undefined
      const emailRow = db
        .prepare("SELECT value FROM ItemTable WHERE key = 'cursorAuth/cachedEmail'")
        .get() as { value?: string } | undefined
      const token = tokenRow?.value?.trim()
      if (!token) return null
      return { token, email: emailRow?.value?.trim() }
    } finally {
      db.close()
    }
  } catch {
    return null
  }
}

export async function collectCursorQuota(): Promise<QuotaSnapshot | null> {
  const auth = await readCursorLocalAuth()
  if (!auth) return null

  const endpoints = [
    'https://api2.cursor.sh/auth/usage-summary',
    'https://cursor.com/api/usage-summary',
  ]

  let data: CursorUsageSummary | null = null
  for (const url of endpoints) {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${auth.token}`,
        Accept: 'application/json',
        'User-Agent': 'tokenwallet-mcp/1.0',
      },
      signal: AbortSignal.timeout(8000),
    }).catch(() => null)
    if (res && res.ok) {
      data = (await res.json().catch(() => null)) as CursorUsageSummary | null
      if (data?.individualUsage) break
    }
  }

  if (!data?.individualUsage) return null

  const now = Date.now()
  const resetsAt = toEpochMs(data.billingCycleEnd)
  const meters: MeterReportItem[] = []
  const planUsage = data.individualUsage.plan

  if (planUsage && typeof planUsage.limit === 'number' && planUsage.limit > 0) {
    const remainingRaw =
      typeof planUsage.remaining === 'number'
        ? planUsage.remaining
        : Math.max(0, planUsage.limit - Number(planUsage.used ?? 0))
    const pct = Math.max(0, Math.min(100, Math.round((remainingRaw / planUsage.limit) * 1000) / 10))
    meters.push({
      meterKey: 'month',
      product: 'cursor',
      label: '本月额度',
      kind: 'percent',
      window: 'month',
      remaining: pct,
      total: 100,
      unit: '%',
      resetsAt,
      observedAt: now,
    })
  }

  if (meters.length === 0) return null

  const membership = data.membershipType?.trim()
  const plan = membership ? membership.charAt(0).toUpperCase() + membership.slice(1) : undefined

  return {
    brand: 'cursor',
    plan,
    accountHint: maskEmail(auth.email),
    observedAt: now,
    source: 'cursor',
    meters,
  }
}
