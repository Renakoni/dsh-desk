import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, describe, it } from 'node:test'
import { pathToFileURL } from 'node:url'
import {
  agentErrorEvent,
  createBridge,
  mapSessionEvent,
  sessionStartEvent,
  usageRecordForSessionEvent,
} from '../src/bridge.js'
import {
  apply as applyPlugin,
  allowGitHostedBuild,
  blockedBuildPackage,
  bundleConfigOwners,
  commandError,
  createAgentSkillPolicy,
  createPluginPackageController,
  detectThemeCompatibility,
  loaderInventory,
  mountAppearanceManager,
  runPlugin,
  runtimeEntryOwners,
} from '../src/index.js'

const servers = new Set()
const temporaryDirectories = new Set()

afterEach(async () => {
  await Promise.all([...servers].map(server => new Promise(resolve => server.close(resolve))))
  servers.clear()
  for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true })
  temporaryDirectories.clear()
})

function loaderFixture(rows) {
  const subtree = {}
  const include = {
    id: 'include',
    disabled: false,
    options: { id: 'include', name: 'cordis:include', config: {} },
    subtree,
    parent: { tree: {} },
  }
  const entries = [include, ...rows.map(row => ({
    disabled: false,
    fiber: { state: 2 },
    ...row,
    options: { group: false, ...row.options },
    parent: row.parent ?? { tree: subtree },
  }))]
  return { include, entries, loader: { entries: () => entries } }
}

async function listen(handler) {
  const server = http.createServer(handler)
  servers.add(server)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { server, port: server.address().port }
}

async function invokeRoute(route, { method = 'GET', path = route.path, body, origin = 'http://127.0.0.1:3080' } = {}) {
  const request = Readable.from(body === undefined ? [] : [JSON.stringify(body)])
  request.method = method
  request.url = path
  request.headers = { origin, host: '127.0.0.1:3080' }
  return new Promise((resolve, reject) => {
    const response = {
      writeHead(status) { this.status = status },
      end(value = '') {
        let parsed = null
        try { parsed = value ? JSON.parse(String(value)) : null } catch { parsed = value }
        resolve({ status: this.status, body: parsed })
      },
    }
    Promise.resolve(route.handler(request, response)).catch(reject)
  })
}

function config(port) {
  return {
    port,
    eventTimeoutMs: 500,
    permissionCreateTimeoutMs: 500,
    permissionWaitTimeoutMs: 500,
    inventoryPublishMs: 3000,
  }
}

