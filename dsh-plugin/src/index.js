import Schema from '@deepseek-ai/schemastery'
import { agentErrorEvent, createBridge, sessionStartEvent } from './bridge.js'

export const name = 'dsh-desk'
export const inject = ['agents', 'sessions', 'approval', 'loader']

export const Config = Schema.object({
  port: Schema.number().default(17321),
  eventTimeoutMs: Schema.number().default(800),
  permissionCreateTimeoutMs: Schema.number().default(5000),
  permissionWaitTimeoutMs: Schema.number().default(65000),
  inventoryPublishMs: Schema.number().default(3000),
})

const FIBER_PHASES = ['pending', 'loading', 'active', 'failed', null, 'unloading']

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

function desiredPluginStates(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (!value.desiredPlugins || typeof value.desiredPlugins !== 'object' || Array.isArray(value.desiredPlugins)) return null
  return value.desiredPlugins
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

function positiveSafeInteger(name, value, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(`dsh-desk: ${name} must be a positive safe integer at most ${maximum}`)
  }
}

export function apply(ctx, config) {
  positiveSafeInteger('port', config.port, 65535)
  positiveSafeInteger('eventTimeoutMs', config.eventTimeoutMs)
  positiveSafeInteger('permissionCreateTimeoutMs', config.permissionCreateTimeoutMs)
  positiveSafeInteger('permissionWaitTimeoutMs', config.permissionWaitTimeoutMs)
  positiveSafeInteger('inventoryPublishMs', config.inventoryPublishMs)

  const lifetime = new AbortController()
  const bridge = createBridge(config, lifetime.signal)
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
      const response = await bridge.publishPluginInventory(loaderInventory(ctx.loader))
      const desired = desiredPluginStates(response)
      if (desired) await applyDesiredPluginStates(ctx.loader, desired)
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
  scheduleInventory()
  ctx.effect(() => async () => {
    if (inventoryTimer !== undefined) clearTimeout(inventoryTimer)
    clearInterval(inventoryInterval)
    lifetime.abort()
    await bridge.close()
  }, 'dsh-desk: abort loopback requests')

  ctx.on('internal/status', scheduleInventory)
  ctx.on('loader/config-update', scheduleInventory)
  ctx.on('loader/entry-init', scheduleInventory)
  ctx.on('loader/partial-dispose', scheduleInventory)

  ctx.on('agent/session-start', ({ agent }) => {
    void bridge.publish(sessionStartEvent(String(agent.session.id)))
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
