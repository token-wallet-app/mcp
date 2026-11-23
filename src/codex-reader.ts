import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { MeterReportItem } from './api.js'

export interface CodexQuotaSnapshot {
  plan?: string
  observedAt: number
  sourceFile: string
  meters: MeterReportItem[]
}

interface CodexRateLimitWindow {
  used_percent?: number
  window_minutes?: number
  resets_at?: number
}

interface CodexRateLimits {
  limit_id?: string
  primary?: CodexRateLimitWindow | null
  secondary?: CodexRateLimitWindow | null
  plan_type?: string | null
}

function normalizePlan(planType?: string | null): string | undefined {
  if (!planType) return undefined
  switch (planType.toLowerCase()) {
    case 'plus':
      return 'Plus'
    case 'pro':
      return 'Pro'
    case 'team':
      return 'Team'
    case 'enterprise':
      return 'Enterprise'
    default:
      return planType.charAt(0).toUpperCase() + planType.slice(1)
  }
}

function collectJsonlFiles(rootDir: string): { filePath: string; mtimeMs: number }[] {
  const results: { filePath: string; mtimeMs: number }[] = []
  function walk(dir: string) {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(fullPath)
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        try {
          const stat = fs.statSync(fullPath)
          results.push({ filePath: fullPath, mtimeMs: stat.mtimeMs })
        } catch {
          // Ignore unreadable file
        }
      }
    }
  }
  walk(rootDir)
  results.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return results
}

function toEpochMs(raw?: number): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return undefined
  // Codex stores resets_at in Unix seconds (~1.79e9); convert to ms if < 1e12
  return raw < 1_000_000_000_000 ? Math.round(raw * 1000) : Math.round(raw)
}

function toRemainingPercent(usedPercent?: number): number | undefined {
  if (typeof usedPercent !== 'number' || !Number.isFinite(usedPercent)) return undefined
  const remaining = Math.max(0, Math.min(100, 100 - usedPercent))
  return Math.round(remaining * 10) / 10
}

function parseLatestRateLimitsFromFile(filePath: string): CodexQuotaSnapshot | null {
  let content: string
  try {
    content = fs.readFileSync(filePath, 'utf8')
  } catch {
    return null
  }
  const lines = content.split(/\r?\n/)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (!line || !line.includes('"rate_limits"')) continue
    let parsed: {
      timestamp?: string
      type?: string
      payload?: { type?: string; rate_limits?: CodexRateLimits | null }
    }
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    const rl = parsed.payload?.rate_limits
    if (!rl || (!rl.primary && !rl.secondary)) continue

    const observedAt =
      (parsed.timestamp ? Date.parse(parsed.timestamp) : NaN) || Date.now()
    const meters: MeterReportItem[] = []

    if (rl.primary) {
      const remaining = toRemainingPercent(rl.primary.used_percent)
      if (remaining !== undefined) {
        const is5h = !rl.primary.window_minutes || rl.primary.window_minutes <= 360
        meters.push({
          meterKey: is5h ? '5h' : `w${rl.primary.window_minutes}m`,
          product: rl.limit_id || 'codex',
          label: is5h ? '5 小时' : `${Math.round((rl.primary.window_minutes ?? 300) / 60)} 小时`,
          kind: 'percent',
          window: is5h ? '5h' : 'rolling',
          remaining,
          total: 100,
          unit: '%',
          resetsAt: toEpochMs(rl.primary.resets_at),
          observedAt,
        })
      }
    }

    if (rl.secondary) {
      const remaining = toRemainingPercent(rl.secondary.used_percent)
      if (remaining !== undefined) {
        const isWeek = !rl.secondary.window_minutes || rl.secondary.window_minutes >= 7200
        meters.push({
          meterKey: isWeek ? '7d' : `w${rl.secondary.window_minutes}m`,
          product: rl.limit_id || 'codex',
          label: isWeek ? '每周额度' : `${Math.round((rl.secondary.window_minutes ?? 10080) / 1440)} 天额度`,
          kind: 'percent',
          window: isWeek ? 'week' : 'rolling',
          remaining,
          total: 100,
          unit: '%',
          resetsAt: toEpochMs(rl.secondary.resets_at),
          observedAt,
        })
      }
    }

    if (meters.length > 0) {
      return {
        plan: normalizePlan(rl.plan_type),
        observedAt,
        sourceFile: filePath,
        meters,
      }
    }
  }
  return null
}

export function readLatestCodexQuota(): CodexQuotaSnapshot | null {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')
  const sessionsDir = path.join(codexHome, 'sessions')
  if (!fs.existsSync(sessionsDir)) return null

  const files = collectJsonlFiles(sessionsDir).slice(0, 8)
  for (const { filePath } of files) {
    const snap = parseLatestRateLimitsFromFile(filePath)
    if (snap) return snap
  }
  return null
}