describe('DeepSeek Harness event mapping', () => {
  it('marks a real Harness session start', () => {
    const event = sessionStartEvent('session-1')
    assert.equal(event.source, 'deepseek-harness')
    assert.equal(event.hook, 'agent/session-start')
    assert.equal(event.event, 'idle')
    assert.equal(event.sessionId, 'session-1')
    assert.equal(event.title, 'DSH is online')
    assert.equal(event.message, 'Ready')
  })

  it('shows the first user question instead of raw argument JSON', () => {
    const event = mapSessionEvent('session-1', {
      type: 'tool/call',
      data: {
        callId: 'call-question',
        name: 'ask_user_question',
        arguments: JSON.stringify({
          questions: [{ id: 'confirm', question: 'May I show you the plan before proceeding?' }],
        }),
      },
    }, new Map())

    assert.equal(event.tool, 'ask_user_question')
    assert.equal(event.detail, 'May I show you the plan before proceeding?')
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
  it('extracts and persists the exact git build approval requested by pnpm', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-theme-build-approval-'))
    temporaryDirectories.add(root)
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - .\n\nnodeLinker: hoisted\n')
    assert.equal(blockedBuildPackage(`ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED\nhint: Add the package to "onlyBuiltDependencies" in your project\nonlyBuiltDependencies:\n  - "@deepseek-ai/dsh-client-ui-aqua"`), '@deepseek-ai/dsh-client-ui-aqua')
    assert.equal(blockedBuildPackage('The git-hosted package "@deepseek-ai/dsh-client-ui-aqua@1.3.1" needs to execute build scripts'), '@deepseek-ai/dsh-client-ui-aqua')
    assert.equal(allowGitHostedBuild(root, '@deepseek-ai/dsh-client-ui-aqua'), true)
    assert.match(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8'), /allowBuilds:/)
    assert.match(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8'), /dsh-client-ui-aqua"?: true/)
    assert.equal(allowGitHostedBuild(root, '@deepseek-ai/dsh-client-ui-aqua'), false)
  })

  it('reads pnpm NDJSON build-block metadata and does not misclassify network errors', () => {
    const blocked = JSON.stringify({
      name: 'pnpm',
      err: {
        code: 'ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED',
        package: { bareSpecifier: '@deepseek-ai/dsh-client-ui-aqua@1.3.1' },
      },
    })
    assert.equal(blockedBuildPackage(blocked), '@deepseek-ai/dsh-client-ui-aqua')
    const currentPnpm = JSON.stringify({
      name: 'pnpm',
      code: 'ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED',
      hint: 'Add the package to "onlyBuiltDependencies" in your project.\\nonlyBuiltDependencies:\\n  - "@cdxdnrf/dsh-client-ui-skin-wishadel"',
      err: { message: 'Failed to prepare git-hosted package: The git-hosted package "@cdxdnrf/dsh-client-ui-skin-wishadel@0.6.0" needs to execute build scripts.' },
    })
    assert.equal(blockedBuildPackage(currentPnpm), '@cdxdnrf/dsh-client-ui-skin-wishadel')
    assert.equal(blockedBuildPackage(`${blocked.replace('ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED', 'ECONNRESET')}\ndsh: git-hosted plugins build on install via their prepare script, which pnpm blocks until allowed`), null)
    assert.match(commandError({ stderr: `${JSON.stringify({ name: 'pnpm', err: { code: 'ECONNRESET', message: 'request failed' } })}\ndsh: pnpm failed in profile directory C:\\profile` }), /ECONNRESET[\s\S]*request failed/)
    const notFound = JSON.stringify({ name: 'pnpm', code: 'ERR_PNPM_FETCH_404', resource: 'https://codeload.github.com/example/theme/tar.gz/missing', err: { code: 'ERR_PNPM_FETCH_404', message: 'Not Found' } })
    const notFoundError = commandError({ stderr: `${notFound}\ndsh: pnpm failed in profile directory C:\\profile\ndsh: git-hosted plugins build on install via their prepare script, which pnpm blocks until allowed` })
    assert.match(notFoundError, /ERR_PNPM_FETCH_404/)
    assert.match(notFoundError, /Not Found/)
    assert.doesNotMatch(notFoundError, /allowBuilds/)
  })

  it('retries a git theme install after allowing its blocked prepare build', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-theme-build-retry-'))
    temporaryDirectories.add(root)
    const marker = join(root, 'retry.marker')
    const fakeBin = join(root, 'bin.js')
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
    writeFileSync(fakeBin, [
      "const fs = require('node:fs')",
      `const marker = ${JSON.stringify(marker)}`,
      "if (!fs.existsSync(marker)) { fs.writeFileSync(marker, 'first'); console.error('hint: Add the package to \\\"onlyBuiltDependencies\\\" in your project\\nonlyBuiltDependencies:\\n  - \\\"@deepseek-ai/dsh-client-ui-aqua\\\"'); process.exit(1) }",
    ].join('\n'))
    const previousEntry = process.argv[1]
    const previousExecArgv = process.execArgv
    process.argv[1] = fakeBin
    process.execArgv = []
    try {
      const result = await runPlugin('web', ['add', 'github:demo/aqua#commit'], undefined, root)
      assert.equal(result.exitCode, 0)
      assert.equal(existsSync(marker), true)
      assert.match(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8'), /dsh-client-ui-aqua"?: true/)
    } finally {
      process.argv[1] = previousEntry
      process.execArgv = previousExecArgv
    }
  })

  it('mounts the built-in appearance manager under its own Host route namespace', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-appearance-manager-'))
    temporaryDirectories.add(root)
    const profile = join(root, 'web')
    mkdirSync(profile, { recursive: true })
    const routes = []
    const dispose = mountAppearanceManager({
      webServer: { register(route) { routes.push(route); return () => undefined } },
      loader: { entries: () => [{ options: { id: 'include', name: 'cordis:include', config: { path: join(profile, 'cordis.patch.yml') } } }] },
    })
    assert.deepEqual(routes.map(route => route.path), [
      '/dsh-appearance-manager/state',
      '/dsh-appearance-manager/install',
      '/dsh-appearance-manager/activate',
      '/dsh-appearance-manager/deactivate',
      '/dsh-appearance-manager/update',
      '/dsh-appearance-manager/uninstall',
      '/dsh-appearance-manager/operations',
    ])
    dispose()
  })

  it('reports and repairs a dependency whose theme package is incomplete', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-appearance-manager-broken-'))
    temporaryDirectories.add(root)
    const profile = join(root, 'web')
    const packageDir = join(profile, 'node_modules', 'demo-skin')
    mkdirSync(packageDir, { recursive: true })
    mkdirSync(join(profile, '.dsh-appearance-manager'), { recursive: true })
    writeFileSync(join(profile, 'package.json'), JSON.stringify({
      dependencies: { 'demo-skin': 'github:demo/skin#1234567890123456789012345678901234567890' },
    }))
    writeFileSync(join(profile, '.dsh-appearance-manager', 'state.json'), JSON.stringify({
      version: 1,
      skins: { 'demo.skin': { active: true, packageName: 'demo-skin', version: '1.0.0' } },
    }))
    writeFileSync(join(profile, 'cordis.patch.yml'), '[]\n')
    const calls = []
    const routes = []
    const dispose = mountAppearanceManager({
      webServer: { register(route) { routes.push(route); return () => undefined } },
      loader: { entries: () => [{ options: { id: 'include', name: 'cordis:include', config: { path: join(profile, 'cordis.patch.yml') } } }] },
      runPlugin: async (profileName, args) => {
        calls.push([profileName, args])
        mkdirSync(join(packageDir, 'lib'), { recursive: true })
        writeFileSync(join(packageDir, 'package.json'), JSON.stringify({
          name: 'demo-skin', version: '1.0.0',
          exports: { './client': './lib/client.js' }, dsh: { client: { platform: 'web' } },
        }))
        writeFileSync(join(packageDir, 'lib', 'client.js'), 'export const apply = () => undefined')
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    })
    const stateRoute = routes.find(route => route.path === '/dsh-appearance-manager/state')
    const state = await invokeRoute(stateRoute)
    assert.equal(state.body.skins[0].installation, 'broken')

    const installRoute = routes.find(route => route.path === '/dsh-appearance-manager/install')
    const started = await invokeRoute(installRoute, { method: 'POST', body: {
      skin: {
        id: 'demo.skin',
        packageName: 'demo-skin',
        rowId: 'demo-skin',
        install: { target: 'github:demo/skin#1234567890123456789012345678901234567890', version: '1.0.0' },
      },
    }})
    assert.equal(started.status, 202)
    const operations = routes.find(route => route.kind === 'prefix')
    let operation
    for (let attempt = 0; attempt < 20; attempt += 1) {
      operation = await invokeRoute(operations, { path: `/dsh-appearance-manager/operations/${started.body.operationId}` })
      if (operation.body?.phase === 'done') break
      await new Promise(resolve => setImmediate(resolve))
    }
    assert.equal(operation.body.phase, 'done')
    assert.deepEqual(calls, [['web', ['add', 'github:demo/skin#1234567890123456789012345678901234567890']]])
    dispose()
  })

  it('detects the old Aqua keyed-settings registration at activation time', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-theme-compatibility-'))
    temporaryDirectories.add(root)
    const profile = join(root, 'web')
    const packageDir = join(profile, 'node_modules', '@deepseek-ai', 'dsh-client-ui-aqua')
    mkdirSync(join(packageDir, 'lib'), { recursive: true })
    writeFileSync(join(profile, 'package.json'), JSON.stringify({ dependencies: { '@deepseek-ai/dsh-client-ui-aqua': '1.3.0' } }))
    writeFileSync(join(packageDir, 'package.json'), JSON.stringify({
      name: '@deepseek-ai/dsh-client-ui-aqua', version: '1.3.0',
      exports: { './client': './lib/client.js' }, dsh: { client: { platform: 'web' } },
    }))
    writeFileSync(join(packageDir, 'lib', 'client.js'), 'ctx.slots.register({ name: "settings.plugin.item", id: "aqua" }, AquaPluginCard)')
    assert.deepEqual(detectThemeCompatibility(profile, '@deepseek-ai/dsh-client-ui-aqua'), {
      status: 'adapted', code: 'legacy-keyed-settings-item',
    })
  })

  it('does not classify a current keyed-settings registration as legacy', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-theme-compatibility-native-'))
    temporaryDirectories.add(root)
    const profile = join(root, 'web')
    const packageDir = join(profile, 'node_modules', 'current-skin')
    mkdirSync(join(packageDir, 'lib'), { recursive: true })
    writeFileSync(join(profile, 'package.json'), JSON.stringify({ dependencies: { 'current-skin': '1.0.0' } }))
    writeFileSync(join(packageDir, 'package.json'), JSON.stringify({
      name: 'current-skin', version: '1.0.0',
      exports: { './client': './lib/client.js' }, dsh: { client: { platform: 'web' } },
    }))
    writeFileSync(join(packageDir, 'lib', 'client.js'), 'ctx.slots.register({ name: "settings.plugin.item", key: "current" }, CurrentCard)')
    assert.deepEqual(detectThemeCompatibility(profile, 'current-skin'), { status: 'native' })
  })

  it('leaves a dynamically assembled settings registration unverified', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-theme-compatibility-unknown-'))
    temporaryDirectories.add(root)
    const profile = join(root, 'web')
    const packageDir = join(profile, 'node_modules', 'dynamic-skin')
    mkdirSync(join(packageDir, 'lib'), { recursive: true })
    mkdirSync(join(profile, '.dsh-appearance-manager'), { recursive: true })
    writeFileSync(join(profile, 'package.json'), JSON.stringify({ dependencies: { 'dynamic-skin': '1.0.0' } }))
    writeFileSync(join(packageDir, 'package.json'), JSON.stringify({
      name: 'dynamic-skin', version: '1.0.0',
      exports: { './client': './lib/client.js' }, dsh: { client: { platform: 'web' } },
    }))
    writeFileSync(join(packageDir, 'lib', 'client.js'), 'const options = { name: "settings.plugin.item" }; ctx.slots.register(options, Card)')
    assert.deepEqual(detectThemeCompatibility(profile, 'dynamic-skin'), {
      status: 'unverified', code: 'settings-slot-registration-unreadable',
    })
  })

  it('runs compatibility detection when an installed legacy theme is activated', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-theme-activation-compatibility-'))
    temporaryDirectories.add(root)
    const profile = join(root, 'web')
    const packageDir = join(profile, 'node_modules', 'legacy-skin')
    mkdirSync(join(packageDir, 'lib'), { recursive: true })
    mkdirSync(join(profile, '.dsh-appearance-manager'), { recursive: true })
    writeFileSync(join(profile, 'package.json'), JSON.stringify({ dependencies: { 'legacy-skin': '1.0.0' } }))
    writeFileSync(join(packageDir, 'package.json'), JSON.stringify({
      name: 'legacy-skin', version: '1.0.0',
      exports: { './client': './lib/client.js' }, dsh: { client: { platform: 'web' } },
    }))
    writeFileSync(join(packageDir, 'lib', 'client.js'), 'ctx.slots.register({ name: "settings.plugin.item", id: "legacy" }, Card)')
    writeFileSync(join(profile, 'cordis.patch.yml'), '[]\n')
    const routes = []
    const dispose = mountAppearanceManager({
      webServer: { register(route) { routes.push(route); return () => undefined } },
      loader: { entries: () => [{ options: { id: 'include', name: 'cordis:include', config: { path: join(profile, 'cordis.patch.yml') } } }] },
      runPlugin: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
    })
    const activate = routes.find(route => route.path === '/dsh-appearance-manager/activate')
    const operations = routes.find(route => route.kind === 'prefix')
    const started = await invokeRoute(activate, { method: 'POST', body: {
      skin: { id: 'legacy.skin', packageName: 'legacy-skin', rowId: 'legacy-row', install: { target: 'github:demo/legacy', version: '1.0.0' } },
    } })
    let operation
    for (let attempt = 0; attempt < 20; attempt += 1) {
      operation = await invokeRoute(operations, { path: `/dsh-appearance-manager/operations/${started.body.operationId}` })
      if (operation.body?.phase === 'done') break
      await new Promise(resolve => setImmediate(resolve))
    }
    assert.equal(operation.body.phase, 'done')
    assert.deepEqual(operation.body.compatibility, { status: 'adapted', code: 'legacy-keyed-settings-item' })
    const state = await invokeRoute(routes.find(route => route.path === '/dsh-appearance-manager/state'))
    assert.deepEqual(state.body.skins[0].compatibility, { status: 'adapted', code: 'legacy-keyed-settings-item' })
    dispose()
  })

  it('rejects an unverified dynamic settings registration before activation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-theme-activation-compatibility-unknown-'))
    temporaryDirectories.add(root)
    const profile = join(root, 'web')
    const packageDir = join(profile, 'node_modules', 'dynamic-skin')
    mkdirSync(join(packageDir, 'lib'), { recursive: true })
    mkdirSync(join(profile, '.dsh-appearance-manager'), { recursive: true })
    writeFileSync(join(profile, 'package.json'), JSON.stringify({ dependencies: { 'dynamic-skin': '1.0.0' } }))
    writeFileSync(join(packageDir, 'package.json'), JSON.stringify({
      name: 'dynamic-skin', version: '1.0.0',
      exports: { './client': './lib/client.js' }, dsh: { client: { platform: 'web' } },
    }))
    writeFileSync(join(packageDir, 'lib', 'client.js'), 'const options = { name: "settings.plugin.item" }; ctx.slots.register(options, Card)')
    writeFileSync(join(profile, 'cordis.patch.yml'), '[]\n')
    const routes = []
    const dispose = mountAppearanceManager({
      webServer: { register(route) { routes.push(route); return () => undefined } },
      loader: { entries: () => [{ options: { id: 'include', name: 'cordis:include', config: { path: join(profile, 'cordis.patch.yml') } } }] },
      runPlugin: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
    })
    const activate = routes.find(route => route.path === '/dsh-appearance-manager/activate')
    const operations = routes.find(route => route.kind === 'prefix')
    const started = await invokeRoute(activate, { method: 'POST', body: {
      skin: { id: 'dynamic.skin', packageName: 'dynamic-skin', rowId: 'dynamic-row', install: { target: 'github:demo/dynamic', version: '1.0.0' } },
    } })
    let operation
    for (let attempt = 0; attempt < 20; attempt += 1) {
      operation = await invokeRoute(operations, { path: `/dsh-appearance-manager/operations/${started.body.operationId}` })
      if (operation.body?.phase === 'failed') break
      await new Promise(resolve => setImmediate(resolve))
    }
    assert.equal(operation.body.phase, 'failed')
    assert.match(operation.body.message, /could not be verified safely/)
    const state = await invokeRoute(routes.find(route => route.path === '/dsh-appearance-manager/state'))
    assert.deepEqual(state.body.skins, [])
    assert.equal(readFileSync(join(profile, 'cordis.patch.yml'), 'utf8'), '[]\n')
    dispose()
  })

  it('does not run compatibility detection while updating an inactive theme', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-theme-update-compatibility-inactive-'))
    temporaryDirectories.add(root)
    const profile = join(root, 'web')
    const packageDir = join(profile, 'node_modules', 'inactive-skin')
    mkdirSync(join(packageDir, 'lib'), { recursive: true })
    mkdirSync(join(profile, '.dsh-appearance-manager'), { recursive: true })
    writeFileSync(join(profile, 'package.json'), JSON.stringify({ dependencies: { 'inactive-skin': '1.0.0' } }))
    writeFileSync(join(profile, '.dsh-appearance-manager', 'state.json'), JSON.stringify({
      version: 1,
      skins: { 'inactive.skin': { active: false, packageName: 'inactive-skin', compatibility: { status: 'native' } } },
    }))
    writeFileSync(join(packageDir, 'package.json'), JSON.stringify({
      name: 'inactive-skin', version: '1.0.0',
      exports: { './client': './lib/client.js' }, dsh: { client: { platform: 'web' } },
    }))
    writeFileSync(join(packageDir, 'lib', 'client.js'), 'export const apply = () => undefined')
    writeFileSync(join(profile, 'cordis.patch.yml'), '[]\n')
    const routes = []
    const dispose = mountAppearanceManager({
      webServer: { register(route) { routes.push(route); return () => undefined } },
      loader: { entries: () => [{ options: { id: 'include', name: 'cordis:include', config: { path: join(profile, 'cordis.patch.yml') } } }] },
      runPlugin: async () => {
        writeFileSync(join(packageDir, 'package.json'), JSON.stringify({
          name: 'inactive-skin', version: '2.0.0',
          exports: { './client': './lib/client.js' }, dsh: { client: { platform: 'web' } },
        }))
        writeFileSync(join(packageDir, 'lib', 'client.js'), 'const options = { name: "settings.plugin.item" }; ctx.slots.register(options, Card)')
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    })
    const update = routes.find(route => route.path === '/dsh-appearance-manager/update')
    const operations = routes.find(route => route.kind === 'prefix')
    const started = await invokeRoute(update, { method: 'POST', body: {
      skin: { id: 'inactive.skin', packageName: 'inactive-skin', rowId: 'inactive-row', install: { target: 'github:demo/inactive', version: '2.0.0' } },
    } })
    let operation
    for (let attempt = 0; attempt < 20; attempt += 1) {
      operation = await invokeRoute(operations, { path: `/dsh-appearance-manager/operations/${started.body.operationId}` })
      if (operation.body?.phase === 'done') break
      await new Promise(resolve => setImmediate(resolve))
    }
    assert.equal(operation.body.phase, 'done')
    assert.equal(Object.hasOwn(operation.body, 'compatibility'), false)
    const state = await invokeRoute(routes.find(route => route.path === '/dsh-appearance-manager/state'))
    assert.equal(Object.hasOwn(state.body.skins[0], 'compatibility'), false)
    dispose()
  })

  it('rolls back an active theme update when the new bundle is unverified', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-theme-update-rollback-'))
    temporaryDirectories.add(root)
    const profile = join(root, 'web')
    const packageDir = join(profile, 'node_modules', 'active-skin')
    mkdirSync(join(packageDir, 'lib'), { recursive: true })
    mkdirSync(join(profile, '.dsh-appearance-manager'), { recursive: true })
    const oldManifest = {
      name: 'active-skin', version: '1.0.0',
      exports: { './client': './lib/client.js' }, dsh: { client: { platform: 'web' } },
    }
    const oldPackageJson = JSON.stringify({ dependencies: { 'active-skin': 'github:demo/active#old' } })
    const oldLockfile = 'lockfileVersion: 9\npackages:\n  active-skin: old\n'
    const oldState = JSON.stringify({
      version: 1,
      skins: { 'active.skin': { active: true, packageName: 'active-skin', themeId: 'active.skin', version: '1.0.0', compatibility: { status: 'adapted', code: 'legacy-keyed-settings-item' } } },
    })
    writeFileSync(join(profile, 'package.json'), oldPackageJson)
    writeFileSync(join(profile, 'pnpm-lock.yaml'), oldLockfile)
    writeFileSync(join(profile, '.dsh-appearance-manager', 'state.json'), oldState)
    writeFileSync(join(profile, 'cordis.patch.yml'), '---\n- id: active-row\n  disabled: false\n')
    writeFileSync(join(packageDir, 'package.json'), JSON.stringify(oldManifest))
    writeFileSync(join(packageDir, 'lib', 'client.js'), 'ctx.slots.register({ name: "settings.plugin.item", id: "active" }, Card)')

    const routes = []
    const dispose = mountAppearanceManager({
      webServer: { register(route) { routes.push(route); return () => undefined } },
      loader: { entries: () => [{ options: { id: 'include', name: 'cordis:include', config: { path: join(profile, 'cordis.patch.yml') } } }] },
      runPlugin: async () => {
        writeFileSync(join(profile, 'package.json'), JSON.stringify({ dependencies: { 'active-skin': 'github:demo/active#new' } }))
        writeFileSync(join(profile, 'pnpm-lock.yaml'), 'lockfileVersion: 9\npackages:\n  active-skin: new\n')
        writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ ...oldManifest, version: '2.0.0' }))
        writeFileSync(join(packageDir, 'lib', 'client.js'), 'const options = { name: "settings.plugin.item" }; ctx.slots.register(options, Card)')
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    })
    const update = routes.find(route => route.path === '/dsh-appearance-manager/update')
    const operations = routes.find(route => route.kind === 'prefix')
    const started = await invokeRoute(update, { method: 'POST', body: {
      skin: { id: 'active.skin', packageName: 'active-skin', rowId: 'active-row', install: { target: 'github:demo/active#new', version: '2.0.0' } },
    } })
    let operation
    for (let attempt = 0; attempt < 20; attempt += 1) {
      operation = await invokeRoute(operations, { path: `/dsh-appearance-manager/operations/${started.body.operationId}` })
      if (operation.body?.phase === 'failed') break
      await new Promise(resolve => setImmediate(resolve))
    }
    assert.equal(operation.body.phase, 'failed')
    assert.match(operation.body.message, /could not be verified safely/)
    assert.equal(readFileSync(join(profile, 'package.json'), 'utf8'), oldPackageJson)
    assert.equal(readFileSync(join(profile, 'pnpm-lock.yaml'), 'utf8'), oldLockfile)
    assert.equal(readFileSync(join(packageDir, 'package.json'), 'utf8'), JSON.stringify(oldManifest))
    assert.equal(readFileSync(join(packageDir, 'lib', 'client.js'), 'utf8'), 'ctx.slots.register({ name: "settings.plugin.item", id: "active" }, Card)')
    assert.equal(readFileSync(join(profile, 'cordis.patch.yml'), 'utf8'), '---\n- id: active-row\n  disabled: false\n')
    assert.equal(readFileSync(join(profile, '.dsh-appearance-manager', 'state.json'), 'utf8'), oldState)
    dispose()
  })

  it('keeps downloader progress on the live theme operation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-appearance-manager-progress-'))
    temporaryDirectories.add(root)
    const profile = join(root, 'web')
    mkdirSync(join(profile, '.dsh-appearance-manager'), { recursive: true })
    writeFileSync(join(profile, 'package.json'), JSON.stringify({ dependencies: {} }))
    writeFileSync(join(profile, 'cordis.patch.yml'), '[]\n')
    const routes = []
    const dispose = mountAppearanceManager({
      webServer: { register(route) { routes.push(route); return () => undefined } },
      loader: { entries: () => [{ options: { id: 'include', name: 'cordis:include', config: { path: join(profile, 'cordis.patch.yml') } } }] },
      runPlugin: async (profileName, args, onProgress) => {
        assert.deepEqual([profileName, args], ['web', ['add', 'github:demo/skin#1234567890123456789012345678901234567890']])
        onProgress?.({ progress: 42, receivedBytes: 42, totalBytes: 100 })
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    })
    const installRoute = routes.find(route => route.path === '/dsh-appearance-manager/install')
    const started = await invokeRoute(installRoute, { method: 'POST', body: {
      skin: {
        id: 'demo.skin', packageName: 'demo-skin', rowId: 'demo-skin',
        install: { target: 'github:demo/skin#1234567890123456789012345678901234567890', version: '1.0.0' },
      },
    } })
    const operations = routes.find(route => route.kind === 'prefix')
    let operation
    for (let attempt = 0; attempt < 20; attempt += 1) {
      operation = await invokeRoute(operations, { path: `/dsh-appearance-manager/operations/${started.body.operationId}` })
      if (operation.body?.phase === 'done') break
      await new Promise(resolve => setImmediate(resolve))
    }
    assert.equal(operation.body.phase, 'done')
    assert.equal(operation.body.progress, 100)
    dispose()
  })

  it('only disables appearance entries in the same activation group', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-appearance-mutual-exclusion-'))
    temporaryDirectories.add(root)
    const profile = join(root, 'web')
    const localPackage = join(profile, 'node_modules', 'local-theme')
    const catalogPackage = join(profile, 'node_modules', 'catalog-theme')
    const alternatePackage = join(profile, 'node_modules', 'alternate-theme')
    const featurePackage = join(profile, 'node_modules', 'dsh-file-upload')
    const fontsPackage = join(profile, 'node_modules', 'dsh-fonts')
    mkdirSync(localPackage, { recursive: true })
    mkdirSync(catalogPackage, { recursive: true })
    mkdirSync(alternatePackage, { recursive: true })
    mkdirSync(featurePackage, { recursive: true })
    mkdirSync(fontsPackage, { recursive: true })
    mkdirSync(join(profile, '.dsh-appearance-manager'), { recursive: true })
    writeFileSync(join(profile, 'package.json'), JSON.stringify({
      dependencies: { 'local-theme': 'github:demo/local-theme', 'catalog-theme': 'github:demo/catalog-theme', 'alternate-theme': 'github:demo/alternate-theme', 'dsh-file-upload': '1.0.0', 'dsh-fonts': '1.0.0' },
      dsh: { profile: { bundles: ['local-theme', 'catalog-theme', 'alternate-theme', 'dsh-file-upload', 'dsh-fonts'] } },
    }))
    writeFileSync(join(profile, '.dsh-appearance-manager', 'state.json'), JSON.stringify({
      version: 1,
      skins: { 'local:local-theme': { active: true, packageName: 'local-theme', version: '1.0.0', activationGroup: 'base-theme' } },
    }))
    writeFileSync(join(profile, 'cordis.patch.yml'), '[]\n')
    writeFileSync(join(localPackage, 'package.json'), JSON.stringify({
      name: 'local-theme', exports: { './client': './lib/client.js' }, dsh: { client: {}, bundle: { patch: './cordis.patch.yml' } },
    }))
    mkdirSync(join(localPackage, 'lib'), { recursive: true })
    writeFileSync(join(localPackage, 'lib', 'client.js'), 'export const apply = () => undefined')
    writeFileSync(join(localPackage, 'cordis.patch.yml'), '- insert:\n    - id: local-theme\n      name: local-theme\n')
    mkdirSync(join(catalogPackage, 'lib'), { recursive: true })
    writeFileSync(join(catalogPackage, 'package.json'), JSON.stringify({
      name: 'catalog-theme', exports: { './client': './lib/client.js' }, dsh: { client: {}, bundle: { patch: './cordis.patch.yml' } },
    }))
    writeFileSync(join(catalogPackage, 'lib', 'client.js'), 'export const apply = () => undefined')
    writeFileSync(join(catalogPackage, 'cordis.patch.yml'), '- insert:\n    - id: catalog-theme\n      name: catalog-theme\n')
    writeFileSync(join(alternatePackage, 'package.json'), JSON.stringify({
      name: 'alternate-theme', dsh: { client: {}, bundle: { patch: './cordis.patch.yml' } },
    }))
    writeFileSync(join(alternatePackage, 'cordis.patch.yml'), '- insert:\n    - id: alternate-theme\n      name: alternate-theme\n')
    writeFileSync(join(featurePackage, 'package.json'), JSON.stringify({
      name: 'dsh-file-upload', dsh: { client: {}, bundle: { patch: './cordis.patch.yml' } },
    }))
    writeFileSync(join(featurePackage, 'cordis.patch.yml'), '- insert:\n    - id: dsh-file-upload\n      name: dsh-file-upload\n')
    writeFileSync(join(fontsPackage, 'package.json'), JSON.stringify({
      name: 'dsh-fonts', dsh: { client: {}, bundle: { patch: './cordis.patch.yml' } },
    }))
    writeFileSync(join(fontsPackage, 'cordis.patch.yml'), '- insert:\n    - id: dsh-fonts\n      name: dsh-fonts\n')
    const updates = []
    const fixture = loaderFixture([
      { options: { id: 'local-theme', name: 'local-theme' }, update: async patch => { updates.push(['local-theme', patch]); } },
      { options: { id: 'catalog-theme', name: 'catalog-theme' } },
      { options: { id: 'alternate-theme', name: 'alternate-theme' } },
      { options: { id: 'dsh-file-upload', name: 'dsh-file-upload' }, update: async patch => { updates.push(['dsh-file-upload', patch]); } },
      { options: { id: 'dsh-fonts', name: 'dsh-fonts' }, update: async patch => { updates.push(['dsh-fonts', patch]); } },
    ])
    fixture.include.options.config.path = join(profile, 'cordis.patch.yml')
    const routes = []
    const dispose = mountAppearanceManager({
      webServer: { register(route) { routes.push(route); return () => undefined } },
      loader: fixture.loader,
    })
    const activate = routes.find(route => route.path === '/dsh-appearance-manager/activate')
    const started = await invokeRoute(activate, { method: 'POST', body: {
      skin: { id: 'catalog.skin', packageName: 'catalog-theme', rowId: 'catalog-theme', activationGroup: 'base-theme' },
      catalog: [
        { id: 'catalog.skin', packageName: 'catalog-theme', rowId: 'catalog-theme', activationGroup: 'base-theme' },
        { id: 'alternate.skin', packageName: 'alternate-theme', rowId: 'alternate-theme', activationGroup: 'base-theme' },
        { id: 'fonts', packageName: 'dsh-fonts', rowId: 'dsh-fonts' },
      ],
    } })
    assert.equal(started.status, 202)
    for (let attempt = 0; attempt < 20 && updates.length === 0; attempt += 1) await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(updates, [['local-theme', { disabled: true }]])
    const disabledPatch = readFileSync(join(profile, 'cordis.patch.yml'), 'utf8')
    assert.match(disabledPatch, /id: local-theme[\s\S]*disabled: true/)
    assert.match(disabledPatch, /id: alternate-theme[\s\S]*disabled: true/)
    assert.doesNotMatch(disabledPatch, /id: dsh-file-upload/)
    assert.doesNotMatch(disabledPatch, /id: dsh-fonts/)

    const operations = routes.find(route => route.kind === 'prefix')
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const result = await invokeRoute(operations, { path: `/dsh-appearance-manager/operations/${started.body.operationId}` })
      if (result.body?.phase === 'done') break
      await new Promise(resolve => setImmediate(resolve))
    }
    const restored = await invokeRoute(activate, { method: 'POST', body: {
      skin: { id: 'local:local-theme', packageName: 'local-theme', rowId: 'local-theme', activationGroup: 'base-theme' },
      catalog: [
        { id: 'catalog.skin', packageName: 'catalog-theme', rowId: 'catalog-theme', activationGroup: 'base-theme' },
        { id: 'alternate.skin', packageName: 'alternate-theme', rowId: 'alternate-theme', activationGroup: 'base-theme' },
        { id: 'fonts', packageName: 'dsh-fonts', rowId: 'dsh-fonts' },
      ],
    } })
    assert.equal(restored.status, 202)
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const result = await invokeRoute(operations, { path: `/dsh-appearance-manager/operations/${restored.body.operationId}` })
      if (result.body?.phase === 'done') break
      await new Promise(resolve => setImmediate(resolve))
    }
    const restoredPatch = readFileSync(join(profile, 'cordis.patch.yml'), 'utf8')
    assert.doesNotMatch(restoredPatch, /id: local-theme/)
    assert.match(restoredPatch, /id: catalog-theme[\s\S]*disabled: true/)
    assert.match(restoredPatch, /id: alternate-theme[\s\S]*disabled: true/)
    assert.doesNotMatch(restoredPatch, /id: dsh-fonts/)
    dispose()
  })

  it('disables the live Loader entry before uninstalling a theme', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-appearance-manager-uninstall-'))
    temporaryDirectories.add(root)
    const profile = join(root, 'web')
    const packageDir = join(profile, 'node_modules', 'demo-theme')
    mkdirSync(packageDir, { recursive: true })
    mkdirSync(join(profile, '.dsh-appearance-manager'), { recursive: true })
    writeFileSync(join(profile, 'package.json'), JSON.stringify({
      dependencies: { 'demo-theme': 'github:demo/theme' },
    }))
    writeFileSync(join(profile, '.dsh-appearance-manager', 'state.json'), JSON.stringify({
      version: 1,
      skins: { 'demo.skin': { active: true, packageName: 'demo-theme', themeId: 'demo.skin', version: '1.0.0' } },
    }))
    writeFileSync(join(profile, 'cordis.patch.yml'), '- insert:\n    - id: demo-theme-row\n      name: demo-theme\n')
    writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ name: 'demo-theme', version: '1.0.0', dsh: { client: {} } }))
    const updates = []
    const calls = []
    const fixture = loaderFixture([{ options: { id: 'demo-theme-row', name: 'demo-theme' }, update: async patch => { calls.push('disable'); updates.push(patch) } }])
    fixture.include.options.config.path = join(profile, 'cordis.patch.yml')
    const routes = []
    const dispose = mountAppearanceManager({
      webServer: { register(route) { routes.push(route); return () => undefined } },
      loader: fixture.loader,
      runPlugin: async () => { calls.push('remove'); return { exitCode: 0, stdout: '', stderr: '' } },
    })
    const uninstall = routes.find(route => route.path === '/dsh-appearance-manager/uninstall')
    const started = await invokeRoute(uninstall, { method: 'POST', body: {
      skin: { id: 'demo.skin', packageName: 'demo-theme', rowId: 'demo-theme-row' },
    } })
    assert.equal(started.status, 202)
    const operations = routes.find(route => route.kind === 'prefix')
    let operation
    for (let attempt = 0; attempt < 20; attempt += 1) {
      operation = await invokeRoute(operations, { path: `/dsh-appearance-manager/operations/${started.body.operationId}` })
      if (operation.body?.phase === 'done') break
      await new Promise(resolve => setImmediate(resolve))
    }
    assert.equal(operation.body.phase, 'done')
    assert.deepEqual(updates, [{ disabled: true }])
    assert.deepEqual(calls, ['disable', 'remove'])
    assert.doesNotMatch(readFileSync(join(profile, 'cordis.patch.yml'), 'utf8'), /demo-theme-row/)
    dispose()
  })

  it('waits for the initial policy exchange before plugin startup settles', async () => {
    let release
    const { port } = await listen((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      release = () => response.end('{"ok":true,"skillPolicy":{"defaultEnabled":false,"states":{}}}')
    })
    const disposers = []
    const ctx = {
      loader: { entries: () => [] },
      effect: create => { disposers.push(create()) },
      on: () => undefined,
    }
    let settled = false
    const startup = applyPlugin(ctx, config(port)).then(() => { settled = true })
    for (let attempt = 0; release === undefined && attempt < 20; attempt += 1) {
      await new Promise(resolve => setImmediate(resolve))
    }
    assert.equal(settled, false)
    assert.equal(typeof release, 'function')

    release()
    await startup
    assert.equal(settled, true)
    await Promise.all(disposers.map(dispose => dispose()))
  })

  it('publishes the complete non-group Loader order', () => {
    const rows = Array.from({ length: 160 }, (_, index) => ({
      id: `include:entry-${index}`,
      disabled: index % 2 === 0,
      options: { id: `entry-${index}`, name: `@deepseek-ai/plugin-${index}` },
    }))
    const { loader } = loaderFixture(rows)
    const configOwners = new Map(rows.map(row => [row.options.id, 'aggregate-bundle']))
    assert.equal(loaderInventory(loader, configOwners).entries.length, 161)
    assert.deepEqual(loaderInventory(loader, configOwners).entries[160], {
      entryId: 'include:entry-159',
      configId: 'entry-159',
      moduleName: '@deepseek-ai/plugin-159',
      ownerPackage: 'aggregate-bundle',
      componentKey: 'include:entry-159',
      baselineEnabled: true,
      enabled: true,
      fiberPhase: 'active',
    })
  })

  it('loads top-level bundle ownership from the profile patch that inserted each entry', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-desk-bundle-owner-'))
    temporaryDirectories.add(root)
    const bundleRoot = join(root, 'node_modules', 'aggregate-bundle')
    const overlayRoot = join(root, 'node_modules', 'overlay-bundle')
    mkdirSync(bundleRoot, { recursive: true })
    mkdirSync(overlayRoot, { recursive: true })
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      dsh: { profile: { bundles: ['aggregate-bundle', 'overlay-bundle'] } },
    }))
    writeFileSync(join(root, 'cordis.yml'), '[]\n')
    writeFileSync(join(bundleRoot, 'package.json'), JSON.stringify({
      name: 'aggregate-bundle',
      main: 'index.js',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }))
    writeFileSync(join(bundleRoot, 'index.js'), 'export default {}\n')
    writeFileSync(join(bundleRoot, 'cordis.patch.yml'), [
      '- insert:',
      '    - id: aggregate',
      '      name: aggregate-plugin',
      '    - id: helper',
      '      name: helper-plugin',
      '    - id: grouped',
      '      name: cordis:group',
      '      group: true',
      '      config:',
      '        - id: old-child',
      '          name: old-child-plugin',
      '- id: aggregate',
      '  config:',
      '    enabled: !!js process.env.DEMO',
      '',
    ].join('\n'))
    writeFileSync(join(overlayRoot, 'package.json'), JSON.stringify({
      name: 'overlay-bundle',
      main: 'index.js',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }))
    writeFileSync(join(overlayRoot, 'index.js'), 'export default {}\n')
    writeFileSync(join(overlayRoot, 'cordis.patch.yml'), [
      '- id: grouped',
      '  config:',
      '    - id: replacement-child',
      '      name: replacement-child-plugin',
      '',
    ].join('\n'))
    const fixture = loaderFixture([])
    fixture.include.options.config.path = pathToFileURL(join(root, 'cordis.yml')).href

    assert.deepEqual([...bundleConfigOwners(fixture.loader)], [
      ['aggregate', 'aggregate-bundle'],
      ['helper', 'aggregate-bundle'],
      ['grouped', 'aggregate-bundle'],
      ['replacement-child', 'overlay-bundle'],
    ])
  })

  it('projects dynamically-created children to their top-level aggregate bundle', () => {
    const nestedTree = {}
    const { loader } = loaderFixture([
      { id: 'include:aggregate', options: { id: 'aggregate', name: 'aggregate-plugin' } },
      { id: 'include:aggregate:child-a', options: { id: 'child-a', name: 'child-a' }, parent: { tree: nestedTree } },
      { id: 'include:aggregate:child-b', options: { id: 'child-b', name: 'child-b' }, parent: { tree: nestedTree } },
    ])
    assert.deepEqual([...runtimeEntryOwners(loader, new Map([['aggregate', 'aggregate-bundle']]))], [
      ['include:aggregate', 'aggregate-bundle'],
      ['include:aggregate:child-a', 'aggregate-bundle'],
      ['include:aggregate:child-b', 'aggregate-bundle'],
    ])
  })

  it('switches every top-level entry in a bundle and restores configured disabled values', async () => {
    const updates = []
    const configuredDisabled = { __jsExpr: 'process.platform === "win32"' }
    const rows = [
      { id: 'include:base', options: { id: 'base', name: '@deepseek-ai/core' } },
      { id: 'include:first', options: { id: 'first', name: 'first-plugin' } },
      { id: 'include:second', options: { id: 'second', name: 'second-plugin', disabled: configuredDisabled } },
      { id: 'include:other', options: { id: 'other', name: 'other-plugin' } },
    ]
    const { loader } = loaderFixture(rows)
    for (const entry of loader.entries()) {
      entry.update = async patch => {
        updates.push([entry.options.id, patch])
        if (patch.disabled === null) delete entry.options.disabled
        else entry.options.disabled = patch.disabled
      }
    }
    const controller = createPluginPackageController(loader, new Map([
      ['base', '@deepseek-ai/dsh-base'],
      ['first', 'aggregate-bundle'],
      ['second', 'aggregate-bundle'],
      ['other', 'other-bundle'],
    ]))

    await controller.apply({ '@deepseek-ai/dsh-base': false, 'aggregate-bundle': false })
    assert.deepEqual(updates, [
      ['first', { disabled: true }],
      ['second', { disabled: true }],
    ])
    assert.equal(rows[3].options.disabled, undefined)

    updates.length = 0
    await controller.apply({ 'aggregate-bundle': true })
    assert.deepEqual(updates, [
      ['first', { disabled: null }],
      ['second', { disabled: configuredDisabled }],
    ])
  })

  it('mutates an owned aggregate root once and lets its internal subtree inherit the switch', async () => {
    const updates = []
    const nestedTree = {}
    const { loader } = loaderFixture([
      { id: 'include:aggregate', options: { id: 'aggregate', name: 'aggregate-plugin' } },
      { id: 'include:aggregate:child', options: { id: 'child', name: 'child-plugin' }, parent: { tree: nestedTree } },
    ])
    for (const entry of loader.entries()) {
      entry.update = async patch => { updates.push(entry.options.id); entry.options.disabled = patch.disabled }
    }
    const controller = createPluginPackageController(loader, new Map([['aggregate', 'aggregate-bundle']]))
    await controller.apply({ 'aggregate-bundle': false })
    assert.deepEqual(updates, ['aggregate'])
    const inventory = controller.inventory().entries
    assert.equal(inventory.find(entry => entry.entryId === 'include:aggregate')?.componentKey, 'include:aggregate')
    assert.equal(inventory.find(entry => entry.entryId === 'include:aggregate:child')?.componentKey, undefined)
  })

  it('applies a component override and restores its configured expression on default', async () => {
    const configuredDisabled = { __jsExpr: 'process.platform === "win32"' }
    const { loader } = loaderFixture([
      { id: 'include:entry', disabled: true, options: { id: 'entry', name: 'entry-plugin', disabled: configuredDisabled } },
    ])
    const entry = [...loader.entries()][1]
    entry.evaluate = () => true
    entry.update = async patch => {
      if (patch.disabled === null) delete entry.options.disabled
      else entry.options.disabled = patch.disabled
      entry.disabled = Boolean(patch.disabled)
    }
    const controller = createPluginPackageController(loader, new Map([['entry', 'aggregate-bundle']]))

    await controller.apply({ 'aggregate-bundle': true }, { 'aggregate-bundle': { 'include:entry': true } })
    assert.equal(entry.options.disabled, false)
    assert.deepEqual(controller.inventory().entries[1], {
      entryId: 'include:entry',
      configId: 'entry',
      moduleName: 'entry-plugin',
      ownerPackage: 'aggregate-bundle',
      componentKey: 'include:entry',
      baselineEnabled: false,
      enabled: true,
      fiberPhase: 'active',
    })

    await controller.apply({ 'aggregate-bundle': true }, {})
    assert.deepEqual(entry.options.disabled, configuredDisabled)
  })

  it('applies one component override across different Web and Headless bundle owners', async () => {
    const { loader } = loaderFixture([
      { id: 'include:code-runtime', options: { id: 'code-runtime', name: '@deepseek-ai/dsh-code-runtime-worker-thread' } },
    ])
    const entry = [...loader.entries()][1]
    entry.update = async patch => {
      if (patch.disabled === null) delete entry.options.disabled
      else entry.options.disabled = patch.disabled
      entry.disabled = Boolean(patch.disabled)
    }
    const controller = createPluginPackageController(loader, new Map([
      ['code-runtime', '@deepseek-ai/dsh-headless'],
    ]))

    await controller.apply({}, {
      '@deepseek-ai/dsh-web-app': { 'include:code-runtime': false },
    })

    assert.equal(entry.options.disabled, true)
  })

  it('keeps component intent while a package-level disable takes precedence', async () => {
    const { loader } = loaderFixture([
      { id: 'include:entry', options: { id: 'entry', name: 'entry-plugin' } },
    ])
    const entry = [...loader.entries()][1]
    entry.update = async patch => {
      if (patch.disabled === null) delete entry.options.disabled
      else entry.options.disabled = patch.disabled
      entry.disabled = Boolean(patch.disabled)
    }
    const controller = createPluginPackageController(loader, new Map([['entry', 'aggregate-bundle']]))
    const components = { 'aggregate-bundle': { 'include:entry': true } }

    await controller.apply({ 'aggregate-bundle': false }, components)
    assert.equal(entry.options.disabled, true)
    await controller.apply({ 'aggregate-bundle': true }, components)
    assert.equal(entry.options.disabled, false)
    await controller.apply({ 'aggregate-bundle': true }, {})
    assert.equal(entry.options.disabled, undefined)
  })

  it('keeps the Desk bridge locked while allowing components inside a required DSH bundle', async () => {
    const updates = []
    const { loader } = loaderFixture([
      { id: 'include:timer', options: { id: 'timer', name: 'timer-plugin' } },
      { id: 'include:dsh-desk', options: { id: 'dsh-desk', name: 'dsh-desk-plugin' } },
    ])
    for (const entry of loader.entries()) {
      entry.update = async patch => {
        updates.push(entry.options.id)
        entry.options.disabled = patch.disabled
      }
    }
    const controller = createPluginPackageController(loader, new Map([
      ['timer', '@deepseek-ai/dsh-base'],
      ['dsh-desk', 'dsh-desk-plugin'],
    ]))

    await controller.apply({}, {
      '@deepseek-ai/dsh-base': { 'include:timer': false },
      'dsh-desk-plugin': { 'include:dsh-desk': false },
    })
    assert.deepEqual(updates, ['timer'])
  })

  it('rolls back a bundle switch when one owned entry cannot update', async () => {
    const { loader } = loaderFixture([
      { id: 'include:first', options: { id: 'first', name: 'first-plugin' } },
      { id: 'include:second', options: { id: 'second', name: 'second-plugin' } },
    ])
    const entries = [...loader.entries()].slice(1)
    entries[0].update = async patch => {
      if (patch.disabled === null) delete entries[0].options.disabled
      else entries[0].options.disabled = patch.disabled
    }
    entries[1].update = async () => { throw new Error('update failed') }
    const controller = createPluginPackageController(loader, new Map([
      ['first', 'aggregate-bundle'],
      ['second', 'aggregate-bundle'],
    ]))

    await assert.rejects(controller.apply({ 'aggregate-bundle': false }), /update failed/)
    assert.equal(entries[0].options.disabled, undefined)
    assert.equal(entries[1].options.disabled, undefined)
  })

  it('restores a new configured disabled value written while a bundle is temporarily off', async () => {
    const { loader } = loaderFixture([
      { id: 'include:entry', options: { id: 'entry', name: 'entry-plugin' } },
    ])
    const entry = [...loader.entries()][1]
    entry.update = async patch => {
      if (patch.disabled === null) delete entry.options.disabled
      else entry.options.disabled = patch.disabled
    }
    const controller = createPluginPackageController(loader, new Map([['entry', 'aggregate-bundle']]))
    await controller.apply({ 'aggregate-bundle': false })

    const configuredDisabled = { __jsExpr: 'process.env.DISABLE_ENTRY' }
    const previousOptions = { ...entry.options }
    entry.options.disabled = configuredDisabled
    controller.observe(entry, previousOptions)
    await controller.apply({ 'aggregate-bundle': false })
    assert.equal(entry.options.disabled, true)

    await controller.apply({ 'aggregate-bundle': true })
    assert.deepEqual(entry.options.disabled, configuredDisabled)
  })

  it('registers disabled Skill policy in the exact agent scope', async () => {
    let provider
    let invalidations = 0
    const original = {
      name: 'review',
      description: 'Project review Skill',
      invocation: { modelInvocable: true, userInvocable: true },
      source: 'project-dsh',
      provider: 'skill-filesystem',
    }
    const skills = {
      snapshot: async () => ({ skills: [original], complete: true }),
      registerProvider: create => {
        provider = create({ signal: new AbortController().signal, invalidate: () => { invalidations += 1 } })
        return () => undefined
      },
    }
    const agent = { session: { header: { cwd: 'C:\\workspace' } } }

    const policy = await createAgentSkillPolicy(skills, agent, {
      defaultEnabled: true,
      states: { review: false },
    })
    const candidates = await provider.list({})
    assert.deepEqual(candidates, [{
      ...original,
      invocation: { modelInvocable: false, userInvocable: false },
      provider: 'dsh-desk-policy',
      rank: -Number.MAX_SAFE_INTEGER,
      locator: 'review',
    }])
    assert.equal(policy.inventory()[0].enabled, false)

    policy.update({ defaultEnabled: true, states: { review: true } })
    assert.deepEqual(await provider.list({}), [])
    assert.equal(invalidations, 1)
  })

  it('blocks newly discovered Skills when the active scheme is default-deny', async () => {
    let provider
    let visible = [{
      name: 'known', description: 'Known', invocation: { modelInvocable: true, userInvocable: true },
      source: 'bundled', provider: 'bundle',
    }]
    const skills = {
      snapshot: async () => ({ skills: visible, complete: true }),
      registerProvider: create => {
        provider = create({ signal: new AbortController().signal, invalidate: () => undefined })
        return () => undefined
      },
    }
    const policy = await createAgentSkillPolicy(skills, { session: { header: {} } }, {
      defaultEnabled: false,
      states: { known: true },
    })
    assert.deepEqual(await provider.list({}), [])

    visible = [...visible, {
      name: 'late-skill', description: 'Late provider Skill', invocation: { modelInvocable: true, userInvocable: true },
      source: 'custom', provider: 'remote-provider',
    }]
    await policy.refresh()
    assert.deepEqual((await provider.list({})).map(candidate => candidate.name), ['late-skill'])
    assert.deepEqual(policy.inventory().map(skill => [skill.name, skill.source, skill.enabled]), [
      ['known', 'bundled', true],
      ['late-skill', 'custom', false],
    ])
  })
})
