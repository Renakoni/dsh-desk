import { describe, expect, it } from "vitest";
import { DshDesiredResourceState } from "../src/main/dshDesiredResourceState";

describe("DSH desired resource state", () => {
  it("uses the scheme as the initial baseline", () => {
    const state = new DshDesiredResourceState();
    expect(state.reconcileScheme({ local: false }, false, { plugin: true })).toEqual({
      skills: { local: false },
      skillDefaultEnabled: false,
      plugins: { plugin: true },
      pluginComponents: {}
    });
  });

  it("does not initialize plugin directives when only Skill state was restored offline", () => {
    const state = new DshDesiredResourceState();
    state.setSkills({ local: true }, false);

    expect(state.isSkillsInitialized()).toBe(true);
    expect(state.isPluginsInitialized()).toBe(false);
    expect(state.current().plugins).toEqual({});
    expect(state.reconcileScheme({ local: false }, false, { runtimePlugin: true }).plugins).toEqual({
      runtimePlugin: true
    });
  });

  it("preserves offline live overrides and only fills newly discovered resources", () => {
    const state = new DshDesiredResourceState();
    state.setSkills({ local: true }, false);
    state.setPlugins({ plugin: false });

    expect(state.reconcileScheme({ local: false, runtime: false }, false, { plugin: true, runtimePlugin: true })).toEqual({
      skills: { local: true, runtime: false },
      skillDefaultEnabled: false,
      plugins: { plugin: false, runtimePlugin: true },
      pluginComponents: {}
    });
  });

  it("clears stale plugin overrides while a legacy scheme is unresolved", () => {
    const state = new DshDesiredResourceState();
    state.setPlugins({ headless: false, selected: false });

    expect(state.reconcileScheme({}, false, { selected: true }, false).plugins).toEqual({ selected: true });
  });

  it("replacing state for a scheme switch clears prior live overrides", () => {
    const state = new DshDesiredResourceState();
    state.setSkills({ local: true }, false);
    state.setPlugins({ plugin: false });
    state.setSkills({ local: false }, false);
    state.setPlugins({ plugin: true });

    expect(state.current()).toEqual({
      skills: { local: false },
      skillDefaultEnabled: false,
      plugins: { plugin: true },
      pluginComponents: {}
    });
  });

  it("preserves temporary component overrides while filling newly discovered scheme entries", () => {
    const state = new DshDesiredResourceState();
    state.setPluginComponents({ demo: { "include:first": false } });
    expect(state.reconcileScheme({}, true, {}, true, { demo: { "include:second": true } }).pluginComponents).toEqual({
      demo: { "include:first": false, "include:second": true }
    });
  });

  it("replaces temporary component overrides when a scheme is explicitly applied", () => {
    const state = new DshDesiredResourceState();
    state.setPluginComponents({ demo: { "include:first": false } });
    state.setPluginComponents({ demo: { "include:second": true } });

    expect(state.current().pluginComponents).toEqual({
      demo: { "include:second": true }
    });
  });
});
