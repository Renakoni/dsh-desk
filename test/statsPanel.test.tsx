// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DshAnalyticsSnapshot } from "../src/shared/dshAnalytics";
import { StatsPanel } from "../src/renderer/clawd-migrated/components/StatsPanel";
import type { AppStats } from "../src/renderer/shared/events";
import { I18nProvider } from "../src/renderer/clawd-migrated/useI18n";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

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
    daily: [{ date: today, events: 10, sessions: 1, turns: 3, steps: 6, toolCalls: 7, failedToolCalls: 1, permissionRequests: 0, permissionApproved: 0, permissionDenied: 0, totalTokens: 100, llmMs: 2_000, toolMs: 1_000, ttftMs: 500, ttftSteps: 2, decodeMs: 1_000, decodeTokens: 20 }],
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

function appStats(overrides: Partial<AppStats> = {}): AppStats {
  const now = Date.now();
  const today = dateKey(now);
  return {
    toolUsage: {},
    eventTypeCounts: { dsh: 3 },
    totalSessions: 1,
    dailyStats: { [today]: { events: 3, toolCalls: 0, sessions: 1, errors: 0, permissionRequests: 0 } },
    errorCount: 0,
    permissionRequests: 0,
    permissionApproved: 0,
    permissionDenied: 0,
    totalRuntime: 3_000,
    hourlyActivity: new Array(24).fill(0),
    dailyHourlyActivity: { [today]: new Array(24).fill(0) },
    dailyToolUsage: { [today]: { edit: 7 } },
    firstStartTime: now - 3_000,
    lastEventTime: now,
    ...overrides
  };
}

function panel(data: DshAnalyticsSnapshot, stats = appStats()) {
  return <I18nProvider initialLocale="zh"><StatsPanel stats={stats} snapshot={data} /></I18nProvider>;
}

function metricValues(): (string | null)[] {
  return Array.from(document.querySelectorAll(".stats-count-metrics strong")).map(element => element.textContent);
}

function performanceValues(): (string | null)[] {
  return Array.from(document.querySelectorAll(".stats-performance-value strong")).map(element => element.textContent);
}

describe("StatsPanel runtime ranges", () => {
  it("preserves original runtime metrics and adds translated trajectory performance", () => {
    const view = render(panel(snapshot()));
    expect(screen.getByText("累计运行")).toBeTruthy();
    expect(screen.getByText(/活跃天数/)).toBeTruthy();
    expect(screen.getByText(/日均调用/)).toBeTruthy();
    expect(Array.from(document.querySelectorAll(".stats-count-metrics .stats-range-metric > span"), element => element.textContent)).toEqual([
      "事件",
      "工具调用",
      "会话",
      "权限请求",
      "错误次数"
    ]);
    expect(Array.from(document.querySelectorAll(".stats-performance-value > span"), element => element.textContent)).toEqual([
      "对话轮次",
      "执行步骤",
      "处理总耗时",
      "模型响应耗时",
      "平均首字延迟",
      "生成速度"
    ]);
    expect(metricValues()).toEqual(["10", "7", "1", "0", "1"]);
    expect(performanceValues()).toEqual(["3", "6", "3 秒", "2 秒", "250 ms", "20.0 token/秒"]);
    expect(screen.queryByText(/次采样|samples/)).toBeNull();
    expect(screen.queryByText("运行性能")).toBeNull();
    expect(screen.getAllByText("今日")).toHaveLength(1);
    expect(screen.queryByText("最近会话")).toBeNull();

    fireEvent.click(screen.getAllByRole("tab")[2]);
    expect(metricValues()).toEqual(["10", "7", "2", "0", "1"]);
    expect(performanceValues()).toEqual(["5", "9", "3 秒", "2 秒", "250 ms", "20.0 token/秒"]);

    view.rerender(panel(
      snapshot({ totals: { events: 12, sessions: 3, turns: 8, steps: 13, toolCalls: 9, failedToolCalls: 0, permissionRequests: 0, permissionApproved: 0, permissionDenied: 0, llmMs: 4_000, toolMs: 1_000, ttftMs: 900, ttftSteps: 3, decodeMs: 2_000, decodeTokens: 50 } }),
      appStats()
    ));
    expect(metricValues()).toEqual(["12", "9", "3", "0", "0"]);
    expect(performanceValues()).toEqual(["8", "13", "5 秒", "4 秒", "300 ms", "25.0 token/秒"]);
  });

  it("updates cumulative runtime once per second between persisted snapshots", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T12:00:00Z"));
    render(panel(snapshot(), appStats({ totalRuntime: 1_090_000 })));
    const totalRuntime = screen.getByText("累计运行").parentElement?.querySelector("strong");
    expect(totalRuntime?.textContent).toBe("18 分 10 秒");

    act(() => vi.advanceTimersByTime(1_000));
    expect(totalRuntime?.textContent).toBe("18 分 11 秒");

    act(() => vi.advanceTimersByTime(1_000));
    expect(totalRuntime?.textContent).toBe("18 分 12 秒");
  });
});
