/*
 * Browser half of dsh-desk-plugin. This is intentionally a small classic
 * bundle: DSH's client module table executes package client exports as a
 * window.__ModuleLoader__ registration, while the Host half remains ESM.
 */
window.__ModuleLoader__.load({
  id: "dsh-desk-plugin",
  factory: (require) => {
    const { SlotRegistry } = require("@deepseek-ai/dsh-client-runtime/client")
    const marker = Symbol.for("dsh-desk.legacy-keyed-settings-adapter")
    const original = SlotRegistry.prototype.register
    let patched = original
    if (!original[marker]) {
      patched = function registerWithLegacySettingsSupport(options, component) {
        if (options && typeof options === "object"
          && options.name === "settings.plugin.item"
          && options.key === undefined
          && typeof options.id === "string"
          && options.id !== "") {
          options = { ...options, key: `legacy:${options.id}` }
        }
        return original.call(this, options, component)
      }
      Object.defineProperty(patched, marker, { value: true })
      SlotRegistry.prototype.register = patched
    }
    return {
      name: "dsh-desk-plugin/client",
      inject: ["slots"],
      apply(ctx) {
        ctx.effect(() => () => {
          if (SlotRegistry.prototype.register === patched) SlotRegistry.prototype.register = original
        }, "dsh-desk: legacy plugin settings slot adapter")
      },
    }
  },
})
