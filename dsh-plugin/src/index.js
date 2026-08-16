import Schema from '@deepseek-ai/schemastery'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { agentErrorEvent, createBridge, sessionStartEvent } from './bridge.js'

export const name = 'dsh-desk'
export const inject = ['agents', 'sessions', 'approval', 'loader', 'skills']

export const Config = Schema.object({
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

export function loaderInventory(loader) {
  const entries = []
  for (const entry of loader.entries()) {
    if (entry.options.group) continue
    entries.push({
      entryId: entry.id,
      configId: entry.options.id,
      moduleName: entry.options.name,
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

export async function applyDesiredPluginStates(loader, desired) {
  for (const entry of loader.entries()) {
    if (entry.options.group) continue
    if (entry.options.name.startsWith('@deepseek-ai/') || entry.options.name === 'dsh-desk-plugin' || entry.options.id === 'dsh-desk') continue
    const enabled = desired[entry.id]
    if (typeof enabled !== 'boolean' || enabled === !entry.disabled) continue
    await entry.parent.tree.update(entry.options.id, { disabled: !enabled })
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
  positiveSafeInteger('port', config.port, 65535)
  positiveSafeInteger('eventTimeoutMs', config.eventTimeoutMs)
  positiveSafeInteger('permissionCreateTimeoutMs', config.permissionCreateTimeoutMs)
  positiveSafeInteger('permissionWaitTimeoutMs', config.permissionWaitTimeoutMs)
  positiveSafeInteger('inventoryPublishMs', config.inventoryPublishMs)

  const lifetime = new AbortController()
  const bridge = createBridge(config, lifetime.signal)
  const instanceId = randomUUID()
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
        ...loaderInventory(ctx.loader),
        skills: agentSkillInventory(agentPolicies.values()),
      })
      const desiredSkills = desiredStates(response, 'desiredSkills')
      const desiredPlugins = desiredStates(response, 'desiredPlugins')
      const receivedPolicy = normalizeSkillPolicy(response?.skillPolicy)
        ?? (desiredSkills ? normalizeSkillPolicy({ defaultEnabled: true, states: desiredSkills }) : null)
      if (receivedPolicy) {
        skillPolicy = receivedPolicy
        for (const policy of agentPolicies.values()) policy.update(skillPolicy)
      }
      if (desiredPlugins) await applyDesiredPluginStates(ctx.loader, desiredPlugins)
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
  ctx.on('loader/partial-dispose', scheduleInventory)

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
