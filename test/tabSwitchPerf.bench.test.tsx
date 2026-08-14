// @vitest-environment jsdom
//
// Tab-switch performance harness.
//
// Reproduces the real "keep-mounted background sections" layout of SettingsApp
// (Sessions / Plugins / Animation / Data all stay mounted under display:none)
// and measures how much React re-render work the background sections do when the
// parent re-renders — the thing that happens on every clock tick, slider drag,
// or unrelated settings change while those sections sit hidden.
//
// It renders the REAL section components and drives three distinct scenarios,
// because a parent re-render is not one thing:
//
//   A. clock tick            — parent re-renders, section props are UNCHANGED.
//   B. unrelated settings save — the `settings` object (and the idleAnim /
//        stateAnimations slices this code reads) get a FRESH identity but an
//        IDENTICAL value. This is what a real save does: `saveSettings` round-
//        trips through IPC, which structured-clones the reply, so shallow
//        identity churns on every save even for an unrelated change.
//   C. real animation edit   — the idleAnim VALUE actually changes each tick
//        (dragging an animation slider).
//
// The win we assert: in A and B all four sections bail; in C only AnimationSection
// (which owns the changed config) re-renders while the other three still bail.
// That is the honest, load-independent fact — measured as re-render COUNTS, which
// don't depend on jsdom's wall-clock. Run twice with an identical file (this
// branch vs. the sections reverted to main) to also see the ms delta.

import { act, cleanup, render } from "@testing-library/react";
import React, { Profiler, useState } from "react";
import { writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SessionsPage } from "../src/renderer/clawd-migrated/components/sessions/SessionsPage";
import { PluginsPage } from "../src/renderer/clawd-migrated/components/plugins/PluginsPage";
import { AnimationSection } from "../src/renderer/clawd-migrated/features/animation/AnimationSection";
import { DataSection } from "../src/renderer/clawd-migrated/features/data/DataSection";
import { I18nProvider } from "../src/renderer/clawd-migrated/useI18n";
import { defaultSettings } from "../src/renderer/shared/events";
import { catalogFromPetPack } from "../src/shared/petThemeCatalog";
import { CLAUDE_PROFILE_SCHEMA_VERSION } from "../src/shared/claudeProfiles";
import { makePackManifest } from "./helpers/packFixtures";

// ---------------------------------------------------------------------------
// Profiling accumulators
// ---------------------------------------------------------------------------
const HEAVY_MS = 0.1; // a commit above this actually re-rendered (vs a memo bailout)
type Acc = { commits: number; heavy: number; ms: number };
const stats = new Map<string, Acc>();
let collecting = false;

