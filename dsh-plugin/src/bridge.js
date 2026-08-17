import { randomUUID } from 'node:crypto'
import http from 'node:http'

const MAX_RESPONSE_BYTES = 64 * 1024

function shorten(value, maxLength) {
  if (value === undefined || value === null) return undefined
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  if (!text) return undefined
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function salientToolDetail(rawArguments) {
  if (typeof rawArguments !== 'string' || rawArguments.length === 0) return undefined
  try {
    const value = asObject(JSON.parse(rawArguments))
    if (value !== null) {
      if (Array.isArray(value.questions)) {
        const question = value.questions
          .map(asObject)
          .find(item => typeof item?.question === 'string' && item.question.trim())
        if (question !== undefined) return shorten(question.question.trim(), 2000)
      }
      for (const key of [
        'command', 'file_path', 'filePath', 'path', 'pattern', 'url', 'query',
        'prompt', 'description', 'notebook_path', 'notebookPath',
      ]) {
        if (typeof value[key] === 'string' && value[key].trim()) {
          return shorten(value[key].trim(), 2000)
        }
      }
    }
  } catch {
    // Harness preserves invalid model-produced argument JSON in the session log.
  }
  return shorten(rawArguments, 2000)
}

function toolResultFacts(data) {
  const resultBlock = data?.message?.content?.[0]
  return {
    callId: typeof resultBlock?.toolCallId === 'string' ? resultBlock.toolCallId : undefined,
    failed: data?.error !== undefined || resultBlock?.isError === true,
  }
}

function errorMessage(value) {
  if (typeof value === 'string') return shorten(value, 2000)
  if (value && typeof value === 'object' && typeof value.message === 'string') {
    return shorten(value.message, 2000)
  }
  return shorten(value, 2000)
}

function tokenCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0
}

export function usageRecordForSessionEvent(session, event) {
  if (event?.type !== 'assistant/message') return null
  const usage = asObject(event.data?.usage)
  if (usage === null || !Number.isSafeInteger(event.seq) || event.seq < 0) return null
  const inputTokens = tokenCount(usage.inputTokens)
  const outputTokens = tokenCount(usage.outputTokens)
  const cacheReadTokens = tokenCount(usage.cacheReadTokens)
  const cacheWriteTokens = tokenCount(usage.cacheWriteTokens)
  if (inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens === 0) return null

  const context = typeof session.requestContext === 'function' ? asObject(session.requestContext()) : null
  const header = typeof session.requestHeader === 'function' ? asObject(session.requestHeader()) : null
  const config = asObject(header?.config)
  const provider = context?.provider ?? config?.provider
  const model = context?.model ?? config?.model
  const sessionId = String(session.id)
  return {
    id: `${sessionId}:${event.seq}`,
    sessionId,
    seq: event.seq,
    timestamp: Number.isFinite(event.time) && event.time > 0 ? event.time : Date.now(),
    provider: shorten(provider, 200) ?? 'unknown',
    model: shorten(model, 500) ?? 'unknown',
    ...(typeof session.header?.cwd === 'string' && session.header.cwd
      ? { cwd: shorten(session.header.cwd, 4096) }
      : {}),
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens: tokenCount(usage.reasoningTokens),
  }
}

export function createPetEvent(event, sessionId, hook, fields = {}) {
  return {
    id: randomUUID(),
    event,
    source: 'deepseek-harness',
    hook,
    sessionId,
    timestamp: Date.now(),
    ...fields,
  }
}

export function sessionStartEvent(sessionId) {
  return createPetEvent('idle', sessionId, 'agent/session-start', {
    title: 'DSH is online',
    message: 'Ready',
  })
}

export function agentErrorEvent(sessionId, error) {
  return createPetEvent('error', sessionId, 'agent/error', {
    title: 'DeepSeek Harness error',
    message: errorMessage(error) ?? 'The agent reported an error.',
  })
}

