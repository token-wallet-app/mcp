import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import QRCode from 'qrcode'
import { z } from 'zod'

import {
  apiCreateMcpSession,
  apiPingNode,
  apiPollMcpSession,
  apiSubmitReport,
  type MeterReportItem,
} from './api.js'
import { collectQuotaForBrand } from './collectors/index.js'
import {
  getApiBaseUrl,
  loadConfig,
  markConnectionReported,
  removePendingSession,
  savePendingSession,
  upsertBoundConnection,
  type BoundConnection,
  type PendingSession,
} from './config.js'

const meterSchema = z.object({
  meterKey: z.string().min(1).describe('Unique meter key, e.g. "5h", "7d", "balance:USD"'),
  product: z.string().optional().describe('Product identifier, e.g. "chatgpt", "codex", "claude-code"'),
  label: z.string().min(1).describe('Human-readable label, e.g. "5 小时", "每周额度", "可用余额"'),
  kind: z.enum(['percent', 'balance']).describe('"percent" for 0-100% quotas, "balance" for currency/credits'),
  window: z.enum(['5h', 'day', 'week', 'month', 'rolling']).optional(),
  modelGroup: z.string().optional(),
  remaining: z.number().describe('Remaining amount or percentage (0-100)'),
  total: z.number().optional().describe('Total quota if applicable (e.g. 100 for percent)'),
  unit: z.string().optional().describe('Unit such as "%", "USD", "CNY", "credits"'),
  resetsAt: z.number().optional().describe('Reset timestamp in epoch milliseconds'),
})

const activePollTimers = new Map<string, ReturnType<typeof setInterval>>()

async function tryPollPendingSession(session: PendingSession): Promise<BoundConnection | null> {
  const baseUrl = getApiBaseUrl()
  try {
    const res = await apiPollMcpSession(baseUrl, session.sessionId, session.pollToken)
    if (res.status === 'authorized' && res.writeToken && res.cardId && res.nodeId) {
      const bound: BoundConnection = {
        cardId: res.cardId,
        nodeId: res.nodeId,
        brand: session.brand,
        provider: session.provider,
        writeToken: res.writeToken,
        fingerprintSalt: res.fingerprintSalt,
        connectedAt: Date.now(),
      }
      upsertBoundConnection(bound)
      removePendingSession(session.sessionId)
      stopBackgroundPoll(session.sessionId)
      return bound
    }
    if (res.status === 'expired') {
      removePendingSession(session.sessionId)
      stopBackgroundPoll(session.sessionId)
    }
  } catch {
    // Ignore transient network errors during background polling
  }
  return null
}

function stopBackgroundPoll(sessionId: string) {
  const timer = activePollTimers.get(sessionId)
  if (timer) {
    clearInterval(timer)
    activePollTimers.delete(sessionId)
  }
}

function startBackgroundPoll(session: PendingSession) {
  stopBackgroundPoll(session.sessionId)
  const timer = setInterval(() => {
    if (Date.now() > session.expiresAt) {
      removePendingSession(session.sessionId)
      stopBackgroundPoll(session.sessionId)
      return
    }
    void tryPollPendingSession(session)
  }, 3000)
  timer.unref()
  activePollTimers.set(session.sessionId, timer)
}

async function syncAllPendingSessions(): Promise<BoundConnection[]> {
  const cfg = loadConfig()
  const newlyBound: BoundConnection[] = []
  for (const session of cfg.pendingSessions) {
    const bound = await tryPollPendingSession(session)
    if (bound) newlyBound.push(bound)
  }
  return newlyBound
}

