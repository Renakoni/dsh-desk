import Schema from '@deepseek-ai/schemastery'
import { agentErrorEvent, createBridge, sessionStartEvent } from './bridge.js'

export const name = 'dsh-desk'
export const inject = ['agents', 'sessions', 'approval']

export const Config = Schema.object({
  port: Schema.number().default(17321),
  eventTimeoutMs: Schema.number().default(800),
  permissionCreateTimeoutMs: Schema.number().default(5000),
  permissionWaitTimeoutMs: Schema.number().default(65000),
})

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

  const lifetime = new AbortController()
  const bridge = createBridge(config, lifetime.signal)
  ctx.effect(() => async () => {
    lifetime.abort()
    await bridge.close()
  }, 'dsh-desk: abort loopback requests')

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