export function mapSessionEvent(sessionId, event, toolCalls) {
  switch (event?.type) {
    case 'turn/start':
      return createPetEvent('running', sessionId, event.type, {
        title: 'Working',
        message: 'Handling prompt',
      })
    case 'tool/call': {
      const detail = salientToolDetail(event.data?.arguments)
      const callId = event.data?.callId
      if (typeof callId === 'string') {
        toolCalls.set(`${sessionId}\0${callId}`, { name: event.data?.name, detail })
      }
      return createPetEvent('running', sessionId, event.type, {
        title: 'Using tool',
        tool: shorten(event.data?.name, 200),
        detail,
      })
    }
    case 'tool/result': {
      const result = toolResultFacts(event.data)
      const key = result.callId === undefined ? undefined : `${sessionId}\0${result.callId}`
      const call = key === undefined ? undefined : toolCalls.get(key)
      if (key !== undefined) toolCalls.delete(key)
      return createPetEvent(result.failed ? 'error' : 'running', sessionId, event.type, {
        title: result.failed ? 'Tool failed' : 'Tool completed',
        message: result.failed ? 'The tool reported an error.' : undefined,
        tool: shorten(call?.name ?? 'Unknown', 200),
        detail: call?.detail,
      })
    }
    case 'turn/end': {
      const reason = event.data?.reason
      if (reason?.kind === 'error') {
        return createPetEvent('error', sessionId, event.type, {
          title: 'Task failed',
          message: errorMessage(reason.error) ?? 'The task failed.',
        })
      }
      if (reason?.kind === 'blocked') {
        return createPetEvent('error', sessionId, event.type, {
          title: 'Task blocked',
          message: 'DeepSeek Harness could not continue the task.',
        })
      }
      if (reason?.kind === 'completed' || reason?.kind === 'max-tokens') {
        return createPetEvent('completed', sessionId, event.type, {
          title: reason.kind === 'max-tokens' ? 'Token limit reached' : 'Completed',
          message: reason.kind === 'max-tokens' ? 'The turn reached its output limit.' : 'Task finished',
        })
      }
      return createPetEvent('idle', sessionId, event.type, {
        title: 'Task stopped',
        message: 'Waiting for the next prompt',
      })
    }
    default:
      return null
  }
}

function requestJson({ port, path, method, timeoutMs, body, signal }) {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(null)
      return
    }
    const encoded = body === undefined ? undefined : JSON.stringify(body)
    const request = http.request({
      host: '127.0.0.1',
      port,
      path,
      method,
      timeout: timeoutMs,
      signal,
      headers: encoded === undefined ? undefined : {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(encoded),
      },
    }, (response) => {
      let responseBody = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        if (responseBody.length < MAX_RESPONSE_BYTES) responseBody += chunk
        if (responseBody.length >= MAX_RESPONSE_BYTES) request.destroy()
      })
      response.on('end', () => {
        if (response.statusCode === undefined || response.statusCode < 200 || response.statusCode >= 300) {
          resolve(null)
          return
        }
        try {
          resolve(responseBody ? JSON.parse(responseBody) : {})
        } catch {
          resolve(null)
        }
      })
    })
    request.on('timeout', () => request.destroy())
    request.on('error', () => resolve(null))
    if (encoded !== undefined) request.write(encoded)
    request.end()
  })
}

export function createBridge(config, lifecycleSignal) {
  const toolCalls = new Map()
  let eventQueue = Promise.resolve(null)

  const requestTo = (path, body) => {
    eventQueue = eventQueue.then(() => requestJson({
      port: config.port,
      path,
      method: 'POST',
      timeoutMs: config.eventTimeoutMs,
      body,
      signal: lifecycleSignal,
    }))
    return eventQueue
  }

  const publishTo = (path, body) => requestTo(path, body).then(result => result?.ok === true)

  const publish = event => publishTo('/event', event)

  return {
    publish,
    publishPluginInventory(snapshot) {
      return requestTo('/dsh-plugin-inventory', snapshot)
    },
    publishSessionEvent(session, event) {
      const usage = usageRecordForSessionEvent(session, event)
      if (usage !== null) return publishTo('/dsh-usage', usage)
      const mapped = mapSessionEvent(String(session.id), event, toolCalls)
      return mapped === null ? Promise.resolve(false) : publish(mapped)
    },
    async requestApproval(request) {
      if (request.signal?.aborted) return 'cancelled'
      const signal = AbortSignal.any([lifecycleSignal, request.signal].filter(Boolean))
      const created = await requestJson({
        port: config.port,
        path: '/permission',
        method: 'POST',
        timeoutMs: config.permissionCreateTimeoutMs,
        body: {
          toolName: shorten(request.toolName, 200) ?? 'Unknown',
          toolDetail: shorten(request.reason, 2000),
          sessionId: String(request.agent.session.id),
          rawPayload: {},
        },
        signal,
      })
      if (request.signal?.aborted) return 'cancelled'
      if (typeof created?.id !== 'string') return undefined
      const result = await requestJson({
        port: config.port,
        path: `/permission/${created.id}`,
        method: 'GET',
        timeoutMs: config.permissionWaitTimeoutMs,
        signal,
      })
      if (request.signal?.aborted) return 'cancelled'
      if (result?.decision === 'allow') return 'allowed-once'
      if (result?.decision === 'deny') return 'rejected'
      return undefined
    },
    close() {
      toolCalls.clear()
      return eventQueue
    },
  }
}
