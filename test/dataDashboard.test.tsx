// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataSection } from "../src/renderer/clawd-migrated/features/data/DataSection";
import { I18nProvider } from "../src/renderer/clawd-migrated/useI18n";
import { defaultStats } from "../src/renderer/shared/events";

const sessionPath = "C:\\Users\\test\\.dsh\\sessions\\--demo--\\session-one\\session.jsonl.zstd";
const revealDshSession = vi.fn(async () => true);

function tokenStats() {
  return {
    sessions: [],
    daily: [],
    modelTotals: [{ model: "deepseek-v4-flash", totalTokens: 17_200, costUsd: 0.0034, requestCount: 1, cacheHitRatio: 0.5, priced: true }],
    dailyTotals: [],
    projectTotals: [],
    recentRequests: [{ id: "request-one", sessionId: "session-one", filePath: sessionPath, projectName: "demo", model: "deepseek-v4-flash", timestamp: Date.now(), inputTokens: 17_000, outputTokens: 200, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 17_200, costUsd: 0.0034, priced: true }],
    totalTokens: 17_200,
    totalCostUsd: 0.0034,
    totalSessions: 1,
    totalRequests: 1,
    cacheHitRatio: 0.5,
    pricing: { source: "deepseek-official", sources: ["deepseek-official"], updatedAt: Date.now(), stale: false },
    exchangeRates: { base: "USD", rates: { CNY: 6.744, USD: 1, EUR: 0.867 }, source: "exchange-api", updatedAt: Date.now(), stale: false },
    lastScannedAt: Date.now(),
    scanning: false
  };
}

function analyticsSnapshot() {
  const today = new Date().toLocaleDateString("en-CA");
  return {
    totals: { events: 64, sessions: 1, turns: 1, steps: 16, toolCalls: 46, failedToolCalls: 2, permissionRequests: 1, permissionApproved: 1, permissionDenied: 0, llmMs: 228_611, toolMs: 646_116, ttftMs: 42_147, ttftSteps: 16, decodeMs: 186_464, decodeTokens: 24_725 },
    daily: [{ date: today, events: 64, sessions: 1, turns: 1, steps: 16, toolCalls: 46, failedToolCalls: 2, permissionRequests: 1, permissionApproved: 1, permissionDenied: 0, totalTokens: 600_047, llmMs: 228_611, toolMs: 646_116 }],
    tools: [{ name: "edit", calls: 46, errors: 2, durationMs: 92_000 }],
    sessions: [{
      sessionId: "session-one",
      title: "Tool capability investigation",
      filePath: sessionPath,
      projectPath: "C:\\work\\demo",
      projectName: "demo",
      provider: "deepseek-official",
      model: "deepseek-v4-flash",
      createdAt: Date.now() - 60_000,
      lastActivity: Date.now(),
      durationMs: 60_000,
      turns: 1,
      steps: 16,
      toolCalls: 46,
      failedToolCalls: 2,
      llmMs: 228_611,
      toolMs: 646_116,
      ttftMs: 42_147,
      ttftSteps: 16,
      decodeMs: 186_464,
      decodeTokens: 24_725,
      inputTokens: 35_290,
      outputTokens: 24_725,
      cacheReadTokens: 540_032,
      cacheWriteTokens: 0,
      contextWindow: 1_000_000,
      projectedTokens: 48_515
    }],
    hourlyActivity: new Array(24).fill(0).map((_, hour) => hour === 10 ? 64 : 0),
    dailyHourlyActivity: { [today]: new Array(24).fill(0).map((_, hour) => hour === 10 ? 64 : 0) },
    dailyToolUsage: { [today]: { edit: 46 } },
    dailyTools: { [today]: [{ name: "edit", calls: 46, errors: 2, durationMs: 646_116 }] },
    sessionRoot: "C:\\Users\\test\\.dsh\\sessions",
    lastScannedAt: Date.now()
  };
}

