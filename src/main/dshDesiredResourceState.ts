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
  private skillsInitialized = false;
  private pluginsInitialized = false;

  isSkillsInitialized(): boolean {
    return this.skillsInitialized;
  }

  isPluginsInitialized(): boolean {
    return this.pluginsInitialized;
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
    this.skillsInitialized = true;
  }

  setPlugins(states: Readonly<Record<string, boolean>>): void {
    this.plugins = { ...states };
    this.pluginsInitialized = true;
  }

  reconcileScheme(
    skillBaseline: Readonly<Record<string, boolean>>,
    skillDefaultEnabled: boolean,
    pluginBaseline: Readonly<Record<string, boolean>>,
    preservePluginOverrides = true
  ): DshDesiredResourceSnapshot {
    return {
      skills: this.skillsInitialized ? withMissingStates(this.skills, skillBaseline) : { ...skillBaseline },
      skillDefaultEnabled,
      plugins: preservePluginOverrides && this.pluginsInitialized ? withMissingStates(this.plugins, pluginBaseline) : { ...pluginBaseline }
    };
  }
}
