export type DshDesiredResourceSnapshot = {
  skills: Record<string, boolean>;
  skillDefaultEnabled: boolean;
  plugins: Record<string, boolean>;
  pluginComponents: Record<string, Record<string, boolean>>;
};

function cloneComponentStates(
  states: Readonly<Record<string, Readonly<Record<string, boolean>>>>
): Record<string, Record<string, boolean>> {
  return Object.fromEntries(Object.entries(states).map(([packageName, components]) => [packageName, { ...components }]));
}

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

function withMissingComponentStates(
  current: Readonly<Record<string, Readonly<Record<string, boolean>>>>,
  baseline: Readonly<Record<string, Readonly<Record<string, boolean>>>>
): Record<string, Record<string, boolean>> {
  const next = cloneComponentStates(current);
  const knownKeys = new Set(Object.values(next).flatMap(components => Object.keys(components)));
  for (const [packageName, components] of Object.entries(baseline)) {
    for (const [componentKey, enabled] of Object.entries(components)) {
      if (knownKeys.has(componentKey)) continue;
      next[packageName] ??= {};
      next[packageName][componentKey] = enabled;
      knownKeys.add(componentKey);
    }
  }
  return next;
}

export class DshDesiredResourceState {
  private skills: Record<string, boolean> = {};
  private skillDefaultEnabled = true;
  private plugins: Record<string, boolean> = {};
  private pluginComponents: Record<string, Record<string, boolean>> = {};
  private skillsInitialized = false;
  private pluginsInitialized = false;
  private pluginComponentsInitialized = false;

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
      plugins: { ...this.plugins },
      pluginComponents: cloneComponentStates(this.pluginComponents)
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

  setPluginComponents(states: Readonly<Record<string, Readonly<Record<string, boolean>>>>): void {
    this.pluginComponents = cloneComponentStates(states);
    this.pluginComponentsInitialized = true;
  }

  reconcileScheme(
    skillBaseline: Readonly<Record<string, boolean>>,
    skillDefaultEnabled: boolean,
    pluginBaseline: Readonly<Record<string, boolean>>,
    preservePluginOverrides = true,
    pluginComponentBaseline: Readonly<Record<string, Readonly<Record<string, boolean>>>> = {}
  ): DshDesiredResourceSnapshot {
    return {
      skills: this.skillsInitialized ? withMissingStates(this.skills, skillBaseline) : { ...skillBaseline },
      skillDefaultEnabled,
      plugins: preservePluginOverrides && this.pluginsInitialized ? withMissingStates(this.plugins, pluginBaseline) : { ...pluginBaseline },
      pluginComponents: this.pluginComponentsInitialized
        ? withMissingComponentStates(this.pluginComponents, pluginComponentBaseline)
        : cloneComponentStates(pluginComponentBaseline)
    };
  }
}