beforeEach(() => {
  localStorage.clear();
  revealDshSession.mockClear();
  Reflect.set(window, "companion", {
    getDataDirectory: vi.fn(async () => "C:\\Users\\test\\AppData\\Roaming\\dsh-desk"),
    openDataDirectory: vi.fn(async () => ({ ok: true })),
    revealDshSession,
    getTokenStats: vi.fn(async () => tokenStats()),
    getDshAnalytics: vi.fn(async () => analyticsSnapshot()),
    getRecentEdits: vi.fn(async () => ({
      edits: [{
        id: "edit-one",
        sessionFilePath: sessionPath,
        filePath: "C:\\work\\demo\\src\\app.ts",
        projectName: "demo",
        op: "update",
        addedLines: 3,
        removedLines: 1,
        timestamp: Date.now()
      }],
      totalEdits: 1,
      totalFiles: 1,
      lastScannedAt: Date.now()
    })),
  });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  Reflect.deleteProperty(window, "companion");
});

function renderDashboard() {
  return render(
    <I18nProvider initialLocale="en">
      <DataSection persistedStats={structuredClone(defaultStats)} hideSensitiveContent={false} onResetStats={async () => undefined} />
    </I18nProvider>
  );
}

describe("data dashboard order and disclosure", () => {
  it("keeps the continuous order and separates runtime from tool statistics", async () => {
    const view = renderDashboard();

    expect(Array.from(view.container.querySelectorAll(".workbench-section-head h2"), heading => heading.textContent)).toEqual([
      "Runtime stats",
      "Token usage",
      "Tool stats",
      "Recent edits",
      "Local data"
    ]);
    expect(view.container.querySelector(".data-view-tabs")).toBeNull();
    expect(await screen.findByText("Total spend")).toBeTruthy();
    expect(screen.getByText("Request heatmap")).toBeTruthy();
    expect(screen.getByText("By model")).toBeTruthy();
    expect(screen.queryByText("Usage rankings")).toBeNull();
    expect(screen.queryByText("DeepSeek Harness")).toBeNull();
    expect(screen.queryByText("Execution trajectories")).toBeNull();
    expect(screen.queryByText("Latest context pressure")).toBeNull();
    expect(screen.getAllByText("¥0.02").length).toBeGreaterThan(0);
    expect(screen.queryByText("$0.00")).toBeNull();

    const runtimePanel = view.container.querySelector(".dsh-runtime-panel") as HTMLElement;
    await waitFor(() => expect(Array.from(runtimePanel.querySelectorAll(".stats-range-metric strong"), metric => metric.textContent)).toEqual(["1", "1", "16", "14m 35s", "3m 49s", "3s"]));
    expect(within(runtimePanel).getAllByRole("tab")).toHaveLength(3);

    const toolPanel = view.container.querySelector(".dsh-tool-stats-panel") as HTMLElement;
    await waitFor(() => expect(Array.from(toolPanel.querySelectorAll(".stats-range-metric strong"), metric => metric.textContent)).toEqual(["46", "2", "95.7%", "10m 46s", "14s"]));
    expect(within(toolPanel).getAllByRole("tab")).toHaveLength(3);
    const toolRanking = within(toolPanel).getByRole("button", { name: /Tool usage ranking/ });
    expect(toolRanking.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toolRanking);
    expect(toolPanel.querySelector(".trajectory-tool-row code")?.textContent).toBe("edit");

    const recentSessions = within(runtimePanel).getByRole("button", { name: /Recent sessions/ });
    expect(recentSessions.getAttribute("aria-expanded")).toBe("false");
    expect(within(runtimePanel).queryByText("Tool capability investigation")).toBeNull();
    fireEvent.click(recentSessions);
    expect(await within(runtimePanel).findByText("Tool capability investigation")).toBeTruthy();
    fireEvent.click(within(runtimePanel).getByRole("button", { name: "Reveal session log" }));
    expect(revealDshSession).toHaveBeenLastCalledWith(sessionPath);

    const editSection = screen.getByRole("heading", { name: "Recent edits" }).closest(".workbench-section") as HTMLElement;
    fireEvent.click(await within(editSection).findByRole("button", { name: "Reveal session log" }));
    expect(revealDshSession).toHaveBeenCalledTimes(2);
    expect(revealDshSession).toHaveBeenLastCalledWith(sessionPath);
  });
});
