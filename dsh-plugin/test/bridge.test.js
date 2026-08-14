import assert from 'node:assert/strict'
import http from 'node:http'
import { afterEach, describe, it } from 'node:test'
import {
  agentErrorEvent,
  createBridge,
  mapSessionEvent,
  sessionStartEvent,
  usageRecordForSessionEvent,
} from '../src/bridge.js'
import { applyDesiredPluginStates, loaderInventory } from '../src/index.js'

const servers = new Set()

afterEach(async () => {
  await Promise.all([...servers].map(server => new Promise(resolve => server.close(resolve))))
  servers.clear()
})

async function listen(handler) {
  const server = http.createServer(handler)
  servers.add(server)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { server, port: server.address().port }
}

function config(port) {
  return {
    port,
    eventTimeoutMs: 500,
    permissionCreateTimeoutMs: 500,
    permissionWaitTimeoutMs: 500,
  }
}

describe('DeepSeek Harness event mapping', () => {
  it('marks a real Harness session start', () => {
    const event = sessionStartEvent('session-1')
    assert.equal(event.source, 'deepseek-harness')
    assert.equal(event.hook, 'agent/session-start')
    assert.equal(event.event, 'idle')
    assert.equal(event.sessionId, 'session-1')
  })

  it('pairs tool calls and results without forwarding result content', () => {
    const calls = new Map()
    const started = mapSessionEvent('session-1', {
      type: 'tool/call',
      data: { callId: 'call-1', name: 'tool_pwsh', arguments: '{"command":"npm test"}' },
    }, calls)
    assert.deepEqual({
      event: started.event,
      hook: started.hook,
      tool: started.tool,
      detail: started.detail,
    }, {
      event: 'running',
      hook: 'tool/call',
      tool: 'tool_pwsh',
      detail: 'npm test',
    })

    const finished = mapSessionEvent('session-1', {
      type: 'tool/result',
      data: {
        message: {
          content: [{
            type: 'tool-result',
            toolCallId: 'call-1',
            isError: true,
            content: [{ type: 'text', text: 'private command output' }],
          }],
        },
      },
    }, calls)
    assert.equal(finished.event, 'error')
    assert.equal(finished.tool, 'tool_pwsh')
    assert.equal(finished.message, 'The tool reported an error.')
    assert.equal(JSON.stringify(finished).includes('private command output'), false)
    assert.equal(calls.size, 0)
  })

  it('maps completed, failed, and aborted turns distinctly', () => {
    const calls = new Map()
    const completed = mapSessionEvent('s', {
      type: 'turn/end', data: { reason: { kind: 'completed' } },
    }, calls)
    const failed = mapSessionEvent('s', {
      type: 'turn/end', data: { reason: { kind: 'error', error: { message: 'provider failed' } } },
    }, calls)
    const aborted = mapSessionEvent('s', {
      type: 'turn/end', data: { reason: { kind: 'aborted', reason: { kind: 'user' } } },
    }, calls)
    assert.equal(completed.event, 'completed')
    assert.equal(failed.event, 'error')
    assert.equal(failed.message, 'provider failed')
    assert.equal(aborted.event, 'idle')
  })

  it('bounds agent error text', () => {
    const event = agentErrorEvent('s', new Error('x'.repeat(3000)))
    assert.equal(event.event, 'error')
    assert.equal(event.message.length, 2000)
  })

  it('maps usage and route metadata without forwarding assistant content', () => {
    const record = usageRecordForSessionEvent({
      id: 'session-1',
      header: { cwd: 'C:\\work\\repo' },
      requestContext: () => ({ provider: 'deepseek', model: 'deepseek-chat' }),
      requestHeader: () => ({ config: { provider: 'fallback', model: 'fallback-model' } }),
    }, {
      type: 'assistant/message',
      seq: 12,
      time: 1_700_000_000_000,
      data: {
        usage: {
          inputTokens: 100,
          outputTokens: 20,
          cacheReadTokens: 30,
          cacheWriteTokens: 5,
          reasoningTokens: 7,
        },
        message: { content: [{ type: 'text', text: 'private response' }] },
      },
    })
    assert.deepEqual(record, {
      id: 'session-1:12',
      sessionId: 'session-1',
      seq: 12,
      timestamp: 1_700_000_000_000,
      provider: 'deepseek',
      model: 'deepseek-chat',
      cwd: 'C:\\work\\repo',
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 30,
      cacheWriteTokens: 5,
      reasoningTokens: 7,
    })
    assert.equal(JSON.stringify(record).includes('private response'), false)
  })
})

