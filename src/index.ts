#!/usr/bin/env node
import http from 'node:http'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'

import { getApiBaseUrl } from './config.js'
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

async function startStdio() {
  const server = createTokenWalletMcpServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
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
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(
        JSON.stringify({
          ok: true,
          service: 'tokenwallet-mcp',
          transport: 'streamable-http',
          mcpEndpoint: '/mcp',
          apiBaseUrl: getApiBaseUrl(),
        }),
      )
      return
    }

    if (url.pathname === '/mcp') {
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
    res.end(JSON.stringify({ error: 'Not Found. Use /mcp for Streamable HTTP MCP.' }))
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
