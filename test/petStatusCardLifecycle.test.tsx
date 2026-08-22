// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/renderer/App";
import type { PetEvent } from "../src/shared/events";
import { defaultSettings } from "../src/renderer/shared/events";

let emitPetEvent: ((event: PetEvent) => void) | undefined;
let emitPermission: ((request: { id: string; toolName?: string; toolDetail?: string }) => void) | undefined;
let emitSettings: ((settings: typeof defaultSettings) => void) | undefined;

function renderPet(overrides: Partial<typeof defaultSettings> = {}) {
  const settings = { ...defaultSettings, ...overrides };
  Reflect.set(window, "petAPI", {
    onPetEvent: vi.fn((callback: (event: PetEvent) => void) => {
      emitPetEvent = callback;
      return vi.fn();
    })
  });
  Reflect.set(window, "companion", {
    initialState: { settings, petPacks: [] },
    onSettings: vi.fn((callback: typeof emitSettings) => {
      emitSettings = callback;
      return vi.fn();
    }),
    onPreviewPetAnimation: vi.fn(() => vi.fn()),
    onPermissionRequest: vi.fn((callback: typeof emitPermission) => {
      emitPermission = callback;
      return vi.fn();
    }),
    onPermissionResolved: vi.fn(() => vi.fn())
  });
  return render(<App />);
}

beforeEach(() => {
  vi.useFakeTimers();
  emitPetEvent = undefined;
  emitPermission = undefined;
  emitSettings = undefined;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(window, "petAPI");
  Reflect.deleteProperty(window, "companion");
});

describe("pet status card lifecycle", () => {
  it("keeps the idle card visible by default", () => {
    renderPet();
    expect(screen.getByLabelText("Pet status")).toBeTruthy();
    expect(screen.getByText("DSH Desk")).toBeTruthy();
  });

  it("honors the master bubble visibility setting", () => {
    renderPet({ showBubbles: false });
    expect(screen.queryByLabelText("Pet status")).toBeNull();
    expect(document.querySelector(".pet")).toBeTruthy();
  });

  it("applies bubble visibility changes without restarting the pet window", () => {
    renderPet();
    expect(screen.getByLabelText("Pet status")).toBeTruthy();

    act(() => emitSettings?.({ ...defaultSettings, showBubbles: false }));
    expect(screen.queryByLabelText("Pet status")).toBeNull();

    act(() => emitSettings?.({ ...defaultSettings, showBubbles: true }));
    expect(screen.getByLabelText("Pet status")).toBeTruthy();
  });

  it("hides idle initially, then fades a connection card after five seconds", () => {
    renderPet({ hideIdleStatusCard: true });
    expect(screen.queryByLabelText("Pet status")).toBeNull();

    act(() => emitPetEvent?.({
      id: "session-1",
      event: "idle",
      source: "deepseek-harness",
      hook: "agent/session-start",
      title: "DSH is online",
      message: "Ready",
      timestamp: 1
    }));

    expect(screen.getByText("Connected")).toBeTruthy();
    act(() => vi.advanceTimersByTime(4780));
    expect(screen.getByLabelText("Pet status").classList.contains("panel-exiting")).toBe(true);
    act(() => vi.advanceTimersByTime(220));
    expect(screen.queryByLabelText("Pet status")).toBeNull();
    expect(document.querySelector(".pet")).toBeTruthy();
  });

  it("never expires a pending permission request", () => {
    renderPet({ hideIdleStatusCard: true });
    act(() => emitPermission?.({ id: "permission-1", toolName: "Bash", toolDetail: "npm run build" }));
    expect(screen.getByRole("alertdialog", { name: "Permission request" })).toBeTruthy();

    act(() => vi.advanceTimersByTime(120_000));
    expect(screen.getByRole("alertdialog", { name: "Permission request" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Allow" })).toBeTruthy();
  });

  it("keeps errors visible while idle hiding is enabled", () => {
    renderPet({ hideIdleStatusCard: true });
    act(() => emitPetEvent?.({
      id: "error-1",
      event: "error",
      source: "deepseek-harness",
      title: "Tool failed",
      message: "Dependency resolution failed",
      timestamp: 1
    }));

    act(() => vi.advanceTimersByTime(120_000));
    expect(screen.getByText("Tool failed")).toBeTruthy();
    expect(screen.getByText("Dependency resolution failed")).toBeTruthy();
  });
});
