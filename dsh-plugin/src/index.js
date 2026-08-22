import Schema from '@deepseek-ai/schemastery'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { agentErrorEvent, createBridge, sessionStartEvent } from './bridge.js'
import { mountAppearanceManager } from './appearance-manager.js'

export { allowGitHostedBuild, blockedBuildPackage, commandError, detectThemeCompatibility, mountAppearanceManager, repairKnownThemeDependencies, runPlugin } from './appearance-manager.js'

export const name = 'dsh-desk'
export const inject = ['agents', 'sessions', 'approval', 'loader', 'skills']

export const Config = Schema.object({
  component: Schema.string().default('desk'),
  port: Schema.number().default(17321),
  eventTimeoutMs: Schema.number().default(800),
  permissionCreateTimeoutMs: Schema.number().default(5000),
  permissionWaitTimeoutMs: Schema.number().default(65000),
  inventoryPublishMs: Schema.number().default(3000),
})

const FIBER_PHASES = ['pending', 'loading', 'active', 'failed', null, 'unloading']
const POLICY_PROVIDER = 'dsh-desk-policy'
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const BLOCKED_INVOCATION = { modelInvocable: false, userInvocable: false }
const PROTECTED_BUNDLES = new Set([
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  '@deepseek-ai/dsh-headless',
  'dsh-desk-plugin',
])
const JS_YAML_TAG = { tag: 'tag:yaml.org,2002:js', resolve: value => value }

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function rootInclude(loader) {
  return [...loader.entries()].find(entry => entry.options.id === 'include' && entry.options.name === 'cordis:include')
}

function profileDirectory(loader) {
  const path = rootInclude(loader)?.options.config?.path
  if (typeof path !== 'string' || !path) return null
  try {
    return dirname(path.startsWith('file:') ? fileURLToPath(path) : resolve(path))
  } catch {
    return null
  }
}

function packageDirectory(profileDir, packageName) {
  const require = createRequire(join(profileDir, 'package.json'))
  for (const modulesDir of require.resolve.paths(packageName) ?? []) {
    const candidate = join(modulesDir, ...packageName.split('/'))
    try {
      const manifest = objectValue(JSON.parse(readFileSync(join(candidate, 'package.json'), 'utf8')))
      if (manifest?.name === packageName) return candidate
    } catch {
      // Continue through Node's resolution roots. DSH uses the same profile fallback walk.
    }
  }
  return null
}

function removeGroupChildren(groupId, owners, groupChildren) {
  for (const childId of groupChildren.get(groupId) ?? []) {
    removeGroupChildren(childId, owners, groupChildren)
    owners.delete(childId)
    groupChildren.delete(childId)
  }
  groupChildren.set(groupId, new Set())
}

function recordInsertedEntries(entries, packageName, owners, groupChildren, parentGroupId = null) {
  if (!Array.isArray(entries)) return
  for (const candidate of entries) {
    const entry = objectValue(candidate)
    if (!entry || typeof entry.id !== 'string' || !entry.id) continue
    if (!owners.has(entry.id)) owners.set(entry.id, packageName)
    if (parentGroupId) {
      const children = groupChildren.get(parentGroupId) ?? new Set()
      children.add(entry.id)
      groupChildren.set(parentGroupId, children)
    }
    if (entry.group) {
      groupChildren.set(entry.id, new Set())
      if (Array.isArray(entry.config)) {
        recordInsertedEntries(entry.config, packageName, owners, groupChildren, entry.id)
      }
    }
  }
}