describe('DSH Desk loopback transport', () => {
  it('preserves event order', async () => {
    const received = []
    const { port } = await listen((request, response) => {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', chunk => { body += chunk })
      request.on('end', () => {
        received.push(JSON.parse(body).hook)
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end('{"ok":true}')
      })
    })
    const lifecycle = new AbortController()
    const bridge = createBridge(config(port), lifecycle.signal)
    await Promise.all([
      bridge.publish(sessionStartEvent('s')),
      bridge.publish(mapSessionEvent('s', { type: 'turn/start', data: { turn: 1 } }, new Map())),
    ])
    assert.deepEqual(received, ['agent/session-start', 'turn/start'])
  })

  it('publishes assistant usage to its analytics endpoint', async () => {
    const received = []
    const { port } = await listen((request, response) => {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', chunk => { body += chunk })
      request.on('end', () => {
        received.push({ path: request.url, body: JSON.parse(body) })
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end('{"ok":true}')
      })
    })
    const bridge = createBridge(config(port), new AbortController().signal)
    const session = {
      id: 's',
      header: { cwd: 'C:\\repo' },
      requestContext: () => ({ provider: 'deepseek', model: 'deepseek-chat' }),
    }
    assert.equal(await bridge.publishSessionEvent(session, {
      type: 'assistant/message', seq: 3, time: 123, data: {
        usage: { inputTokens: 10, outputTokens: 2 },
        message: { content: [{ type: 'text', text: 'secret' }] },
      },
    }), true)
    assert.equal(received[0].path, '/dsh-usage')
    assert.equal(received[0].body.inputTokens, 10)
    assert.equal(JSON.stringify(received[0]).includes('secret'), false)
  })

  it('translates allow and falls through when the desktop app declines ownership', async () => {
    let createCount = 0
    const { port } = await listen((request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      if (request.method === 'POST') {
        createCount += 1
        response.end(createCount === 1 ? '{"id":"approval-1"}' : '{}')
      } else {
        response.end('{"status":"approved","decision":"allow"}')
      }
    })
    const lifecycle = new AbortController()
    const bridge = createBridge(config(port), lifecycle.signal)
    const request = {
      toolName: 'tool_pwsh',
      reason: 'Needs workspace access',
      agent: { session: { id: 'session-1' } },
      signal: new AbortController().signal,
    }
    assert.equal(await bridge.requestApproval(request), 'allowed-once')
    assert.equal(await bridge.requestApproval(request), undefined)
  })
})

describe('DSH Loader inventory bridge', () => {
  it('publishes the complete non-group Loader order', () => {
    const entries = Array.from({ length: 160 }, (_, index) => ({
      id: `root:entry-${index}`,
      disabled: index % 2 === 0,
      options: { id: `entry-${index}`, name: `@deepseek-ai/plugin-${index}`, group: false },
      fiber: { state: 2 },
    }))
    assert.equal(loaderInventory({ entries: () => entries }).entries.length, 160)
    assert.deepEqual(loaderInventory({ entries: () => entries }).entries[159], {
      entryId: 'root:entry-159',
      configId: 'entry-159',
      moduleName: '@deepseek-ai/plugin-159',
      enabled: true,
      fiberPhase: 'active',
    })
  })

  it('applies only third-party desired states and persists through the owning tree', async () => {
    const updates = []
    const tree = { update: async (id, value) => { updates.push([id, value]) } }
    const entries = [{ id: 'core', disabled: false, options: { id: 'core', name: '@deepseek-ai/core' }, parent: { tree } }, {
      id: 'third', disabled: false, options: { id: 'third-config', name: 'third-party-plugin' }, parent: { tree },
    }]
    await applyDesiredPluginStates({ entries: () => entries }, { core: false, third: false })
    assert.deepEqual(updates, [['third-config', { disabled: true }]])
  })
})
