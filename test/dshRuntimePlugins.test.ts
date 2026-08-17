import { describe, expect, it } from "vitest";
import { DshRuntimeSnapshotSet, dshRuntimePluginResources, dshRuntimeSkillResources, isDshRuntimePluginSnapshotFresh, normalizeDshRuntimePluginSnapshot } from "../src/main/dshRuntimePlugins";

describe("DSH runtime plugin inventory", () => {
  it("accepts the complete Loader projection and preserves its order", () => {
    const entries = Array.from({ length: 160 }, (_, index) => ({
      entryId: `root:entry-${index}`,
      configId: `entry-${index}`,
      moduleName: index === 159 ? "third-party-plugin" : `@deepseek-ai/plugin-${index}`,
      ownerPackage: index === 159 ? "third-party-bundle" : "@deepseek-ai/dsh-base",
      componentKey: `root:entry-${index}`,
      baselineEnabled: index % 2 === 0,
      enabled: index % 3 !== 0,
      fiberPhase: "active"
    }));
    const snapshot = normalizeDshRuntimePluginSnapshot({ instanceId: "runtime-1", entries, skills: [] }, 123);
    expect(snapshot).toMatchObject({ instanceId: "runtime-1", receivedAt: 123 });
    expect(snapshot?.entries).toHaveLength(160);
    expect(snapshot?.entries[159].entryId).toBe("root:entry-159");
    const resources = dshRuntimePluginResources(snapshot);
    expect(resources).toEqual([
      expect.objectContaining({ id: "plugin:package:@deepseek-ai/dsh-base", manageable: false, required: true }),
      expect.objectContaining({
        id: "plugin:package:third-party-bundle",
        manageable: true,
        required: false,
        sourceIds: ["plugin:root:entry-159"],
        components: [{
          key: "root:entry-159",
          name: "entry-159",
          moduleName: "third-party-plugin",
          baselineEnabled: false,
          enabled: false,
          manageable: true,
          fiberPhase: "active"
        }]
      })
    ]);
  });

  it("rejects duplicate or malformed entry identities", () => {
    const row = { entryId: "same", configId: "one", moduleName: "demo", enabled: true, fiberPhase: null };
    expect(normalizeDshRuntimePluginSnapshot({ entries: [row, row] })).toBeNull();
    expect(normalizeDshRuntimePluginSnapshot({ entries: [{ ...row, enabled: "yes" }] })).toBeNull();
    expect(normalizeDshRuntimePluginSnapshot({ entries: [{ ...row, componentKey: "same" }] })).toBeNull();
  });

  it("keeps entries without reliable bundle ownership outside resource scheme control", () => {
    const snapshot = normalizeDshRuntimePluginSnapshot({
      entries: [{ entryId: "include", configId: "include", moduleName: "cordis:include", enabled: true, fiberPhase: "active" }]
    });
    expect(dshRuntimePluginResources(snapshot)).toEqual([]);
  });

  it("projects project, custom, bundled, and provider Skills by logical name", () => {
    const snapshot = normalizeDshRuntimePluginSnapshot({
      instanceId: "runtime-1",
      entries: [],
      skills: [
        { name: "project-skill", description: "Project", source: "project-dsh", provider: "skill-filesystem", modelInvocable: true, userInvocable: true, enabled: true },
        { name: "custom-skill", description: "Custom", source: "custom", provider: "skill-filesystem", modelInvocable: true, userInvocable: false, enabled: false },
        { name: "bundled-skill", description: "Bundled", source: "bundled", provider: "bundle", modelInvocable: true, userInvocable: true, enabled: true },
        { name: "provider-skill", description: "Provider", source: "remote", provider: "remote-provider", modelInvocable: false, userInvocable: true, enabled: true }
      ]
    }, 123);

    expect(dshRuntimeSkillResources(snapshot)).toEqual([
      expect.objectContaining({ id: "skill:name:bundled-skill", detail: "bundled - bundle", enabled: true, manageable: true }),
      expect.objectContaining({ id: "skill:name:custom-skill", detail: "custom - skill-filesystem", enabled: false, manageable: true }),
      expect.objectContaining({ id: "skill:name:project-skill", detail: "project-dsh - skill-filesystem", enabled: true, manageable: true }),
      expect.objectContaining({ id: "skill:name:provider-skill", detail: "remote - remote-provider", enabled: true, manageable: true })
    ]);
  });

  it("expires a runtime inventory after the heartbeat window", () => {
    const snapshot = normalizeDshRuntimePluginSnapshot({ entries: [] }, 1_000);
    expect(isDshRuntimePluginSnapshotFresh(snapshot, 15_999)).toBe(true);
    expect(isDshRuntimePluginSnapshotFresh(snapshot, 16_000)).toBe(false);
    expect(isDshRuntimePluginSnapshotFresh(null, 1_000)).toBe(false);
  });

  it("keeps Web and Headless inventories independently across alternating heartbeats", () => {
    const snapshots = new DshRuntimeSnapshotSet();
    const runtime = (instanceId: string, entryId: string, enabled: boolean, receivedAt: number) => normalizeDshRuntimePluginSnapshot({
      instanceId,
      entries: [{ entryId, configId: entryId, moduleName: entryId, enabled, fiberPhase: "active" }],
      skills: []
    }, receivedAt)!;

    snapshots.update(runtime("web", "shared", true, 1_000));
    snapshots.update(runtime("headless", "headless-only", true, 2_000));
    snapshots.update(runtime("web", "shared", false, 3_000));

    expect(snapshots.current(3_000)?.entries).toEqual([
      expect.objectContaining({ entryId: "shared", enabled: false }),
      expect.objectContaining({ entryId: "headless-only", enabled: true })
    ]);
    expect(snapshots.current(17_500)?.entries).toEqual([
      expect.objectContaining({ entryId: "shared", enabled: false })
    ]);
    expect(snapshots.current(18_000)).toBeNull();
  });

  it("projects Web and Headless entries owned by one bundle as one package resource", () => {
    const snapshots = new DshRuntimeSnapshotSet();
    for (const [instanceId, enabled] of [["web", true], ["headless", false]] as const) {
      snapshots.update(normalizeDshRuntimePluginSnapshot({
        instanceId,
        entries: [{
          entryId: `${instanceId}:entry`,
          configId: `${instanceId}-entry`,
          moduleName: `${instanceId}-module`,
          ownerPackage: "shared-bundle",
          enabled,
          fiberPhase: "active"
        }],
        skills: []
      }, 1_000)!);
    }
    expect(dshRuntimePluginResources(snapshots.current(1_000))).toEqual([
      expect.objectContaining({ id: "plugin:package:shared-bundle", enabled: true })
    ]);
  });

  it("unifies one logical component across Web and Headless while preserving mixed defaults", () => {
    const snapshots = new DshRuntimeSnapshotSet();
    snapshots.update(normalizeDshRuntimePluginSnapshot({
      instanceId: "web",
      entries: [{ entryId: "include:shared", configId: "shared", moduleName: "shared-module", ownerPackage: "shared-bundle", componentKey: "include:shared", baselineEnabled: false, enabled: false, fiberPhase: null }]
    }, 1_000)!);
    snapshots.update(normalizeDshRuntimePluginSnapshot({
      instanceId: "headless",
      entries: [{ entryId: "include:shared", configId: "shared", moduleName: "shared-module", ownerPackage: "shared-bundle", componentKey: "include:shared", baselineEnabled: true, enabled: true, fiberPhase: "active" }]
    }, 1_000)!);

    expect(dshRuntimePluginResources(snapshots.current(1_000))[0].components).toEqual([{
      key: "include:shared",
      name: "shared",
      moduleName: "shared-module",
      baselineEnabled: null,
      enabled: false,
      manageable: true,
      fiberPhase: null
    }]);
  });

  it("automatically includes a new internal entry after its bundle is updated", () => {
    const snapshot = normalizeDshRuntimePluginSnapshot({
      entries: ["first", "second", "added-later"].map(configId => ({
        entryId: `include:${configId}`,
        configId,
        moduleName: `${configId}-module`,
        ownerPackage: "aggregate-bundle",
        componentKey: `include:${configId}`,
        baselineEnabled: true,
        enabled: true,
        fiberPhase: "active"
      }))
    });
    expect(dshRuntimePluginResources(snapshot)).toEqual([
      expect.objectContaining({ id: "plugin:package:aggregate-bundle", components: expect.arrayContaining([
        expect.objectContaining({ key: "include:added-later", name: "added-later" })
      ]) })
    ]);
  });
});
