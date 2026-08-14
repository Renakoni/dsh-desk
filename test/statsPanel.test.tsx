// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { DshAnalyticsSnapshot } from "../src/shared/dshAnalytics";
import { StatsPanel } from "../src/renderer/clawd-migrated/components/StatsPanel";
import { I18nProvider } from "../src/renderer/clawd-migrated/useI18n";

afterEach(cleanup);

function dateKey(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function snapshot(overrides: Partial<DshAnalyticsSnapshot> = {}): DshAnalyticsSnapshot {
  const now = Date.now();
  const today = dateKey(now);
  const totals = { events: 10, sessions: 2, turns: 5, steps: 9, toolCalls: 7, failedToolCalls: 1, permissionRequests: 0, permissionApproved: 0, permissionDenied: 0, llmMs: 2_000, toolMs: 1_000, ttftMs: 500, ttftSteps: 2, decodeMs: 1_000, decodeTokens: 20 };
  return {
    totals,
    daily: [{ date: today, events: 10, sessions: 1, turns: 3, steps: 6, toolCalls: 7, failedToolCalls: 1, permissionRequests: 0, permissionApproved: 0, permissionDenied: 0, totalTokens: 100, llmMs: 2_000, toolMs: 1_000 }],
    tools: [],
    sessions: [{ sessionId: "one", title: "Today", filePath: "one", projectName: "demo", provider: "deepseek", model: "flash", createdAt: now - 1_000, lastActivity: now, durationMs: 1_000, turns: 3, steps: 6, toolCalls: 7, failedToolCalls: 1, llmMs: 2_000, toolMs: 1_000, ttftMs: 500, ttftSteps: 2, decodeMs: 1_000, decodeTokens: 20, inputTokens: 80, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 }],
    hourlyActivity: new Array(24).fill(0),
    dailyHourlyActivity: { [today]: new Array(24).fill(0) },
    dailyToolUsage: {},
    dailyTools: {},
    sessionRoot: "sessions",
    lastScannedAt: now,
    ...overrides
  };
}

function panel(data: DshAnalyticsSnapshot) {
  return <I18nProvider initialLocale="zh"><StatsPanel snapshot={data} /></I18nProvider>;
}

function metricValues(): (string | null)[] {
  return Array.from(document.querySelectorAll(".runtime-range-metrics strong")).map(element => element.textContent);
}

describe("StatsPanel runtime ranges", () => {
  it("uses trajectory performance totals and refreshes memoized all-range values", () => {
    const view = render(panel(snapshot()));
    fireEvent.click(screen.getAllByRole("tab")[2]);
    expect(metricValues()).toEqual(["2", "5", "9", "3s", "2s", "250ms"]);

    view.rerender(panel(snapshot({ totals: { events: 12, sessions: 3, turns: 8, steps: 13, toolCalls: 9, failedToolCalls: 0, permissionRequests: 0, permissionApproved: 0, permissionDenied: 0, llmMs: 4_000, toolMs: 1_000, ttftMs: 900, ttftSteps: 3, decodeMs: 2_000, decodeTokens: 50 } })));
    expect(metricValues()).toEqual(["3", "8", "13", "5s", "4s", "300ms"]);
  });
});
