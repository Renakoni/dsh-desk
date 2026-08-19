import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, stringify } from 'yaml'

const MAX_BODY_BYTES = 512 * 1024
const OPERATION_TTL_MS = 30 * 60 * 1000
const PROFILE_NAME = /^[A-Za-z0-9._-]+$/

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function profileDirectory(loader) {
  const include = [...loader.entries()].find(entry => entry.options?.id === 'include' && entry.options?.name === 'cordis:include')
  const value = include?.options?.config?.path
  if (typeof value !== 'string' || value === '') return null
  try { return dirname(value.startsWith('file:') ? fileURLToPath(value) : resolve(value)) } catch { return null }
}

function jsonFile(file, fallback) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return fallback }
}

function atomicJson(file, value) {
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`)
  renameSync(temporary, file)
}

function profileManifest(profileDir) { return jsonFile(join(profileDir, 'package.json'), {}) }
function dependencies(profileDir) { return objectValue(profileManifest(profileDir).dependencies) ?? {} }
function packageDir(profileDir, packageName) { return join(profileDir, 'node_modules', ...packageName.split('/')) }
function packageManifest(profileDir, packageName) {
  const file = join(packageDir(profileDir, packageName), 'package.json')
  return existsSync(file) ? objectValue(jsonFile(file, null)) : null
}

function stateFile(profileDir) { return join(profileDir, '.dsh-appearance-manager', 'state.json') }
function readState(profileDir) {
  const value = objectValue(jsonFile(stateFile(profileDir), null))
  return value?.version === 1 && objectValue(value.skins) ? { version: 1, skins: value.skins } : { version: 1, skins: {} }
}
function writeState(profileDir, state) { atomicJson(stateFile(profileDir), state) }

function patchFile(profileDir) { return join(profileDir, 'cordis.patch.yml') }
function readPatch(profileDir) {
  try {
    const value = parse(readFileSync(patchFile(profileDir), 'utf8'))
    return Array.isArray(value) ? value : []
  } catch { return [] }
}
function writePatch(profileDir, operations) {
  mkdirSync(dirname(patchFile(profileDir)), { recursive: true })
  const file = patchFile(profileDir)
  const temporary = `${file}.${process.pid}.tmp`
  writeFileSync(temporary, stringify(operations, { lineWidth: 0 }))
  renameSync(temporary, file)
}

function matches(row, skin) {
  return row && typeof row === 'object' && (row.id === skin.rowId || row.name === skin.packageName)
}
function removeInserted(values, skin) {
  return values.flatMap(value => {
    const row = objectValue(value)
    if (!row) return [value]
    if (matches(row, skin)) return []
    if (Array.isArray(row.insert)) row.insert = removeInserted(row.insert, skin)
    return [row]
  })
}
function bundleDeclares(value, skin) {
  const row = objectValue(value)
  if (!row) return false
  if (matches(row, skin)) return true
  return Array.isArray(row.insert) && row.insert.some(item => bundleDeclares(item, skin))
}
function bundleOwnsRow(profileDir, skin) {
  const manifest = packageManifest(profileDir, skin.packageName)
  const patch = objectValue(objectValue(manifest?.dsh)?.bundle)?.patch
  if (typeof patch !== 'string') return false
  try {
    const value = parse(readFileSync(resolve(packageDir(profileDir, skin.packageName), patch), 'utf8'))
    return Array.isArray(value) && value.some(item => bundleDeclares(item, skin))
  } catch { return false }
}

function bundleRowIds(profileDir, packageName) {
  const manifest = packageManifest(profileDir, packageName)
  const patch = objectValue(objectValue(manifest?.dsh)?.bundle)?.patch
  if (typeof patch !== 'string') return new Set()
  try {
    const value = parse(readFileSync(resolve(packageDir(profileDir, packageName), patch), 'utf8'))
    const ids = new Set()
    const visit = node => {
      const row = objectValue(node)
      if (!row || !Array.isArray(row.insert)) return
      for (const child of row.insert) {
        const childRow = objectValue(child)
        if (childRow?.name === packageName && typeof childRow.id === 'string') ids.add(childRow.id)
        visit(child)
      }
    }
    if (Array.isArray(value)) for (const operation of value) visit(operation)
    return ids
  } catch { return new Set() }
}

function uncataloguedThemeEntries(profileDir, loader, catalog, selectedPackage) {
  const knownPackages = new Set(Array.isArray(catalog)
    ? catalog.flatMap(skin => typeof skin?.packageName === 'string' ? [skin.packageName] : [])
    : [])
  const entries = [...loader.entries()]
  return Object.keys(dependencies(profileDir)).flatMap(packageName => {
    if (packageName === selectedPackage || knownPackages.has(packageName) || packageName === 'dsh-desk-plugin' || packageName === 'dsh-skin-market' || packageName.startsWith('@deepseek-ai/')) return []
    const manifest = packageManifest(profileDir, packageName)
    if (objectValue(manifest?.dsh)?.client === undefined) return []
    const rowIds = bundleRowIds(profileDir, packageName)
    return entries.flatMap(entry => {
      const options = objectValue(entry.options)
      if (!options || typeof options.id !== 'string') return []
      if (options.name !== packageName && !rowIds.has(options.id)) return []
      return [{ packageName, rowId: options.id, entry }]
    })
  })
}

async function disableUncataloguedThemes(profileDir, loader, catalog, selectedPackage) {
  for (const theme of uncataloguedThemeEntries(profileDir, loader, catalog, selectedPackage)) {
    ensureRegistration(profileDir, theme, true)
    if (theme.entry.options?.disabled === true || typeof theme.entry.update !== 'function') continue
    await theme.entry.update({ disabled: true }, false, true)
  }
}

function updateProfileManifest(profileDir, packageName, enabled) {
  const manifest = profileManifest(profileDir)
  const dsh = objectValue(manifest.dsh) ?? {}
  const profile = objectValue(dsh.profile) ?? {}
  const bundles = Array.isArray(profile.bundles) ? profile.bundles.filter(value => typeof value === 'string' && value !== packageName) : []
  if (enabled) bundles.push(packageName)
  atomicJson(join(profileDir, 'package.json'), { ...manifest, dsh: { ...dsh, profile: { ...profile, bundles } } })
}

function ensureRegistration(profileDir, skin, disabled) {
  let operations = readPatch(profileDir)
  operations = operations.map(operation => {
    const next = objectValue(operation)
    if (Array.isArray(next?.insert)) next.insert = removeInserted(next.insert, skin)
    return next ?? operation
  }).filter(operation => operation?.id !== skin.rowId && (!Array.isArray(operation?.insert) || operation.insert.length > 0))
  if (bundleOwnsRow(profileDir, skin)) {
    if (disabled) operations.push({ id: skin.rowId, disabled: true })
    updateProfileManifest(profileDir, skin.packageName, true)
  } else {
    const operation = operations.find(item => Array.isArray(item?.insert)) ?? { insert: [] }
    if (!operations.includes(operation)) operations.push(operation)
    operation.insert.push({ id: skin.rowId, name: skin.packageName, ...(disabled ? { disabled: true } : {}) })
  }
  writePatch(profileDir, operations)
}

function removeRegistration(profileDir, skin) {
  let operations = readPatch(profileDir)
  operations = operations.map(operation => {
    const next = objectValue(operation)
    if (Array.isArray(next?.insert)) next.insert = removeInserted(next.insert, skin)
    return next ?? operation
  }).filter(operation => operation?.id !== skin.rowId && (!Array.isArray(operation?.insert) || operation.insert.length > 0))
  writePatch(profileDir, operations)
  const manifest = profileManifest(profileDir)
  const dsh = objectValue(manifest.dsh) ?? {}
  const profile = objectValue(dsh.profile) ?? {}
  if (Array.isArray(profile.bundles)) updateProfileManifest(profileDir, skin.packageName, false)
}

function invocation() {
  const entry = process.argv[1]
  if (entry && /[\\/](?:bin\.(?:js|ts)|dsh)$/.test(entry)) return { file: process.execPath, prefix: [...process.execArgv, resolve(entry)] }
  return { file: 'dsh', prefix: [] }
}
function runPlugin(profile, args) {
  return new Promise(resolvePromise => {
    const command = invocation()
    const child = spawn(command.file, [...command.prefix, 'plugin', '--profile', profile, ...args], { shell: false, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: 'true' } })
    let stdout = ''; let stderr = ''
    child.stdout?.on('data', chunk => { stdout += String(chunk) })
    child.stderr?.on('data', chunk => { stderr += String(chunk) })
    const timer = setTimeout(() => child.kill(), 10 * 60 * 1000)
    child.on('error', error => { stderr += error.message })
    child.on('close', exitCode => { clearTimeout(timer); resolvePromise({ exitCode, stdout, stderr }) })
  })
}

function commandError(result) { return (result.stderr || result.stdout || `plugin command exited ${String(result.exitCode)}`).trim().slice(-800) }

function skinState(profileDir, skin, stored) {
  const installed = Object.hasOwn(dependencies(profileDir), skin.packageName)
  const manifest = packageManifest(profileDir, skin.packageName)
  const valid = installed && typeof manifest?.version === 'string' && objectValue(manifest.dsh)?.client !== undefined
  return {
    skinId: skin.id,
    installation: !installed ? 'missing' : valid ? 'installed' : 'broken',
    activation: stored?.active === true ? 'active' : 'inactive',
    installedVersion: valid ? manifest.version : null,
    installedAt: null,
    updateAvailable: valid && manifest.version !== skin.install.version,
    ...(!valid && installed ? { error: 'Installed theme package is incomplete.' } : {})
  }
}

class AppearanceManager {
  constructor(profileDir, loader) {
    this.profileDir = profileDir
    this.profile = profileDir.split(/[\\/]/).pop() || 'web'
    this.loader = loader
    this.instanceId = randomUUID()
    this.operations = new Map()
    this.activeOperation = null
  }
  state(skins = []) {
    const stored = readState(this.profileDir)
    const values = skins.length > 0
      ? skins.map(skin => skinState(this.profileDir, skin, stored.skins[skin.id]))
      : Object.entries(stored.skins).map(([skinId, value]) => {
        const saved = objectValue(value) ?? {}
        const packageName = typeof saved.packageName === 'string' ? saved.packageName : ''
        const manifest = packageName ? packageManifest(this.profileDir, packageName) : null
        const installed = packageName !== '' && Object.hasOwn(dependencies(this.profileDir), packageName)
        return {
          skinId,
          installation: installed ? 'installed' : 'missing',
          activation: saved.active === true ? 'active' : 'inactive',
          installedVersion: typeof manifest?.version === 'string' ? manifest.version : null,
          installedAt: null,
          updateAvailable: false
        }
      })
    return { skins: values, operation: this.activeOperation ? this.operations.get(this.activeOperation) ?? null : null, instanceId: this.instanceId, restartAvailable: false, runningAgentCount: null }
  }
  begin(action, skin, catalog = []) {
    if (this.activeOperation) throw new Error('another theme operation is already running')
    if (!skin || typeof skin.id !== 'string' || typeof skin.packageName !== 'string' || typeof skin.rowId !== 'string') throw new Error('Invalid theme metadata.')
    if (!['install', 'activate', 'deactivate', 'update', 'uninstall'].includes(action)) throw new Error('Invalid theme operation.')
    const operation = { id: randomUUID(), kind: action, skinId: skin.id, phase: 'queued', startedAt: new Date().toISOString() }
    this.operations.set(operation.id, operation); this.activeOperation = operation.id
    void this.execute(operation, skin, catalog)
    return operation
  }
  async execute(operation, skin, catalog) {
    try {
      const stored = readState(this.profileDir)
      const legacyState = jsonFile(join(this.profileDir, '.dsh-skin-market', 'state.json'), {})
      const existing = stored.skins[skin.id] ?? { active: legacyState?.activeSkinId === skin.id }
      if (operation.kind === 'install' || operation.kind === 'update') {
        if (operation.kind === 'update' || !Object.hasOwn(dependencies(this.profileDir), skin.packageName)) {
          operation.phase = 'downloading'
          const result = await runPlugin(this.profile, ['add', skin.install.target])
          if (result.exitCode !== 0) throw new Error(commandError(result))
        }
        ensureRegistration(this.profileDir, skin, existing.active !== true)
        stored.skins[skin.id] = { active: existing.active === true, packageName: skin.packageName, version: skin.install.version }
      } else if (operation.kind === 'activate' || operation.kind === 'deactivate') {
        if (!Object.hasOwn(dependencies(this.profileDir), skin.packageName)) throw new Error('install the theme before using it')
        const active = operation.kind === 'activate'
        if (active && Array.isArray(catalog)) {
          for (const other of catalog) {
            if (!other || other.id === skin.id || typeof other.packageName !== 'string' || typeof other.rowId !== 'string') continue
            if (!Object.hasOwn(dependencies(this.profileDir), other.packageName)) continue
            ensureRegistration(this.profileDir, other, true)
            stored.skins[other.id] = { active: false, packageName: other.packageName, version: other.install?.version }
          }
          await disableUncataloguedThemes(this.profileDir, this.loader, catalog, skin.packageName)
        }
        ensureRegistration(this.profileDir, skin, !active)
        stored.skins[skin.id] = { active, packageName: skin.packageName, version: skin.install.version }
      } else {
        if (Object.hasOwn(dependencies(this.profileDir), skin.packageName)) {
          const result = await runPlugin(this.profile, ['remove', skin.packageName])
          if (result.exitCode !== 0) throw new Error(commandError(result))
        }
        removeRegistration(this.profileDir, skin)
        delete stored.skins[skin.id]
      }
      writeState(this.profileDir, stored)
      operation.phase = 'done'; operation.message = `${operation.kind} completed`
    } catch (error) {
      operation.phase = 'failed'; operation.message = error instanceof Error ? error.message : String(error)
    } finally {
      operation.finishedAt = new Date().toISOString(); this.activeOperation = null
      const timer = setTimeout(() => this.operations.delete(operation.id), OPERATION_TTL_MS); timer.unref?.()
    }
  }
}

function send(response, status, value) {
  const body = JSON.stringify(value)
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(body)
}

function requestBody(request) {
  return new Promise((resolvePromise, reject) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', chunk => { body += chunk; if (Buffer.byteLength(body) > MAX_BODY_BYTES) reject(new Error('request body is too large')) })
    request.on('end', () => { try { resolvePromise(body ? JSON.parse(body) : {}) } catch { reject(new Error('invalid JSON')) } })
    request.on('error', reject)
  })
}

function sameOrigin(request) {
  const origin = request.headers?.origin
  const host = request.headers?.host
  if (typeof origin !== 'string' || typeof host !== 'string') return false
  try { return new URL(origin).host === host } catch { return false }
}

function method(request, response, expected) {
  if (request.method === expected) return true
  response.writeHead(405, { allow: expected }); response.end(); return false
}

export function mountAppearanceManager({ webServer, loader }) {
  const profileDir = profileDirectory(loader)
  if (!profileDir || !PROFILE_NAME.test(profileDir.split(/[\\/]/).pop() || '')) return () => undefined
  const manager = new AppearanceManager(profileDir, loader)
  const routes = []
  const register = route => routes.push(webServer.register(route))
  register({ kind: 'exact', path: '/dsh-appearance-manager/state', handler: (request, response) => {
    if (!method(request, response, 'GET')) return
    send(response, 200, manager.state())
  } })
  for (const action of ['install', 'activate', 'deactivate', 'update', 'uninstall']) {
    register({ kind: 'exact', path: `/dsh-appearance-manager/${action}`, handler: async (request, response) => {
      if (!method(request, response, 'POST')) return
      if (!sameOrigin(request)) return send(response, 403, { error: 'same-origin request required' })
      try {
        const body = objectValue(await requestBody(request))
        const operation = manager.begin(action, body?.skin, body?.catalog)
        send(response, 202, { operationId: operation.id })
      } catch (error) { send(response, 409, { error: error instanceof Error ? error.message : String(error) }) }
    } })
  }
  register({ kind: 'prefix', path: '/dsh-appearance-manager/operations', handler: (request, response) => {
    if (!method(request, response, 'GET')) return
    const id = new URL(request.url ?? '/', 'http://localhost').pathname.split('/').pop() ?? ''
    const operation = manager.operations.get(id)
    if (!operation) return send(response, 404, { error: 'operation not found' })
    send(response, 200, operation)
  } })
  return () => { for (const dispose of routes.reverse()) dispose() }
}
