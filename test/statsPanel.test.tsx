// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { StatsPanel } from "../src/renderer/clawd-migrated/components/StatsPanel";
import { I18nProvider } from "../src/renderer/clawd-migrated/useI18n";
import { defaultStats, type AppStats } from "../src/renderer/shared/events";

afterEach(cleanup);

function makeStats(overrides: Partial<AppStats>): AppStats {
  return { ...structuredClone(defaultStats), ...overrides };
}

function panel(stats: AppStats) {
  return (
    <I18nProvider initialLocale="zh">
      <StatsPanel stats={stats} />
    </I18nProvider>
  );
}

// Range-metric values in render order: events, toolCalls, sessions, permissionRequests, errors.
function metricValues(): (string | null)[] {
  return Array.from(document.querySelectorAll(".stats-range-metric strong")).map(el => el.textContent);
}

describe("StatsPanel aggregates", () => {
  it("computes all-range totals and refreshes them when stats change (memoized, never stale)", () => {
    const first = makeStats({
      toolUsage: { Read: 2, Edit: 3 }, // 5
      eventTypeCounts: { tool_start: 10 }, // 10
      totalSessions: 3,
      permissionRequests: 2,
      errorCount: 1
    });
    const view = render(panel(first));

    // Third range tab is "all" → the row metrics are the whole-dataset aggregates,
    // and this branch is date-independent (no today/7d filtering), so it's stable.
    fireEvent.click(screen.getAllByRole("tab")[2]);
    expect(metricValues()).toEqual(["10", "5", "3", "2", "1"]);

    // A fresh stats snapshot (as the 5s tick delivers) must bust the memos: if the
    // dependency arrays were wrong these values would stay stale.
    const next = makeStats({
      toolUsage: { Read: 100 }, // 100
      eventTypeCounts: { tool_start: 42 }, // 42
      totalSessions: 9,
      permissionRequests: 7,
      errorCount: 4
    });
    view.rerender(panel(next));
    expect(metricValues()).toEqual(["42", "100", "9", "7", "4"]);
  });
});
