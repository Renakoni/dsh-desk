import { describe, expect, it } from "vitest";
import { dshRuntimePluginResources, isDshRuntimePluginSnapshotFresh, normalizeDshRuntimePluginSnapshot } from "../src/main/dshRuntimePlugins";

describe("DSH runtime plugin inventory", () => {
  it("accepts the complete Loader projection and preserves its order", () => {
    const entries = Array.from({ length: 160 }, (_, index) => ({
      entryId: `root:entry-${index}`,
      configId: `entry-${index}`,
      moduleName: index === 159 ? "third-party-plugin" : `@deepseek-ai/plugin-${index}`,
      enabled: index % 3 !== 0,
      fiberPhase: "active"
    }));
    const snapshot = normalizeDshRuntimePluginSnapshot({ entries }, 123);
    expect(snapshot).toMatchObject({ receivedAt: 123 });
    expect(snapshot?.entries).toHaveLength(160);
    expect(snapshot?.entries[159].entryId).toBe("root:entry-159");
    const resources = dshRuntimePluginResources(snapshot);
    expect(resources[0]).toMatchObject({ manageable: false, required: true });
    expect(resources[159]).toMatchObject({ id: "plugin:root:entry-159", manageable: true });
  });

  it("rejects duplicate or malformed entry identities", () => {
    const row = { entryId: "same", configId: "one", moduleName: "demo", enabled: true, fiberPhase: null };
    expect(normalizeDshRuntimePluginSnapshot({ entries: [row, row] })).toBeNull();
    expect(normalizeDshRuntimePluginSnapshot({ entries: [{ ...row, enabled: "yes" }] })).toBeNull();
  });

  it("expires a runtime inventory after the heartbeat window", () => {
    const snapshot = normalizeDshRuntimePluginSnapshot({ entries: [] }, 1_000);
    expect(isDshRuntimePluginSnapshotFresh(snapshot, 15_999)).toBe(true);
    expect(isDshRuntimePluginSnapshotFresh(snapshot, 16_000)).toBe(false);
    expect(isDshRuntimePluginSnapshotFresh(null, 1_000)).toBe(false);
  });
});