function onRender(id: string, _phase: unknown, actualDuration: number) {
  if (!collecting) return;
  const acc = stats.get(id) ?? { commits: 0, heavy: 0, ms: 0 };
  acc.commits += 1;
  if (actualDuration > HEAVY_MS) acc.heavy += 1;
  acc.ms += actualDuration;
  stats.set(id, acc);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const catalog = catalogFromPetPack(makePackManifest());
const initialSettings = {
  ...defaultSettings,
  idleAnim: { enabled: true, selectedSprites: ["idle"], intervalMin: 10, intervalMax: 20, repeatMin: 1, repeatMax: 2 },
  stateAnimations: {}
};
const asyncNoop = async () => {};
const noop = () => {};

// Inventory / session sizes. Default light so this file adds little load to the
// parallel suite; the headline before/after numbers were taken with the repo's
// realistic fixture size via TABPERF_SKILLS=2000 TABPERF_SESSIONS=30.
const SKILLS = Number(process.env.TABPERF_SKILLS ?? 200);
const SESSIONS = Number(process.env.TABPERF_SESSIONS ?? 15);

function makeProfilesSnapshot() {
  const skills = Array.from({ length: SKILLS }, (_, index) => ({
    id: `skill:skill-${index}`,
    kind: "skill" as const,
    name: `skill-${index}`,
    description: `Skill ${index}`,
    enabled: index < 10
  }));
  const base = {
    id: "default",
    name: "Default",
    skills: skills.map(skill => skill.id),
    plugins: ["plugin:review@market"],
    mcpServers: ["mcp:filesystem"],
    isProtected: true,
    createdAt: 1,
    updatedAt: 1
  };
  return {
    schemaVersion: CLAUDE_PROFILE_SCHEMA_VERSION,
    profiles: [base, { ...base, id: "all", name: "All" }, { ...base, id: "focused", name: "Focused", skills: ["skill:skill-100"], isProtected: false }],
    appliedProfileId: "default",
    inventory: {
      skills,
      plugins: [{ id: "plugin:review@market", kind: "plugin", name: "review@market", enabled: true }],
      mcpServers: [{ id: "mcp:filesystem", kind: "mcp", name: "filesystem", enabled: true }],
      scannedAt: 123
    },
    drift: { profileId: "default", isDrifted: false, skills: false, plugins: false, mcpServers: false },
    mcpStatus: "ready" as const
  };
}

function makeSessions() {
  return Array.from({ length: SESSIONS }, (_, index) => ({
    id: `session-${index}`,
    filePath: `~/.claude/projects/proj/session-${index}.jsonl`,
    project: "proj",
    summary: `Session ${index}`,
    firstTimestamp: 1,
    lastTimestamp: 2,
    messageCount: 12,
    sizeBytes: 4096
  }));
}

beforeEach(() => {
  if (typeof globalThis.requestAnimationFrame !== "function") {
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0) as unknown as number;
    globalThis.cancelAnimationFrame = id => clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
  }
  const snapshot = makeProfilesSnapshot();
  Reflect.set(window, "companion", {
    // Sessions
    getClaudeSessions: vi.fn(async () => ({ sessions: makeSessions(), scannedAt: 0, projectsDir: "~/.claude/projects" })),
    getClaudeSessionDetail: vi.fn(async () => ({ messages: [], totalMessages: 0 })),
    resumeClaudeSession: vi.fn(async () => ({ ok: true })),
    // Plugins
    getClaudeProfiles: vi.fn(async () => snapshot),
    saveClaudeProfile: vi.fn(async () => ({ ok: true })),
    applyClaudeProfile: vi.fn(async () => ({ ok: true })),
    deleteClaudeProfile: vi.fn(async () => ({ ok: true })),
    setClaudeProfileResourceState: vi.fn(async () => ({ ok: true })),
    // Animation
    previewPetAnimation: vi.fn(async () => true),
    // Data
    getDataDirectory: vi.fn(async () => "~/.chara-desk"),
    openDataDirectory: vi.fn(async () => ({ ok: true })),
    getTokenStats: vi.fn(async () => null)
  });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "companion");
  stats.clear();
  collecting = false;
});

// The keep-mounted layout: a parent that holds a clock (`now`) and the live
// `settings` object with all four background sections mounted below it, each
// behind a Profiler. The parent re-renders when EITHER changes; the props each
// section receives are exactly what the real shell passes — note PluginsPage /
// Sessions / Data receive only primitive slices, and AnimationSection receives
// the whole `settings` (guarded by a value-comparator).
let bumpClock: () => void = () => {};
let mutateSettings: (updater: (prev: typeof initialSettings) => typeof initialSettings) => void = () => {};
function Harness() {
  const [now, setNow] = useState(0);
  const [settings, setSettings] = useState(initialSettings);
  bumpClock = () => setNow(value => value + 1);
  mutateSettings = updater => setSettings(prev => updater(prev));
  return (
    <Profiler id="root" onRender={onRender}>
      <div className="section-content">
        <span data-testid="clock">{now}</span>
        <Profiler id="sessions" onRender={onRender}>
          <div style={{ display: "none" }}><SessionsPage active={false} hideSensitiveContent={settings.hideSensitiveContent} /></div>
        </Profiler>
        <Profiler id="plugins" onRender={onRender}>
          <div style={{ display: "none" }}><PluginsPage active={false} hideSensitiveContent={settings.hideSensitiveContent} /></div>
        </Profiler>
        <Profiler id="animation" onRender={onRender}>
          <div style={{ display: "none" }}><AnimationSection active={false} settings={settings} updateSettings={noop} catalog={catalog} spritesheet={null} /></div>
        </Profiler>
        <Profiler id="data" onRender={onRender}>
          <div style={{ display: "none" }}>
            <DataSection persistedStats={null} hideSensitiveContent={settings.hideSensitiveContent} onResetStats={asyncNoop} />
          </div>
        </Profiler>
      </div>
    </Profiler>
  );
}

const SECTION_IDS = ["sessions", "plugins", "animation", "data"] as const;

type ScenarioResult = {
  label: string;
  root: Acc;
  sections: Array<{ id: string; reRenders: number; perTickMs: number }>;
};

function collectScenario(label: string, ticks: number, driveOnce: () => void): ScenarioResult {
  stats.clear();
  collecting = true;
  for (let i = 0; i < ticks; i += 1) act(() => driveOnce());
  collecting = false;
  const root = stats.get("root") ?? { commits: 0, heavy: 0, ms: 0 };
  const sections = SECTION_IDS.map(id => {
    const acc = stats.get(id) ?? { commits: 0, heavy: 0, ms: 0 };
    return { id, reRenders: acc.heavy, perTickMs: Number((acc.ms / ticks).toFixed(4)) };
  });
  return { label, root, sections };
}

