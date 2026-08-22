import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const packageManifest = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))

function loadClientPlugin(SlotRegistry) {
  let registration
  const window = { __ModuleLoader__: { load(value) { registration = value } } }
  vm.runInNewContext(readFileSync(fileURLToPath(new URL('../src/client.js', import.meta.url)), 'utf8'), { window })
  assert.equal(registration?.id, 'dsh-desk-plugin')
  return registration.factory(specifier => {
    assert.equal(specifier, '@deepseek-ai/dsh-client-runtime/client')
    return { SlotRegistry }
  })
}

describe('DSH legacy theme client adapter', () => {
  it('exports package metadata for DSH client discovery', () => {
    assert.equal(packageManifest.exports?.['./package.json'], './package.json')
  })

  it('adds a stable key only to legacy keyed settings cards', () => {
    class SlotRegistry {
      register(options) { return options }
    }
    const plugin = loadClientPlugin(SlotRegistry)
    let dispose
    plugin.apply({ effect(effect) { dispose = effect(); return dispose } })
    const slots = new SlotRegistry()
    assert.equal(slots.register({ name: 'settings.plugin.item', id: 'aqua' }).key, 'legacy:aqua')
    assert.equal(slots.register({ name: 'settings.plugin.item', key: 'native' }).key, 'native')
    assert.equal(slots.register({ name: 'settings.general.item', id: 'aqua' }).key, undefined)
    dispose?.()
    assert.equal(SlotRegistry.prototype.register({ name: 'settings.plugin.item', id: 'aqua' }).key, undefined)
  })
})
