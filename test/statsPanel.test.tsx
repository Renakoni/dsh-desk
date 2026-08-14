// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { DshAnalyticsSnapshot } from "../src/shared/dshAnalytics";
import { dshAnalyticsToAppStats, StatsPanel } from "../src/renderer/clawd-migrated/components/StatsPanel";
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
  return <I18nProvider initialLocale="zh"><StatsPanel stats={dshAnalyticsToAppStats(data)} snapshot={data} /></I18nProvider>;
}

function runtimeMetricValues(): (string | null)[] {
  return Array.from(document.querySelectorAll(".runtime-range-metrics strong")).map(element => element.textContent);
}

function originalMetricValues(): (string | null)[] {
  return Array.from(document.querySelectorAll(".stats-range-block .stats-range-metric strong")).map(element => element.textContent);
}

describe("StatsPanel runtime ranges", () => {
  it("preserves original runtime metrics and adds translated trajectory performance", () => {
    const view = render(panel(snapshot()));
    expect(screen.getByText("累计运行")).toBeTruthy();
    expect(screen.getByText(/活跃天数/)).toBeTruthy();
    expect(screen.getByText(/日均调用/)).toBeTruthy();
    expect(originalMetricValues()).toEqual(["10", "7", "2", "0", "1"]);
    expect(Array.from(document.querySelectorAll(".runtime-range-metrics span"), element => element.textContent)).toEqual([
      "对话轮次",
      "执行步骤",
      "活跃耗时",
      "模型耗时",
      "平均首字",
      "解码速度"
    ]);
    expect(runtimeMetricValues()).toEqual(["3", "6", "3s", "2s", "250ms", "20.0 tok/s"]);
    expect(screen.queryByText("最近会话")).toBeNull();

    fireEvent.click(screen.getAllByRole("tab")[2]);
    expect(originalMetricValues()).toEqual(["10", "7", "2", "0", "1"]);
    expect(runtimeMetricValues()).toEqual(["5", "9", "3s", "2s", "250ms", "20.0 tok/s"]);

    view.rerender(panel(snapshot({ totals: { events: 12, sessions: 3, turns: 8, steps: 13, toolCalls: 9, failedToolCalls: 0, permissionRequests: 0, permissionApproved: 0, permissionDenied: 0, llmMs: 4_000, toolMs: 1_000, ttftMs: 900, ttftSteps: 3, decodeMs: 2_000, decodeTokens: 50 } })));
    expect(originalMetricValues()).toEqual(["12", "9", "3", "0", "0"]);
    expect(runtimeMetricValues()).toEqual(["8", "13", "5s", "4s", "300ms", "25.0 tok/s"]);
  });
});