export function createTokenWalletMcpServer(): McpServer {
  const server = new McpServer({
    name: 'tokenwallet-mcp',
    version: '1.0.0',
  })

  server.registerTool(
    'connect_tokenwallet',
    {
      title: 'Connect to TokenWallet App',
      description:
        'Generate a QR code and pairing link so the user can scan with the TokenWallet mobile app to bind this AI client and sync token quotas.',
      inputSchema: {
        brand: z
          .enum(['openai', 'claude', 'gemini', 'cursor', 'grok', 'openrouter', 'deepseek', 'other'])
          .default('openai')
          .describe('Provider brand (openai, claude, gemini, cursor, grok, openrouter, deepseek, other)'),
        provider: z.string().optional().describe('Custom display name for the provider'),
        nodeLabel: z.string().optional().describe('Friendly name for this client/machine, e.g. "MacBook ChatGPT"'),
        source: z.string().optional().describe('Client source identifier, e.g. "chatgpt", "codex", "claude-code", "cursor", "gemini-cli"'),
        plan: z.string().optional().describe('Subscription plan name, e.g. "Plus", "Pro", "AI Pro"'),
        accountHint: z.string().optional().describe('Optional masked account hint, e.g. "u***@gmail.com"'),
        meters: z.array(meterSchema).optional().describe('Optional initial quota meters to populate immediately upon scan'),
      },
    },
    async (args) => {
      const baseUrl = getApiBaseUrl()
      const localQuota =
        !args.meters || args.meters.length === 0
          ? await collectQuotaForBrand(args.brand)
          : null
      const created = await apiCreateMcpSession(baseUrl, {
        brand: args.brand,
        provider: args.provider,
        nodeLabel: args.nodeLabel,
        source: args.source ?? localQuota?.source ?? 'mcp',
        plan: args.plan ?? localQuota?.plan,
        accountHint: args.accountHint ?? localQuota?.accountHint,
        meters: (args.meters as MeterReportItem[] | undefined) ?? localQuota?.meters,
      })

      const pending: PendingSession = {
        sessionId: created.sessionId,
        mcpCode: created.mcpCode,
        pollToken: created.pollToken,
        brand: created.brand,
        provider: created.provider,
        deepLink: created.deepLink,
        webLink: created.webLink,
        expiresAt: created.expiresAt,
        createdAt: Date.now(),
      }
      savePendingSession(pending)
      startBackgroundPoll(pending)

      const qrDataUrl = await QRCode.toDataURL(created.qrPayload, {
        width: 320,
        margin: 2,
      })
      const base64Png = qrDataUrl.replace(/^data:image\/png;base64,/, '')
      const asciiQr = await QRCode.toString(created.qrPayload, { type: 'utf8' })
      const expiresInMin = Math.max(1, Math.round((created.expiresAt - Date.now()) / 60_000))

      const summary = [
        `请打开 TokenWallet App，进入「添加卡片 → ${created.provider}」，点击「扫描二维码」扫描下方二维码即可完成连接（有效期约 ${expiresInMin} 分钟）：`,
        '',
        `连接码：${created.mcpCode}`,
        `手机直达链接：${created.deepLink}`,
        `网页跳转链接：${created.webLink}`,
        '',
        '```',
        asciiQr.trimEnd(),
        '```',
        '',
        '扫码后本 MCP 会自动完成配对并保存只写上报凭证；也可以调用 `check_connection_status` 立即确认绑定状态。',
      ].join('\n')

      return {
        content: [
          {
            type: 'image',
            data: base64Png,
            mimeType: 'image/png',
          },
          {
            type: 'text',
            text: summary,
          },
        ],
      }
    },
  )

  server.registerTool(
    'check_connection_status',
    {
      title: 'Check TokenWallet Connection Status',
      description: 'Poll pending QR pairing sessions and report currently connected TokenWallet cards.',
      inputSchema: {
        sessionId: z.string().optional().describe('Optional specific pending sessionId to poll'),
      },
    },
    async ({ sessionId }) => {
      const cfg = loadConfig()
      const targets = sessionId
        ? cfg.pendingSessions.filter((s) => s.sessionId === sessionId)
        : cfg.pendingSessions
      const newlyBound: BoundConnection[] = []
      for (const s of targets) {
        const bound = await tryPollPendingSession(s)
        if (bound) newlyBound.push(bound)
      }

      const updated = loadConfig()
      const lines: string[] = []
      if (newlyBound.length > 0) {
        lines.push(`新完成绑定 ${newlyBound.length} 张卡片：`)
        for (const c of newlyBound) {
          lines.push(`- ${c.provider} (${c.brand}) · cardId=${c.cardId}`)
        }
      } else if (updated.pendingSessions.length > 0) {
        lines.push(`仍有 ${updated.pendingSessions.length} 个等待扫码的会话（最新连接码：${updated.pendingSessions[0].mcpCode}）。`)
      } else {
        lines.push('当前没有等待中的扫码会话。')
      }

      lines.push('')
      lines.push(`已绑定卡片总数：${updated.connections.length}`)
      for (const c of updated.connections) {
        lines.push(`- ${c.provider} (${c.brand}) · cardId=${c.cardId}`)
      }

      return {
        content: [{ type: 'text', text: lines.join('\n') }],
      }
    },
  )

  server.registerTool(
    'report_quota',
    {
      title: 'Report Quota to TokenWallet',
      description: 'Push real-time remaining token quota or balance meters to a bound TokenWallet card.',
      inputSchema: {
        cardId: z.string().optional().describe('Target cardId (optional; defaults to matching brand or latest bound card)'),
        brand: z.string().optional().describe('Brand filter when cardId is omitted, e.g. "openai", "claude"'),
        plan: z.string().optional().describe('Optional updated plan name, e.g. "Plus", "Pro"'),
        accountHint: z.string().optional().describe('Optional masked account hint'),
        meters: z.array(meterSchema).min(1).describe('One or more quota meters to report'),
      },
    },
    async (args) => {
      await syncAllPendingSessions()
      const cfg = loadConfig()
      const conn =
        (args.cardId && cfg.connections.find((c) => c.cardId === args.cardId)) ||
        (args.brand && cfg.connections.find((c) => c.brand === args.brand)) ||
        cfg.connections[0]

      if (!conn) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: '尚未绑定任何 TokenWallet 卡片。请先调用 `connect_tokenwallet` 生成二维码并在手机 App 中扫码绑定。',
            },
          ],
        }
      }

      const baseUrl = getApiBaseUrl()
      const now = Date.now()
      const res = await apiSubmitReport(baseUrl, conn.writeToken, {
        plan: args.plan,
        accountHint: args.accountHint,
        observedAt: now,
        meters: args.meters.map((m) => ({
          ...m,
          observedAt: now,
        })),
      })
      markConnectionReported(conn.cardId, now)

      return {
        content: [
          {
            type: 'text',
            text: `已上报 ${conn.provider}（cardId=${res.cardId}）最新额度，更新字段：${res.updatedMeters.join(', ') || '无'}，服务端版本 rev=${res.revision}。`,
          },
        ],
      }
    },
  )

  server.registerTool(
    'sync_local_quotas',
    {
      title: 'Sync Real Local AI Client Quotas',
      description:
        'Collect real-time remaining quotas from locally installed AI clients (Codex CLI, Claude Code, Cursor, Gemini CLI, Grok/xAI) and push updates to bound TokenWallet cards.',
      inputSchema: {
        brand: z
          .enum(['openai', 'claude', 'cursor', 'gemini', 'grok'])
          .optional()
          .describe('Optional specific brand to sync; omit to sync all bound local providers'),
        cardId: z.string().optional().describe('Optional specific bound cardId'),
      },
    },
    async ({ brand, cardId }) => {
      await syncAllPendingSessions()
      const cfg = loadConfig()
      const baseUrl = getApiBaseUrl()
      const targetBrands = brand
        ? [brand]
        : Array.from(new Set(cfg.connections.map((c) => c.brand)))

      if (targetBrands.length === 0) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: '尚未绑定任何 TokenWallet 卡片。请先调用 connect_tokenwallet 生成二维码并在手机 App 中扫码绑定。',
            },
          ],
        }
      }

      const lines: string[] = []
      for (const b of targetBrands) {
        const snapshot = await collectQuotaForBrand(b)
        if (!snapshot) {
          lines.push(`- ${b}: 未检测到本机可用额度数据源`)
          continue
        }
        const conn =
          (cardId && cfg.connections.find((c) => c.cardId === cardId)) ||
          cfg.connections.find((c) => c.brand === b)
        if (!conn) {
          lines.push(
            `- ${b}: 已采集到真实额度（${snapshot.meters.map((m) => `${m.label} ${m.remaining}${m.unit ?? ''}`).join('，')}），但尚未绑定卡片`,
          )
          continue
        }
        const res = await apiSubmitReport(baseUrl, conn.writeToken, {
          plan: snapshot.plan,
          accountHint: snapshot.accountHint,
          observedAt: snapshot.observedAt,
          meters: snapshot.meters,
        })
        markConnectionReported(conn.cardId, Date.now())
        const summary = snapshot.meters
          .map((m) => `${m.label} ${m.remaining}${m.unit ?? ''}`)
          .join('，')
        lines.push(`- ${conn.provider} (cardId=${res.cardId}): 已同步 ${summary}`)
      }

      return {
        content: [{ type: 'text', text: lines.join('\n') }],
      }
    },
  )

  server.registerTool(
    'list_connections',
    {
      title: 'List Connected TokenWallet Cards',
      description: 'List all locally bound TokenWallet cards and verify their node connectivity.',
      inputSchema: {},
    },
    async () => {
      await syncAllPendingSessions()
      const cfg = loadConfig()
      if (cfg.connections.length === 0) {
        return {
          content: [{ type: 'text', text: '当前没有已绑定的 TokenWallet 卡片。可调用 `connect_tokenwallet` 开始绑定。' }],
        }
      }
      const baseUrl = getApiBaseUrl()
      const lines: string[] = [`API 地址：${baseUrl}`, `已绑定卡片 (${cfg.connections.length})：`]
      for (const conn of cfg.connections) {
        let status = 'online'
        try {
          await apiPingNode(baseUrl, conn.writeToken)
        } catch (err) {
          status = `error: ${err instanceof Error ? err.message : 'unreachable'}`
        }
        lines.push(`- ${conn.provider} (${conn.brand}) · cardId=${conn.cardId} · 状态=${status}`)
      }
      return {
        content: [{ type: 'text', text: lines.join('\n') }],
      }
    },
  )

  return server
}
