import { randomUUID } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, stringify } from 'yaml'

const MAX_BODY_BYTES = 512 * 1024
const OPERATION_TTL_MS = 30 * 60 * 1000
const PROFILE_NAME = /^[A-Za-z0-9._-]+$/
const ROLLBACK_FILES = [
  'package.json',
  'pnpm-lock.yaml',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-workspace.yaml',
  'cordis.patch.yml',
  '.dsh-appearance-manager/state.json',
]

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

const AQUA_PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-aqua'
const STALE_AQUA_SPEC = /^github:Renakoni\/DSH-Transparent-UI-Plugin#816bd68[0-9a-f]*$/i

function isStaleAquaSpec(value) {
  return typeof value === 'string' && STALE_AQUA_SPEC.test(value.trim())
}

const STALE_DEPENDENCY_RULES = new Map([[AQUA_PACKAGE_NAME, isStaleAquaSpec]])

function pendingThemeDependencyRepairs(profileDir, catalog) {
  if (!Array.isArray(catalog)) return null
  const manifest = profileManifest(profileDir)
  const installed = objectValue(manifest.dependencies) ?? {}
  const replacements = new Map()
  for (const [packageName, isStale] of STALE_DEPENDENCY_RULES) {
    const skin = catalog.find(item => item && item.packageName === packageName)
    const target = skin?.install?.target
    if (typeof target !== 'string' || target === '' || isStale(target)) continue
    if (isStale(installed[packageName])) replacements.set(packageName, target)
  }
  return replacements.size > 0 ? { manifest, replacements } : null
}

/**
 * Repair known historical catalog targets that no longer exist.
 *
 * The repair is deliberately exact: package.json is user-owned, so a custom
 * Aqua fork or any other git dependency must remain untouched. The current
 * target comes from the freshly fetched catalog and is then resolved by the
 * normal `dsh plugin add` command, which also refreshes the lockfile.
 */
export function repairKnownThemeDependencies(profileDir, catalog) {
  const repair = pendingThemeDependencyRepairs(profileDir, catalog)
  if (!repair) return false
  atomicJson(join(profileDir, 'package.json'), {
    ...repair.manifest,
    dependencies: { ...objectValue(repair.manifest.dependencies), ...Object.fromEntries(repair.replacements) },
  })
  return true
}

function validThemePackage(profileDir, packageName) {
  if (!Object.hasOwn(dependencies(profileDir), packageName)) return false
  const manifest = packageManifest(profileDir, packageName)
  return typeof manifest?.version === 'string' && objectValue(manifest.dsh)?.client !== undefined
}

function clientBundlePath(profileDir, packageName, manifest) {
  const exportsField = objectValue(manifest?.exports)
  const client = typeof exportsField?.['./client'] === 'string'
    ? exportsField['./client']
    : objectValue(exportsField?.['./client'])?.default
  return typeof client === 'string' && client !== ''
    ? resolve(packageDir(profileDir, packageName), client)
    : null
}

function compatibilityActivationError(compatibility) {
  if (compatibility?.status !== 'unverified') return null
  if (compatibility.code === 'legacy-keyed-settings-item-without-id') {
    return 'Theme uses a keyed settings slot without a stable legacy id and cannot be adapted safely.'
  }
  return 'Theme compatibility could not be verified safely, so activation was not applied.'
}