/** Resolve the bundle layer which first inserted each configured Loader row. */
export function bundleConfigOwners(loader) {
  const profileDir = profileDirectory(loader)
  if (!profileDir) return new Map()
  try {
    const profile = objectValue(JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')))
    const bundles = profile?.dsh?.profile?.bundles
    if (!Array.isArray(bundles) || bundles.some(name => typeof name !== 'string')) return new Map()
    const owners = new Map()
    const groupChildren = new Map()
    for (const packageName of bundles) {
      const packageDir = packageDirectory(profileDir, packageName)
      if (!packageDir) continue
      const manifest = objectValue(JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')))
      const patch = manifest?.dsh?.bundle?.patch
      if (typeof patch !== 'string' || !patch) continue
      const patchPath = resolve(packageDir, patch)
      if (!existsSync(patchPath)) continue
      const patches = parseYaml(readFileSync(patchPath, 'utf8'), { customTags: [JS_YAML_TAG] })
      if (!Array.isArray(patches)) continue
      for (const candidate of patches) {
        const layerPatch = objectValue(candidate)
        if (!layerPatch) continue
        recordInsertedEntries(layerPatch.insert, packageName, owners, groupChildren)
        if (typeof layerPatch.id !== 'string') continue
        if (layerPatch.group === false || layerPatch.group === null) {
          removeGroupChildren(layerPatch.id, owners, groupChildren)
          groupChildren.delete(layerPatch.id)
          continue
        }
        if ((groupChildren.has(layerPatch.id) || layerPatch.group === true) && Array.isArray(layerPatch.config)) {
          removeGroupChildren(layerPatch.id, owners, groupChildren)
          recordInsertedEntries(layerPatch.config, packageName, owners, groupChildren, layerPatch.id)
        }
      }
    }
    return owners
  } catch {
    return new Map()
  }
}

/** Project configured ownership through runtime subtrees created by aggregate entries. */
export function runtimeEntryOwners(loader, configOwners = bundleConfigOwners(loader)) {
  const entries = [...loader.entries()]
  const include = rootInclude(loader)
  if (!include?.subtree) return new Map()
  const owners = new Map()
  for (const entry of entries) {
    if (entry.parent?.tree !== include.subtree) continue
    const packageName = configOwners.get(entry.options.id)
    if (packageName) owners.set(entry.id, packageName)
  }
  for (const entry of entries.sort((left, right) => left.id.length - right.id.length)) {
    if (owners.has(entry.id)) continue
    let separator = entry.id.lastIndexOf(':')
    while (separator > 0) {
      const packageName = owners.get(entry.id.slice(0, separator))
      if (packageName) {
        owners.set(entry.id, packageName)
        break
      }
      separator = entry.id.lastIndexOf(':', separator - 1)
    }
  }
  return owners
}

function ownedComponentRoots(loader, owners, packageName) {
  const entries = [...loader.entries()].filter(entry => !entry.options.group && owners.get(entry.id) === packageName)
  const ownedIds = new Set(entries.map(entry => entry.id))
  return entries.filter(entry => {
    let separator = entry.id.lastIndexOf(':')
    while (separator > 0) {
      if (ownedIds.has(entry.id.slice(0, separator))) return false
      separator = entry.id.lastIndexOf(':', separator - 1)
    }
    return true
  })
}

function configuredEnabled(entry, disabled) {
  if (disabled && typeof disabled === 'object' && typeof disabled.__jsExpr === 'string'
    && typeof entry.evaluate === 'function') {
    try {
      return !Boolean(entry.evaluate(disabled.__jsExpr))
    } catch {
      return null
    }
  }
  return !Boolean(disabled)
}

export function loaderInventory(loader, configOwners = bundleConfigOwners(loader), baselines = new Map()) {
  const owners = runtimeEntryOwners(loader, configOwners)
  const componentIds = new Set()
  for (const packageName of new Set(owners.values())) {
    for (const entry of ownedComponentRoots(loader, owners, packageName)) componentIds.add(entry.id)
  }
  const entries = []
  for (const entry of loader.entries()) {
    if (entry.options.group) continue
    const ownerPackage = owners.get(entry.id)
    const componentKey = ownerPackage && componentIds.has(entry.id) ? entry.id : undefined
    const baseline = baselines.has(entry.id) ? baselines.get(entry.id) : entry.options.disabled
    entries.push({
      entryId: entry.id,
      configId: entry.options.id,
      moduleName: entry.options.name,
      ...(ownerPackage ? { ownerPackage } : {}),
      ...(componentKey ? { componentKey, baselineEnabled: configuredEnabled(entry, baseline) } : {}),
      enabled: !entry.disabled,
      fiberPhase: entry.fiber === undefined ? null : FIBER_PHASES[entry.fiber.state] ?? null,
    })
  }
  return { entries }
}

function desiredStates(value, key) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (!value[key] || typeof value[key] !== 'object' || Array.isArray(value[key])) return null
  return value[key]
}

function desiredComponentStates(value) {
  const packages = desiredStates(value, 'desiredPluginComponents')
  if (!packages) return null
  const normalized = {}
  for (const [packageName, candidate] of Object.entries(packages)) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null
    const states = {}
    for (const [componentKey, enabled] of Object.entries(candidate)) {
      if (!componentKey || typeof enabled !== 'boolean') return null
      states[componentKey] = enabled
    }
    normalized[packageName] = states
  }
  return normalized
}

