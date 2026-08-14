// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { HookStatus } from "../src/shared/hooks";
import { ConnectionManagement } from "../src/renderer/clawd-migrated/features/settings/ConnectionManagement";
import { I18nProvider } from "../src/renderer/clawd-migrated/useI18n";

// Settings → Connection details offers Repair ONLY in workbench mode when the
// problem is Repair-fixable — the same gate the Overview uses. The mode gate is
// load-bearing: canRepair alone is also true in `error` (an unreadable settings
// file evaluates as an empty config, but repairHooks() reads that same file and
// fails) and in `notConfigured` (a fresh setup should go through Install).

afterEach(cleanup);

const REPAIR_LABEL = "修复配置";

function status(overrides: Partial<HookStatus> = {}): HookStatus {
  const fullyInstalled = overrides.installed === true;
  const profile = (name: "web" | "headless", installed: boolean) => ({
    name,
    configExists: true,
    configReadError: false,
    dependencyRegistered: installed,
    bundleRegistered: installed,
    installed
  });
  return {
    installed: false,
    configExists: true,
    configReadError: false,
    hookCount: 1,
    requiredCount: 2,
    missingEvents: ["headless"],
    commandMatches: false, // needs repair unless a case overrides it
    settingsPath: "C:/users/test/.dsh/profiles",
    bundle: { expectedPath: "C:/app/dsh-desk-plugin.tgz", exists: true },
    npxAvailable: true,
    profiles: fullyInstalled ? [profile("web", true), profile("headless", true)] : [profile("web", true), profile("headless", false)],
    ...overrides
  };
}

function view(hookStatus: HookStatus | null) {
  return render(
    <I18nProvider initialLocale="zh">
      <ConnectionManagement
        hideSensitive={false}
        connection={{ serverListening: true, port: 17321, lastEventAt: null }}
        now={1_000_000}
        hookStatus={hookStatus}
      />
    </I18nProvider>
  );
}

describe("ConnectionManagement Repair gating", () => {
  it("workbench with a repairable command mismatch offers Repair next to the diagnostics", () => {
    view(status());
    expect(screen.getByText(REPAIR_LABEL)).toBeTruthy();
  });

  it("healthy workbench shows no Repair", () => {
    view(status({ installed: true, commandMatches: true }));
    expect(screen.queryByText(REPAIR_LABEL)).toBeNull();
  });

  it("unreadable settings show the error, never a Repair that would read the same broken file", () => {
    view(status({ configReadError: true, hookCount: 0, missingEvents: ["web", "headless"] }));
    expect(screen.getByText(/无法读取 DeepSeek Harness profile/)).toBeTruthy();
    expect(screen.queryByText(REPAIR_LABEL)).toBeNull();
  });

  it("notConfigured (zero hooks) routes through Install, not Repair", () => {
    view(status({ configExists: false, hookCount: 0, missingEvents: ["web", "headless"] }));
    expect(screen.queryByText(REPAIR_LABEL)).toBeNull();
  });

  it("bundle missing in workbench shows no Repair", () => {
    view(status({ bundle: { expectedPath: "C:/app/dsh-desk-plugin.tgz", exists: false } }));
    expect(screen.queryByText(REPAIR_LABEL)).toBeNull();
  });
});