const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/i
const ANSI_ESCAPE = /\u001b\[[0-?]*[ -\/]*[@-~]/g

function packageNameFromValue(value) {
  if (typeof value !== 'string') return null
  const match = value.trim().match(/^(@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)(?:@.*)?$/i)
  return match && PACKAGE_NAME.test(match[1]) ? match[1] : null
}

function packageNameFromBlockedMessage(value) {
  if (typeof value !== 'string') return null
  const hint = value.match(/onlyBuiltDependencies\s*:\s*(?:\\r?\\n|\r?\n)\s*-\s*["']?([^"'\s]+)["']?/i)?.[1]
  const hintedPackage = packageNameFromValue(hint)
  if (hintedPackage) return hintedPackage
  const error = value.match(/git-hosted package\s+["']([^"']+?)@[^"']+["']/i)?.[1]
  return packageNameFromValue(error)
}

function gitHostedAdd(args) {
  return args.includes('add') && args.some(argument => /^(?:git\+|github:)|\.git(?:#|$)/.test(argument))
}

export function blockedBuildPackage(output) {
  const text = String(output ?? '').replace(ANSI_ESCAPE, '')
  const diagnostic = text.split(/\r?\n/)
    .filter(line => !/^\s*dsh: (?:pnpm failed|git-hosted plugins build)/i.test(line))
    .join('\n')
  const blocked = /ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED|onlyBuiltDependencies\s*:|git-hosted package\s+["'][^"']+["'] needs to execute build scripts|prepare script[^\n]*(?:block|allow)|build scripts?[^\n]*(?:block|allow)/i.test(diagnostic)
  if (!blocked) return null

  const hint = diagnostic.match(/onlyBuiltDependencies\s*:\s*\r?\n\s*-\s*["']?([^"'\s]+)["']?/i)?.[1]
  const hintedPackage = packageNameFromValue(hint)
  if (hintedPackage) return hintedPackage

  for (const line of diagnostic.split(/\r?\n/)) {
    try {
      const event = JSON.parse(line)
      const candidates = [
        event?.packageId,
        event?.packageName,
        event?.package?.bareSpecifier,
        event?.err?.package?.bareSpecifier,
        event?.err?.packageId,
        event?.err?.packageName,
        event?.hint,
        event?.message,
        event?.err?.message,
      ]
      for (const candidate of candidates) {
        const packageName = packageNameFromValue(candidate) ?? packageNameFromBlockedMessage(candidate)
        if (packageName) return packageName
      }
    } catch {
      // pnpm may mix human-readable and NDJSON reporter output.
    }
  }

  return packageNameFromBlockedMessage(diagnostic)
}

export function allowGitHostedBuild(profileDir, packageName) {
  if (!PACKAGE_NAME.test(packageName)) return false
  const file = join(profileDir, 'pnpm-workspace.yaml')
  let workspace
  try { workspace = objectValue(parse(readFileSync(file, 'utf8'))) ?? {} } catch { return false }
  const allowBuilds = objectValue(workspace.allowBuilds) ?? {}
  if (allowBuilds[packageName] === true) return false
  const temporary = `${file}.${process.pid}.tmp`
  try {
    writeFileSync(temporary, stringify({ ...workspace, allowBuilds: { ...allowBuilds, [packageName]: true } }, { lineWidth: 0 }))
    renameSync(temporary, file)
    return true
  } catch {
    try { rmSync(temporary, { force: true }) } catch { /* Best effort cleanup. */ }
    return false
  }
}

const PROFILE_CLEANUP_COMMANDS = new Set(['add', 'install', 'remove', 'update'])

function mutatesProfile(args) {
  return args.some(argument => PROFILE_CLEANUP_COMMANDS.has(argument))
}

function snapshotFile(file) {
  if (!existsSync(file)) return { exists: false, content: null }
  return { exists: true, content: readFileSync(file) }
}

function restoreFile(file, snapshot) {
  if (snapshot.exists) {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, snapshot.content)
  } else if (existsSync(file)) {
    rmSync(file, { force: true })
  }
}

function createProfileRollback(profileDir, packageNames) {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'dsh-theme-profile-rollback-'))
  const packages = new Map([...new Set(packageNames)].map(packageName => {
    const path = packageDir(profileDir, packageName)
    const backup = join(temporaryDirectory, 'packages', ...packageName.split('/'))
    const exists = existsSync(path)
    if (exists) {
      mkdirSync(dirname(backup), { recursive: true })
      cpSync(path, backup, { recursive: true, force: true, verbatimSymlinks: true })
    }
    return [path, { backup, exists }]
  }))
  const files = new Map(ROLLBACK_FILES.map(relative => [relative, snapshotFile(join(profileDir, relative))]))
  return {
    restore() {
      for (const [relative, snapshot] of files) restoreFile(join(profileDir, relative), snapshot)
      for (const [packagePath, snapshot] of packages) {
        if (snapshot.exists) {
          rmSync(packagePath, { recursive: true, force: true })
          mkdirSync(dirname(packagePath), { recursive: true })
          cpSync(snapshot.backup, packagePath, { recursive: true, force: true, verbatimSymlinks: true })
        } else if (existsSync(packagePath)) {
          rmSync(packagePath, { recursive: true, force: true })
        }
      }
    },
    cleanup() { rmSync(temporaryDirectory, { recursive: true, force: true }) },
  }
}

function createActiveThemeUpdateRollback(profileDir, packageName) {
  return createProfileRollback(profileDir, [packageName])
}

/**
 * Detect the one legacy slot migration the Desk shim can prove safe. The
 * check runs against the installed bundle immediately before activation, so a
 * catalog commit or package update cannot stale the compatibility decision.
 */
export function detectThemeCompatibility(profileDir, packageName) {
  const manifest = packageManifest(profileDir, packageName)
  const clientPath = clientBundlePath(profileDir, packageName, manifest)
  if (!clientPath) return { status: 'unverified', code: 'client-bundle-unreadable' }
  let source
  try { source = readFileSync(clientPath, 'utf8') } catch { return { status: 'unverified', code: 'client-bundle-unreadable' } }

  const registrations = [...source.matchAll(/slots\.register\(\s*\{\s*name\s*:\s*["']settings\.plugin\.item["'][\s\S]{0,900}?\}/g)]
  const keyless = registrations.some(match => {
    const block = match[0]
    return /\bid\s*:\s*["'][^"']+["']/.test(block) && !/\bkey\s*:/.test(block)
  })
  const unsupported = registrations.some(match => {
    const block = match[0]
    return !/\bid\s*:\s*["'][^"']+["']/.test(block) && !/\bkey\s*:/.test(block)
  })
  if (unsupported) return { status: 'unverified', code: 'legacy-keyed-settings-item-without-id' }
  if (keyless) return { status: 'adapted', code: 'legacy-keyed-settings-item' }
  if (source.includes('settings.plugin.item') && registrations.length === 0) {
    return { status: 'unverified', code: 'settings-slot-registration-unreadable' }
  }
  return { status: 'native' }
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

function uncataloguedThemeEntries(profileDir, loader, catalog, selectedPackage, activationGroup) {
  const knownPackages = new Set(Array.isArray(catalog)
    ? catalog.flatMap(skin => typeof skin?.packageName === 'string' ? [skin.packageName] : [])
    : [])
  // dsh.client marks every Web extension, so only persisted appearance
  // ownership may classify a package outside the catalog as a theme.
  const managedPackages = new Set(Object.values(readState(profileDir).skins).flatMap(value => {
    const skin = objectValue(value)
    return typeof skin?.packageName === 'string' && skin.activationGroup === activationGroup ? [skin.packageName] : []
  }))
  const entries = [...loader.entries()]
  return Object.keys(dependencies(profileDir)).flatMap(packageName => {
    if (packageName === selectedPackage || knownPackages.has(packageName) || !managedPackages.has(packageName)) return []
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

async function disableUncataloguedThemes(profileDir, loader, catalog, selectedPackage, activationGroup) {
  for (const theme of uncataloguedThemeEntries(profileDir, loader, catalog, selectedPackage, activationGroup)) {
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

async function disableLoaderEntries(loader, skin) {
  for (const entry of loader.entries()) {
    const options = objectValue(entry.options)
    if (!options || !matches(options, skin) || options.disabled === true || typeof entry.update !== 'function') continue
    await entry.update({ disabled: true }, false, true)
  }
}

function invocation() {
  const entry = process.argv[1]
  if (entry && /[\\/](?:bin\.(?:js|ts)|dsh)$/.test(entry)) return { file: process.execPath, prefix: [...process.execArgv, resolve(entry)] }
  return { file: 'dsh', prefix: [] }
}
function parsePnpmOutput(chunk, packages, onProgress, parserState) {
  if (typeof onProgress !== 'function') return
  const text = `${parserState.value}${String(chunk)}`.replace(/\u001b\[[0-?]*[ -\/]*[@-~]/g, '')
  const lines = text.split(/\r?\n/)
  parserState.value = lines.pop() ?? ''
  for (const line of lines) {
    if (!line.trim()) continue
    let event
    try { event = JSON.parse(line) } catch { continue }
    if (event?.name !== 'pnpm:fetching-progress' || typeof event.packageId !== 'string') continue
    const current = packages.get(event.packageId) ?? { size: null, downloaded: 0 }
    if (typeof event.size === 'number' && Number.isFinite(event.size) && event.size > 0) current.size = Math.floor(event.size)
    if (typeof event.downloaded === 'number' && Number.isFinite(event.downloaded) && event.downloaded >= 0) current.downloaded = Math.floor(event.downloaded)
    if (event.status === 'finished' || event.status === 'fetched') current.downloaded = current.size ?? current.downloaded
    packages.set(event.packageId, current)
    const entries = [...packages.values()]
    const totalBytes = entries.every(item => item.size !== null) ? entries.reduce((sum, item) => sum + item.size, 0) : null
    if (totalBytes === null || totalBytes <= 0) {
      onProgress({ progress: null })
      continue
    }
    const receivedBytes = entries.reduce((sum, item) => sum + Math.min(item.downloaded, item.size), 0)
    onProgress({ progress: Math.max(0, Math.min(100, receivedBytes / totalBytes * 100)), receivedBytes, totalBytes })
  }
}

function spawnPlugin(profile, args, onProgress) {
  return new Promise(resolvePromise => {
    const command = invocation()
    const reporterArgs = args.some(argument => argument === '--reporter' || argument.startsWith('--reporter=')) ? args : [...args, '--reporter', 'ndjson']
    const child = spawn(command.file, [...command.prefix, 'plugin', '--profile', profile, ...reporterArgs], { shell: false, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: 'true' } })
    let stdout = ''; let stderr = ''
    const packages = new Map()
    const stdoutParserState = { value: '' }
    const stderrParserState = { value: '' }
    child.stdout?.on('data', chunk => { stdout += String(chunk); parsePnpmOutput(chunk, packages, onProgress, stdoutParserState) })
    child.stderr?.on('data', chunk => { stderr += String(chunk); parsePnpmOutput(chunk, packages, onProgress, stderrParserState) })
    const timer = setTimeout(() => child.kill(), 10 * 60 * 1000)
    child.on('error', error => { stderr += error.message })
    child.on('close', exitCode => { clearTimeout(timer); resolvePromise({ exitCode, stdout, stderr }) })
  })
}

export function runPlugin(profile, args, onProgress, profileDir) {
  return spawnPlugin(profile, args, onProgress).then(async result => {
    if (result.exitCode !== 0 && profileDir && gitHostedAdd(args)) {
      const packageName = blockedBuildPackage(`${result.stderr}\n${result.stdout}`)
      if (packageName && allowGitHostedBuild(profileDir, packageName)) {
        result = await spawnPlugin(profile, args, onProgress)
      }
    }
    if (profileDir && result.exitCode === 0 && mutatesProfile(args)) {
      // Keep pnpm-managed node_modules aligned with the manifest after a
      // successful mutation. This only removes extraneous materialized
      // packages; it never edits dependencies or the pnpm store.
      await spawnPlugin(profile, ['prune', '--ignore-scripts'])
    }
    return result
  })
}

export function commandError(result) {
  const raw = `${result.stderr || ''}\n${result.stdout || ''}`.replace(ANSI_ESCAPE, '')
  const details = []
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || /^dsh: (?:pnpm failed|git-hosted plugins build)/i.test(trimmed)) continue
    try {
      const event = JSON.parse(trimmed)
      const error = event?.err
      if (event?.name === 'pnpm' && error && typeof error === 'object') {
        if (typeof error.code === 'string') details.push(error.code)
        if (typeof error.message === 'string') details.push(error.message)
        if (typeof error.resource === 'string') details.push(error.resource)
      } else if (event?.name === 'pnpm:package-requester' && typeof event.message === 'string') {
        details.push(event.message)
      }
      continue
    } catch {
      // Keep non-JSON pnpm error lines below.
    }
    if (/ERR_PNPM_|\b(?:ECONNRESET|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN)\b|\b(?:error|failed|forbidden|not found)\b/i.test(trimmed)) details.push(trimmed)
  }
  const message = [...new Set(details)].join('\n') || raw.trim() || `plugin command exited ${String(result.exitCode)}`
  return message.slice(-1200)
}

function skinState(profileDir, skin, stored) {
  const installed = Object.hasOwn(dependencies(profileDir), skin.packageName)
  const manifest = packageManifest(profileDir, skin.packageName)
  const valid = validThemePackage(profileDir, skin.packageName)
  return {
    skinId: skin.id,
    installation: !installed ? 'missing' : valid ? 'installed' : 'broken',
    activation: stored?.active === true ? 'active' : 'inactive',
    installedVersion: valid ? manifest.version : null,
    installedAt: null,
    updateAvailable: valid && manifest.version !== skin.install.version,
    ...(stored?.compatibility && typeof stored.compatibility.status === 'string' ? { compatibility: stored.compatibility } : {}),
    ...(!valid && installed ? { error: 'Installed theme package is incomplete.' } : {})
  }
}

class AppearanceManager {
  constructor(profileDir, loader, pluginRunner = runPlugin) {
    this.profileDir = profileDir
    this.profile = profileDir.split(/[\\/]/).pop() || 'web'
    this.loader = loader
    this.pluginRunner = pluginRunner
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
        const valid = validThemePackage(this.profileDir, packageName)
        return {
          skinId,
          installation: !installed ? 'missing' : valid ? 'installed' : 'broken',
          activation: saved.active === true ? 'active' : 'inactive',
          installedVersion: valid && typeof manifest?.version === 'string' ? manifest.version : null,
          installedAt: null,
          updateAvailable: false,
          ...(saved.compatibility && typeof saved.compatibility.status === 'string' ? { compatibility: saved.compatibility } : {}),
          ...(!valid && installed ? { error: 'Installed theme package is incomplete.' } : {})
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
    let rollback
    try {
      const stored = readState(this.profileDir)
      const legacyState = jsonFile(join(this.profileDir, '.dsh-skin-market', 'state.json'), {})
      const existing = stored.skins[skin.id] ?? { active: legacyState?.activeSkinId === skin.id }
      if (operation.kind === 'install' || operation.kind === 'update') {
        const pendingRepairs = pendingThemeDependencyRepairs(this.profileDir, catalog)
        const needsInstall = operation.kind === 'update' || !validThemePackage(this.profileDir, skin.packageName) || pendingRepairs !== null
        if (needsInstall) {
          if (pendingRepairs) rollback = createProfileRollback(this.profileDir, [skin.packageName, ...pendingRepairs.replacements.keys()])
          repairKnownThemeDependencies(this.profileDir, catalog)
          if (operation.kind === 'update' && existing.active === true && !rollback) rollback = createActiveThemeUpdateRollback(this.profileDir, skin.packageName)
          operation.phase = 'downloading'
          const result = await this.pluginRunner(this.profile, ['add', skin.install.target], progress => {
            operation.progress = typeof progress?.progress === 'number' && Number.isFinite(progress.progress)
              ? Math.max(0, Math.min(100, progress.progress))
              : null
            if (typeof progress?.receivedBytes === 'number' && Number.isFinite(progress.receivedBytes)) operation.receivedBytes = progress.receivedBytes
            if (typeof progress?.totalBytes === 'number' && Number.isFinite(progress.totalBytes)) operation.totalBytes = progress.totalBytes
            if (operation.progress === null) {
              delete operation.receivedBytes
              delete operation.totalBytes
            }
          }, this.profileDir)
          if (result.exitCode !== 0) throw new Error(commandError(result))
        }
        let compatibility = operation.kind === 'update' ? undefined : existing.compatibility
        if (existing.active === true) {
          operation.phase = 'checking'
          compatibility = detectThemeCompatibility(this.profileDir, skin.packageName)
          operation.compatibility = compatibility
        }
        if (existing.active === true) {
          const compatibilityError = compatibilityActivationError(compatibility)
          if (compatibilityError) throw new Error(compatibilityError)
        }
        operation.phase = 'registering'
        ensureRegistration(this.profileDir, skin, existing.active !== true)
        stored.skins[skin.id] = { active: existing.active === true, packageName: skin.packageName, themeId: skin.id, version: skin.install.version, appearance: skin.appearance, ...(compatibility ? { compatibility } : {}), ...(typeof skin.activationGroup === 'string' && skin.activationGroup !== '' ? { activationGroup: skin.activationGroup } : {}) }
      } else if (operation.kind === 'activate' || operation.kind === 'deactivate') {
        operation.phase = operation.kind === 'activate' ? 'checking' : 'deactivating'
        if (!Object.hasOwn(dependencies(this.profileDir), skin.packageName)) throw new Error('install the theme before using it')
        const active = operation.kind === 'activate'
        const compatibility = active ? detectThemeCompatibility(this.profileDir, skin.packageName) : existing.compatibility
        if (active) operation.compatibility = compatibility
        if (active) {
          const compatibilityError = compatibilityActivationError(compatibility)
          if (compatibilityError) throw new Error(compatibilityError)
        }
        operation.phase = active ? 'activating' : 'deactivating'
        const activationGroup = typeof skin.activationGroup === 'string' && skin.activationGroup !== '' ? skin.activationGroup : null
        if (active && activationGroup && Array.isArray(catalog)) {
          for (const other of catalog) {
            if (!other || other.id === skin.id || typeof other.packageName !== 'string' || typeof other.rowId !== 'string') continue
            if (other.activationGroup !== activationGroup) continue
            if (!Object.hasOwn(dependencies(this.profileDir), other.packageName)) continue
            ensureRegistration(this.profileDir, other, true)
            stored.skins[other.id] = { ...stored.skins[other.id], active: false, packageName: other.packageName, themeId: other.id, version: other.install?.version, appearance: other.appearance, activationGroup }
          }
          await disableUncataloguedThemes(this.profileDir, this.loader, catalog, skin.packageName, activationGroup)
        }
        ensureRegistration(this.profileDir, skin, !active)
        stored.skins[skin.id] = { active, packageName: skin.packageName, themeId: skin.id, version: skin.install.version, appearance: skin.appearance, ...(compatibility ? { compatibility } : {}), ...(activationGroup ? { activationGroup } : {}) }
      } else {
        operation.phase = 'uninstalling'
        await disableLoaderEntries(this.loader, skin)
        if (Object.hasOwn(dependencies(this.profileDir), skin.packageName)) {
          const pendingRepairs = pendingThemeDependencyRepairs(this.profileDir, catalog)
          if (pendingRepairs) rollback = createProfileRollback(this.profileDir, [skin.packageName, ...pendingRepairs.replacements.keys()])
          repairKnownThemeDependencies(this.profileDir, catalog)
          const result = await this.pluginRunner(this.profile, ['remove', skin.packageName], undefined, this.profileDir)
          if (result.exitCode !== 0) throw new Error(commandError(result))
        }
        removeRegistration(this.profileDir, skin)
        delete stored.skins[skin.id]
      }
      writeState(this.profileDir, stored)
      operation.phase = 'done'; operation.progress = 100; operation.message = `${operation.kind} completed`
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (rollback) {
        try { rollback.restore() } catch (restoreError) {
          operation.message = `${message} Rollback failed: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`
        }
      }
      operation.phase = 'failed'; operation.message ??= message
    } finally {
      rollback?.cleanup()
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

export function mountAppearanceManager({ webServer, loader, runPlugin: pluginRunner }) {
  const profileDir = profileDirectory(loader)
  if (!profileDir || !PROFILE_NAME.test(profileDir.split(/[\\/]/).pop() || '')) return () => undefined
  const manager = new AppearanceManager(profileDir, loader, pluginRunner ?? runPlugin)
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