function desiredComponentState(packages, componentKey) {
  let resolved
  for (const states of Object.values(packages)) {
    const candidate = states[componentKey]
    if (typeof candidate !== 'boolean') continue
    if (resolved !== undefined && resolved !== candidate) {
      throw new Error(`dsh-desk: conflicting state for plugin component ${componentKey}`)
    }
    resolved = candidate
  }
  return resolved
}

function ownershipRoots(loader, owners, packageName) {
  return ownedComponentRoots(loader, owners, packageName)
}

function sameDisabled(left, right) {
  if (left === right) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}

/** Apply one package state to every owned root while preserving each row's configured disabled value. */
export function createPluginPackageController(loader, configOwners = bundleConfigOwners(loader)) {
  const overridden = new Map()
  let applying = false
  return {
    inventory() {
      return loaderInventory(loader, configOwners, overridden)
    },
    async apply(desired, desiredComponents = {}) {
      const owners = runtimeEntryOwners(loader, configOwners)
      const roots = []
      for (const packageName of new Set(owners.values())) {
        roots.push(...ownershipRoots(loader, owners, packageName).map(entry => ({ entry, packageName })))
      }
      const changes = []
      const nextBaselines = new Map(overridden)
      for (const { entry, packageName } of roots) {
        const packageEnabled = desired[packageName]
        const packageDisabled = packageEnabled === false && !PROTECTED_BUNDLES.has(packageName)
        const componentEnabled = packageName === 'dsh-desk-plugin'
          ? undefined
          : desiredComponentState(desiredComponents, entry.id)
        const hasComponentOverride = typeof componentEnabled === 'boolean'
        const hasOverride = packageDisabled || hasComponentOverride
        const baseline = overridden.has(entry.id) ? overridden.get(entry.id) : entry.options.disabled
        const next = packageDisabled ? true : hasComponentOverride ? !componentEnabled : baseline
        if (hasOverride) nextBaselines.set(entry.id, baseline)
        else nextBaselines.delete(entry.id)
        if (!sameDisabled(entry.options.disabled, next)) {
          changes.push({ entry, previous: entry.options.disabled, next })
        }
      }
      const applied = []
      applying = true
      try {
        for (const change of changes) {
          await change.entry.update({ disabled: change.next === undefined ? null : change.next })
          applied.push(change)
        }
      } catch (error) {
        for (const change of applied.reverse()) {
          await change.entry.update({ disabled: change.previous === undefined ? null : change.previous })
        }
        throw error
      } finally {
        applying = false
      }
      overridden.clear()
      for (const [entryId, baseline] of nextBaselines) overridden.set(entryId, baseline)
    },
    observe(entry, previousOptions) {
      if (!applying && overridden.has(entry.id)
        && !sameDisabled(previousOptions?.disabled, entry.options.disabled)) {
        overridden.set(entry.id, entry.options.disabled)
      }
    },
  }
}

function normalizeSkillPolicy(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.defaultEnabled !== 'boolean'
    || !value.states || typeof value.states !== 'object' || Array.isArray(value.states)) return null
  const states = {}
  for (const [name, enabled] of Object.entries(value.states)) {
    if (!SKILL_NAME.test(name) || typeof enabled !== 'boolean') return null
    states[name] = enabled
  }
  return { defaultEnabled: value.defaultEnabled, states }
}

function resolveDshHome() {
  const configured = process.env.DSH_HOME?.trim()
  if (!configured) return join(homedir(), '.dsh')
  if (configured === '~') return homedir()
  if (configured.startsWith('~/') || configured.startsWith('~\\')) return resolve(homedir(), configured.slice(2))
  return resolve(configured)
}

function readStoredSkillPolicy() {
  try {
    const parsed = JSON.parse(readFileSync(join(resolveDshHome(), '.dsh-desk', 'skill-policy.json'), 'utf8'))
    return normalizeSkillPolicy(parsed) ?? { defaultEnabled: true, states: {} }
  } catch {
    return { defaultEnabled: true, states: {} }
  }
}

function enabledByPolicy(policy, name) {
  return Object.hasOwn(policy.states, name) ? policy.states[name] : policy.defaultEnabled
}

function sameNames(left, right) {
  return left.size === right.size && [...left].every(name => right.has(name))
}

