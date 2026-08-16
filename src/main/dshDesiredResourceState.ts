export type DshDesiredResourceSnapshot = {
  skills: Record<string, boolean>;
  skillDefaultEnabled: boolean;
  plugins: Record<string, boolean>;
};

function withMissingStates(
  current: Readonly<Record<string, boolean>>,
  baseline: Readonly<Record<string, boolean>>
): Record<string, boolean> {
  const next = { ...current };
  for (const [id, enabled] of Object.entries(baseline)) {
    if (!Object.prototype.hasOwnProperty.call(next, id)) next[id] = enabled;
  }
  return next;
}

export class DshDesiredResourceState {
  private skills: Record<string, boolean> = {};
  private skillDefaultEnabled = true;
  private plugins: Record<string, boolean> = {};
  private initialized = false;

  isInitialized(): boolean {
    return this.initialized;
  }

  current(): DshDesiredResourceSnapshot {
    return {
      skills: { ...this.skills },
      skillDefaultEnabled: this.skillDefaultEnabled,
      plugins: { ...this.plugins }
    };
  }

  setSkills(states: Readonly<Record<string, boolean>>, defaultEnabled: boolean): void {
    this.skills = { ...states };
    this.skillDefaultEnabled = defaultEnabled;
    this.initialized = true;
  }

  setPlugins(states: Readonly<Record<string, boolean>>): void {
    this.plugins = { ...states };
    this.initialized = true;
  }

  reconcileScheme(
    skillBaseline: Readonly<Record<string, boolean>>,
    skillDefaultEnabled: boolean,
    pluginBaseline: Readonly<Record<string, boolean>>
  ): DshDesiredResourceSnapshot {
    if (!this.initialized) {
      return {
        skills: { ...skillBaseline },
        skillDefaultEnabled,
        plugins: { ...pluginBaseline }
      };
    }
    return {
      skills: withMissingStates(this.skills, skillBaseline),
      skillDefaultEnabled,
      plugins: withMissingStates(this.plugins, pluginBaseline)
    };
  }
}
