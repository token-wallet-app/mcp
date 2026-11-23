import { readLatestCodexQuota } from '../codex-reader.js'
import { collectClaudeQuota } from './claude.js'
import { collectCursorQuota } from './cursor.js'
import { collectGeminiQuota } from './gemini.js'
import { collectGrokQuota } from './grok.js'
import type { QuotaSnapshot } from './types.js'

export type { QuotaSnapshot } from './types.js'

export async function collectQuotaForBrand(brand: string): Promise<QuotaSnapshot | null> {
  switch (brand) {
    case 'openai': {
      const codex = readLatestCodexQuota()
      if (!codex) return null
      return {
        brand: 'openai',
        plan: codex.plan,
        observedAt: codex.observedAt,
        source: 'codex',
        meters: codex.meters,
      }
    }
    case 'claude':
      return collectClaudeQuota()
    case 'cursor':
      return collectCursorQuota()
    case 'gemini':
      return collectGeminiQuota()
    case 'grok':
      return collectGrokQuota()
    default:
      return null
  }
}

export async function collectAllLocalQuotas(): Promise<QuotaSnapshot[]> {
  const results = await Promise.all([
    collectQuotaForBrand('openai'),
    collectQuotaForBrand('claude'),
    collectQuotaForBrand('cursor'),
    collectQuotaForBrand('gemini'),
    collectQuotaForBrand('grok'),
  ])
  return results.filter((snap): snap is QuotaSnapshot => snap !== null)
}
