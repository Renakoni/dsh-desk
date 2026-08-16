import { describe, expect, it } from "vitest";
import { DshDesiredResourceState } from "../src/main/dshDesiredResourceState";

describe("DSH desired resource state", () => {
  it("uses the scheme as the initial baseline", () => {
    const state = new DshDesiredResourceState();
    expect(state.reconcileScheme({ local: false }, false, { plugin: true })).toEqual({
      skills: { local: false },
      skillDefaultEnabled: false,
      plugins: { plugin: true }
    });
  });

  it("preserves offline live overrides and only fills newly discovered resources", () => {
    const state = new DshDesiredResourceState();
    state.setSkills({ local: true }, false);
    state.setPlugins({ plugin: false });

    expect(state.reconcileScheme({ local: false, runtime: false }, false, { plugin: true, runtimePlugin: true })).toEqual({
      skills: { local: true, runtime: false },
      skillDefaultEnabled: false,
      plugins: { plugin: false, runtimePlugin: true }
    });
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
      plugins: { plugin: true }
    });
  });
});