export async function createAgentSkillPolicy(skills, agent, initialPolicy, initialSignal) {
  const known = new Map()
  let policy = normalizeSkillPolicy(initialPolicy) ?? { defaultEnabled: true, states: {} }
  let invalidate = () => undefined
  let blocked = new Set()

  const observe = async (signal) => {
    const snapshot = await skills.snapshot({
      ...(typeof agent.session?.header?.cwd === 'string' && agent.session.header.cwd ? { cwd: agent.session.header.cwd } : {}),
      scope: agent,
      ...(signal ? { signal } : {}),
    })
    for (const skill of snapshot.skills) {
      if (skill.provider !== POLICY_PROVIDER) known.set(skill.name, skill)
    }
    return snapshot.complete
  }
  try {
    await observe(initialSignal)
  } catch (error) {
    if (initialSignal?.aborted) throw error
  }

  const nextBlocked = () => new Set([
    ...known.keys(),
    ...Object.entries(policy.states).filter(([, enabled]) => !enabled).map(([name]) => name),
  ].filter(name => !enabledByPolicy(policy, name)))
  blocked = nextBlocked()

  const dispose = skills.registerProvider((control) => {
    invalidate = control.invalidate
    return {
      name: POLICY_PROVIDER,
      async list() {
        return [...blocked].sort().map((name) => {
          const original = known.get(name)
          return {
            ...(original ?? {
              name,
              description: 'Disabled in the active DSH Desk scheme.',
              source: 'runtime',
            }),
            invocation: BLOCKED_INVOCATION,
            provider: POLICY_PROVIDER,
            rank: -Number.MAX_SAFE_INTEGER,
            locator: name,
          }
        })
      },
      async get(candidate) {
        const { rank: _rank, locator: _locator, ...summary } = candidate
        return { ...summary, content: '' }
      },
    }
  })

  const reconcile = () => {
    const next = nextBlocked()
    if (sameNames(blocked, next)) return
    blocked = next
    invalidate()
  }

  return {
    async refresh(signal) {
      const complete = await observe(signal)
      reconcile()
      return complete
    },
    update(nextPolicy) {
      const normalized = normalizeSkillPolicy(nextPolicy)
      if (!normalized) return
      policy = normalized
      reconcile()
    },
    inventory() {
      return [...known.values()]
        .sort((left, right) => left.name.localeCompare(right.name))
        .map(skill => ({
          name: skill.name,
          description: skill.description,
          source: skill.source,
          provider: skill.provider,
          modelInvocable: skill.invocation.modelInvocable,
          userInvocable: skill.invocation.userInvocable,
          enabled: enabledByPolicy(policy, skill.name),
        }))
    },
    dispose,
  }
}

export function agentSkillInventory(policies) {
  const entries = new Map()
  for (const policy of policies) {
    for (const skill of policy.inventory()) {
      const key = `${skill.name}\0${skill.source}\0${skill.provider}`
      const existing = entries.get(key)
      entries.set(key, existing ? { ...skill, enabled: existing.enabled || skill.enabled } : skill)
    }
  }
  return [...entries.values()].sort((left, right) => left.name.localeCompare(right.name)
    || left.source.localeCompare(right.source) || left.provider.localeCompare(right.provider))
}

function positiveSafeInteger(name, value, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(`dsh-desk: ${name} must be a positive safe integer at most ${maximum}`)
  }
}

