import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface BoundConnection {
  cardId: string
  nodeId: string
  brand: string
  provider: string
  writeToken: string
  fingerprintSalt?: string
  connectedAt: number
  lastReportedAt?: number
}

export interface PendingSession {
  sessionId: string
  mcpCode: string
  pollToken: string
  brand: string
  provider: string
  deepLink: string
  webLink: string
  expiresAt: number
  createdAt: number
}

export interface McpConfig {
  apiBaseUrl: string
  connections: BoundConnection[]
  pendingSessions: PendingSession[]
}

const DEFAULT_API_URL = process.env.TOKENWALLET_API_URL || 'http://localhost:8787/v1'
const CONFIG_DIR = process.env.TOKENWALLET_MCP_HOME || path.join(os.homedir(), '.tokenwallet-mcp')
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')

export function getApiBaseUrl(): string {
  const cfg = loadConfig()
  return (process.env.TOKENWALLET_API_URL || cfg.apiBaseUrl || DEFAULT_API_URL).replace(/\/+$/, '')
}

export function loadConfig(): McpConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) as Partial<McpConfig>
      return {
        apiBaseUrl: parsed.apiBaseUrl || DEFAULT_API_URL,
        connections: Array.isArray(parsed.connections) ? parsed.connections : [],
        pendingSessions: Array.isArray(parsed.pendingSessions) ? parsed.pendingSessions : [],
      }
    }
  } catch {
    // Fall through to default config
  }
  return {
    apiBaseUrl: DEFAULT_API_URL,
    connections: [],
    pendingSessions: [],
  }
}

export function saveConfig(config: McpConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { encoding: 'utf8', mode: 0o600 })
}

export function savePendingSession(session: PendingSession): void {
  const cfg = loadConfig()
  const now = Date.now()
  const active = cfg.pendingSessions.filter(
    (s) => s.sessionId !== session.sessionId && s.expiresAt > now,
  )
  active.unshift(session)
  cfg.pendingSessions = active.slice(0, 10)
  saveConfig(cfg)
}

export function removePendingSession(sessionId: string): void {
  const cfg = loadConfig()
  cfg.pendingSessions = cfg.pendingSessions.filter((s) => s.sessionId !== sessionId)
  saveConfig(cfg)
}

export function upsertBoundConnection(conn: BoundConnection): void {
  const cfg = loadConfig()
  const existingIdx = cfg.connections.findIndex((c) => c.cardId === conn.cardId)
  if (existingIdx >= 0) {
    cfg.connections[existingIdx] = conn
  } else {
    cfg.connections.unshift(conn)
  }
  saveConfig(cfg)
}

export function markConnectionReported(cardId: string, reportedAt = Date.now()): void {
  const cfg = loadConfig()
  const target = cfg.connections.find((c) => c.cardId === cardId)
  if (target) {
    target.lastReportedAt = reportedAt
    saveConfig(cfg)
  }
}
