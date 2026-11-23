#!/usr/bin/env node
import http from 'node:http'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'

import { apiSubmitReport } from './api.js'
import { readLatestCodexQuota } from './codex-reader.js'
import { getApiBaseUrl, loadConfig, markConnectionReported } from './config.js'
import { createTokenWalletMcpServer } from './server.js'

function parseArgs() {
  const argv = process.argv.slice(2)
  const useHttp = argv.includes('--http') || process.env.MCP_TRANSPORT === 'http'
  const portIdx = argv.indexOf('--port')
  const port =
    (portIdx >= 0 && Number(argv[portIdx + 1])) ||
    Number(process.env.PORT) ||
    8788
  return { useHttp, port }
}

function startLocalCodexAutoReporter() {
  let lastObservedAt = 0
  const tick = async () => {
    try {
      const snap = readLatestCodexQuota()
      if (!snap || snap.observedAt <= lastObservedAt) return
      const cfg = loadConfig()
      const openaiConns = cfg.connections.filter((c) => c.brand === 'openai')
      if (openaiConns.length === 0) return
      const baseUrl = getApiBaseUrl()
      for (const conn of openaiConns) {
        await apiSubmitReport(baseUrl, conn.writeToken, {
          plan: snap.plan,
          observedAt: snap.observedAt,
          meters: snap.meters,
        })
        markConnectionReported(conn.cardId, Date.now())
      }
      lastObservedAt = snap.observedAt
    } catch {
      // Ignore transient network errors during background sync
    }
  }
  void tick()
  const timer = setInterval(() => {
    void tick()
  }, 60_000)
  timer.unref()
}

async function startStdio() {
  const server = createTokenWalletMcpServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
  startLocalCodexAutoReporter()
  console.error(`[tokenwallet-mcp] stdio ready (API: ${getApiBaseUrl()})`)
}

async function startHttp(port: number) {
  const httpServer = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    const pathname = url.pathname.replace(/\/+$/, '') || '/'
    const acceptHeader = String(req.headers.accept || '')
    const isBrowserHealthCheck =
      req.method === 'GET' &&
      (pathname === '/health' || (pathname === '/' && !acceptHeader.includes('text/event-stream')))

    if (isBrowserHealthCheck) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(
        JSON.stringify({
          ok: true,
          service: 'tokenwallet-mcp',
          transport: 'streamable-http',
          mcpEndpoint: '/',
          apiBaseUrl: getApiBaseUrl(),
        }),
      )
      return
    }

    if (pathname === '/' || pathname === '/mcp') {
      try {
        const server = createTokenWalletMcpServer()
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        })
        res.on('close', () => {
          void transport.close()
          void server.close()
        })
        await server.connect(transport)
        await transport.handleRequest(req, res)
      } catch (err) {
        console.error('[tokenwallet-mcp] HTTP error:', err)
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Internal server error' }))
        }
      }
      return
    }

    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: 'Not Found. Use / or /mcp for Streamable HTTP MCP.' }))
  })

  const host = process.env.HOST || '0.0.0.0'
  httpServer.listen(port, host, () => {
    console.log(`[tokenwallet-mcp] Streamable HTTP listening on http://${host}:${port}/mcp`)
    console.log(`[tokenwallet-mcp] TokenWallet API: ${getApiBaseUrl()}`)
  })
}

const { useHttp, port } = parseArgs()
if (useHttp) {
  await startHttp(port)
} else {
  await startStdio()
}