function sectionOf(scenario: ScenarioResult, id: string) {
  return scenario.sections.find(section => section.id === id)!;
}

function totalReRenders(scenario: ScenarioResult) {
  return scenario.sections.reduce((sum, section) => sum + section.reRenders, 0);
}

describe("tab-switch keep-mounted re-render cost", () => {
  it("bails the background sections on clock ticks and unrelated saves, and re-renders only the section whose config changed", async () => {
    const WARMUP = 20;
    const TICKS = 120;
    // BEFORE (unmemoized / whole-settings props) re-renders heavy sections on
    // every tick, so give both runs generous headroom past the 5s default.

    render(
      <I18nProvider initialLocale="en">
        <Harness />
      </I18nProvider>
    );

    // Let every section finish its mount data-load and settle.
    for (let i = 0; i < 4; i += 1) {
      await act(async () => { await Promise.resolve(); });
    }
    // Warm up the JIT / React internals with harmless clock ticks.
    for (let i = 0; i < WARMUP; i += 1) act(() => bumpClock());

    // A. Parent clock tick — section props unchanged.
    const clock = collectScenario("clock-tick", TICKS, () => bumpClock());

    // B. Unrelated settings save — the whole settings object AND the read slices
    // get a fresh identity every tick (as an IPC-cloned reply would), but their
    // VALUE is unchanged and hideSensitiveContent doesn't flip.
    const unrelated = collectScenario("unrelated-settings-save", TICKS, () =>
      mutateSettings(prev => ({ ...prev, idleAnim: { ...prev.idleAnim }, stateAnimations: { ...prev.stateAnimations } }))
    );

    // C. Real animation edit — idleAnim's VALUE changes every tick (slider drag).
    const animEdit = collectScenario("animation-edit", TICKS, () =>
      mutateSettings(prev => ({
        ...prev,
        idleAnim: { ...prev.idleAnim, intervalMin: prev.idleAnim.intervalMin === 10 ? 11 : 10 }
      }))
    );

    const scenarios = [clock, unrelated, animEdit];
    const report = {
      ticks: TICKS,
      scenarios: scenarios.map(scenario => ({
        label: scenario.label,
        rootPerTickMs: Number((scenario.root.ms / TICKS).toFixed(4)),
        sections: scenario.sections.map(section => ({
          id: section.id,
          reRendersOutOf: `${section.reRenders}/${TICKS}`,
          perTickMs: section.perTickMs
        }))
      }))
    };
    // eslint-disable-next-line no-console
    console.log("\n=== TABPERF ===\n" + JSON.stringify(report, null, 2) + "\n");
    // Only persist when a caller explicitly asks (the before/after comparison
    // runs) so a normal `npm test` never litters the repo with a JSON artifact.
    if (process.env.TABPERF_OUT) {
      try {
        writeFileSync(process.env.TABPERF_OUT, JSON.stringify(report, null, 2));
      } catch {
        /* best-effort; the console log is the source of truth */
      }
    }

    // Sanity: the harness really mounted the sections and really ticked.
    expect(clock.root.commits).toBe(TICKS);
    expect(unrelated.root.commits).toBe(TICKS);
    expect(animEdit.root.commits).toBe(TICKS);

    // A — clock tick: every keep-mounted section bails.
    expect(totalReRenders(clock)).toBeLessThan(TICKS / 2);

    // B — unrelated save: the narrowed PluginsPage prop (a primitive boolean) and
    // the AnimationSection value-comparator must both bail despite the fresh
    // identities. This is the regression guard for the memoization: without the
    // narrowing/comparator these two would re-render on all 120 ticks.
    expect(sectionOf(unrelated, "plugins").reRenders).toBeLessThan(TICKS / 2);
    expect(sectionOf(unrelated, "animation").reRenders).toBeLessThan(TICKS / 2);
    expect(totalReRenders(unrelated)).toBeLessThan(TICKS / 2);

    // C — real animation edit: AnimationSection owns the changed config, so it
    // MUST re-render; the three unrelated sections must NOT. This proves the memo
    // is selective, not a blanket "never re-render" that would ship stale UI.
    expect(sectionOf(animEdit, "animation").reRenders).toBeGreaterThan(TICKS / 2);
    expect(sectionOf(animEdit, "plugins").reRenders).toBeLessThan(TICKS / 2);
    expect(sectionOf(animEdit, "sessions").reRenders).toBeLessThan(TICKS / 2);
    expect(sectionOf(animEdit, "data").reRenders).toBeLessThan(TICKS / 2);
  }, 120000);
});