export async function apply(ctx, config) {
  if (config.component === 'appearance-manager') {
    ctx.inject(['webServer'], webContext => {
      const webServer = typeof webContext.get === 'function' ? webContext.get('webServer') : undefined
      if (webServer !== undefined) webContext.effect(() => mountAppearanceManager({ webServer, loader: ctx.loader }), 'dsh-appearance-manager: routes')
    })
    return
  }
  positiveSafeInteger('port', config.port, 65535)
  positiveSafeInteger('eventTimeoutMs', config.eventTimeoutMs)
  positiveSafeInteger('permissionCreateTimeoutMs', config.permissionCreateTimeoutMs)
  positiveSafeInteger('permissionWaitTimeoutMs', config.permissionWaitTimeoutMs)
  positiveSafeInteger('inventoryPublishMs', config.inventoryPublishMs)

  const lifetime = new AbortController()
  const bridge = createBridge(config, lifetime.signal)
  const instanceId = randomUUID()
  const pluginPackages = createPluginPackageController(ctx.loader)
  const agentPolicies = new Map()
  let skillPolicy = readStoredSkillPolicy()
  let inventoryTimer
  let publishingInventory = false
  let republishInventory = false
  const publishInventory = async () => {
    if (publishingInventory) {
      republishInventory = true
      return
    }
    publishingInventory = true
    try {
      const response = await bridge.publishPluginInventory({
        instanceId,
        ...pluginPackages.inventory(),
        skills: agentSkillInventory(agentPolicies.values()),
      })
      const desiredSkills = desiredStates(response, 'desiredSkills')
      const desiredPluginPackages = desiredStates(response, 'desiredPluginPackages')
      const desiredPluginComponents = desiredComponentStates(response)
      const receivedPolicy = normalizeSkillPolicy(response?.skillPolicy)
        ?? (desiredSkills ? normalizeSkillPolicy({ defaultEnabled: true, states: desiredSkills }) : null)
      if (receivedPolicy) {
        skillPolicy = receivedPolicy
        for (const policy of agentPolicies.values()) policy.update(skillPolicy)
      }
      if (desiredPluginPackages || desiredPluginComponents) {
        await pluginPackages.apply(desiredPluginPackages ?? {}, desiredPluginComponents ?? {})
      }
    } catch (error) {
      console.warn('dsh-desk: failed to apply desktop plugin state', error)
    } finally {
      publishingInventory = false
      if (republishInventory) {
        republishInventory = false
        scheduleInventory()
      }
    }
  }
  const scheduleInventory = () => {
    if (inventoryTimer !== undefined) clearTimeout(inventoryTimer)
    inventoryTimer = setTimeout(() => { void publishInventory() }, 50)
    inventoryTimer.unref?.()
  }
  const inventoryInterval = setInterval(() => { void publishInventory() }, config.inventoryPublishMs)
  inventoryInterval.unref?.()
  ctx.effect(() => async () => {
    if (inventoryTimer !== undefined) clearTimeout(inventoryTimer)
    clearInterval(inventoryInterval)
    for (const policy of agentPolicies.values()) policy.dispose()
    agentPolicies.clear()
    lifetime.abort()
    await bridge.close()
  }, 'dsh-desk: abort loopback requests')

  await publishInventory()

  const ensureAgentPolicy = async (agent, signal) => {
    const existing = agentPolicies.get(agent)
    if (existing) return existing
    const skills = agent.ctx.get('skills')
    if (skills === undefined) throw new Error('dsh-desk: agent skills service unavailable')
    const created = await createAgentSkillPolicy(skills, agent, skillPolicy, signal)
    agentPolicies.set(agent, created)
    scheduleInventory()
    return created
  }

  ctx.on('internal/status', scheduleInventory)
  ctx.on('loader/config-update', scheduleInventory)
  ctx.on('loader/entry-init', scheduleInventory)
  ctx.on('loader/partial-dispose', (entry, previousOptions) => {
    pluginPackages.observe(entry, previousOptions)
    scheduleInventory()
  })

  ctx.on('agent/session-start', ({ agent }) => {
    try {
      // Maintenance claims the idle agent synchronously, so Headless and Web
      // wakeups queue behind the first scoped catalog read and policy mount.
      void agent.runMaintenance(async (signal) => {
        const existing = agentPolicies.get(agent)
        if (existing) await existing.refresh(signal)
        else await ensureAgentPolicy(agent, signal)
        scheduleInventory()
      }).catch(error => { console.warn('dsh-desk: failed to initialize agent Skill policy', error) })
    } catch (error) {
      console.warn('dsh-desk: failed to reserve agent Skill policy maintenance', error)
    }
    void bridge.publish(sessionStartEvent(String(agent.session.id)))
  })
  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    try {
      const existing = agentPolicies.get(agent)
      if (existing) await existing.refresh(signal)
      else await ensureAgentPolicy(agent, signal)
      scheduleInventory()
    } catch (error) {
      if (!signal.aborted) console.warn('dsh-desk: failed to refresh agent Skill policy', error)
    }
    return next()
  }, { prepend: true })
  ctx.on('agent/disposed', ({ agent }) => {
    const policy = agentPolicies.get(agent)
    if (!policy) return
    agentPolicies.delete(agent)
    policy.dispose()
    scheduleInventory()
  })
  ctx.on('session/event', (session, event) => {
    void bridge.publishSessionEvent(session, event)
  })
  ctx.on('agent/error', ({ agent, error }) => {
    void bridge.publish(agentErrorEvent(String(agent.session.id), error))
  })
  ctx.on('approval/request', async (request, next) => {
    const outcome = await bridge.requestApproval(request)
    return outcome ?? next()
  }, { prepend: true })
}
