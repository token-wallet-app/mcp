export interface MeterReportItem {
  meterKey: string
  product?: string
  label: string
  kind: 'percent' | 'balance'
  window?: '5h' | 'day' | 'week' | 'month' | 'rolling'
  modelGroup?: string
  remaining: number
  total?: number
  unit?: string
  resetsAt?: number
  observedAt?: number
}

export interface CreateMcpSessionResponse {
  sessionId: string
  mcpCode: string
  pollToken: string
  brand: string
  provider: string
  deepLink: string
  webLink: string
  qrPayload: string
  expiresAt: number
}

export interface PollMcpSessionResponse {
  sessionId: string
  mcpCode: string
  status: 'pending' | 'authorized' | 'expired'
  expiresAt: number
  cardId?: string
  nodeId?: string
  writeToken?: string
  fingerprintSalt?: string
}

export interface SubmitReportResponse {
  ok: boolean
  cardId: string
  revision: number
  updatedMeters: string[]
  ignoredStaleMeters: string[]
}

export interface PingNodeResponse {
  ok: boolean
  nodeId: string
  cardId: string
  brand: string
  provider: string
  lastSeenAt?: number | null
}

async function requestJson<T>(
  baseUrl: string,
  pathname: string,
  options: { method?: 'GET' | 'POST'; token?: string; body?: unknown } = {},
): Promise<T> {
  const url = `${baseUrl.replace(/\/+$/, '')}${pathname}`
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json; charset=utf-8',
  }
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`
  }
  const res = await fetch(url, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })
  const data = (await res.json().catch(() => null)) as
    | { error?: { code?: string; message?: string } }
    | null
  if (!res.ok) {
    const msg = data?.error?.message || `TokenWallet API error (${res.status})`
    const err = new Error(msg) as Error & { code?: string; status?: number }
    err.code = data?.error?.code
    err.status = res.status
    throw err
  }
  return data as T
}

export function apiCreateMcpSession(
  baseUrl: string,
  params: {
    brand: string
    provider?: string
    nodeLabel?: string
    source?: string
    plan?: string
    accountHint?: string
    meters?: MeterReportItem[]
  },
): Promise<CreateMcpSessionResponse> {
  return requestJson<CreateMcpSessionResponse>(baseUrl, '/mcp/sessions', {
    method: 'POST',
    body: params,
  })
}

export function apiPollMcpSession(
  baseUrl: string,
  sessionId: string,
  pollToken: string,
): Promise<PollMcpSessionResponse> {
  return requestJson<PollMcpSessionResponse>(
    baseUrl,
    `/mcp/sessions/${encodeURIComponent(sessionId)}/poll`,
    { method: 'GET', token: pollToken },
  )
}

export function apiSubmitReport(
  baseUrl: string,
  writeToken: string,
  params: {
    plan?: string
    accountHint?: string
    observedAt?: number
    meters: MeterReportItem[]
  },
): Promise<SubmitReportResponse> {
  return requestJson<SubmitReportResponse>(baseUrl, '/reports', {
    method: 'POST',
    token: writeToken,
    body: {
      ...params,
      observedAt: params.observedAt ?? Date.now(),
    },
  })
}

export function apiPingNode(baseUrl: string, writeToken: string): Promise<PingNodeResponse> {
  return requestJson<PingNodeResponse>(baseUrl, '/reports/ping', {
    method: 'GET',
    token: writeToken,
  })
}
