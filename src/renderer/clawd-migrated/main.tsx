// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Anchor,
  Bell,
  Check,
  CheckCircle2,
  Clipboard,
  Code2,
  Eye,
  EyeOff,
  FileText,
  FlaskConical,
  Gauge,
  KeyRound,
  Minus,
  MonitorCheck,
  MousePointer2,
  Palette,
  PlugZap,
  Radio,
  Search,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Square,
  Terminal,
  Timer,
  Wand2,
  Wrench,
  X
} from "lucide-react";
import type { CompanionEvent, CompanionSettings, FeedbackMode, PetState, PermissionRequest, ToolName, UpdateStatus } from "../shared/events";
import { defaultSettings, defaultStats, stateFromEvent, type EventHistoryEntry, type NotificationRule } from "../shared/events";
import { redactDisplayEvent } from "../../shared/privacy";
import "./styles.css";
import { I18nProvider, useI18n, detectLocale } from "./useI18n";
import { useCompanion, type ToolStream } from "./useCompanion";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { PermissionCard } from "./components/PermissionCard";
import { PluginSpriteLoader } from "./components/PluginSpriteLoader";
import { OverviewSection } from "./features/overview/OverviewSection";
import { SettingsSection } from "./features/settings/SettingsSection";
import { AnimationSection } from "./features/animation/AnimationSection";
import { DataSection } from "./features/data/DataSection";
import { PluginsPage } from "./components/plugins/PluginsPage";
import { DshThemesPage } from "./components/themes/DshThemesPage";
import { connectionSurfaceKey } from "./features/overview/connectionState";
import { useConnectionSurface } from "./features/overview/useConnectionSurface";
import { petAnimationAssets } from "./utils/petAnimationAssets";
import { animationKeyForPetState, normalizeAnimationKey, normalizeAnimationKeys, type PetAnimationKey } from "./utils/petAnimations";
import { keepIdleAnimationConfigReference, type IdleAnimationConfig, planIdleAnimation, startIdleAnimator } from "../state/petIdleAnimator";
import { getPetTheme } from "./utils/petThemes";
import { usePetPacks } from "./usePetPacks";
import { spritesheetAssetsFromPack } from "../../shared/petPackAssets";
import { packIdFromThemeId, resolveThemeCatalog } from "../../shared/petThemeCatalog";

const APP_DISPLAY_NAME = "DSH Desk";

const stateCopy: Record<PetState, { label: string; line: string; tone: string }> = {
  idle: { label: "待机", line: "Clawd 在桌面边缘小憩", tone: "sand" },
  thinking: { label: "思考中", line: "正在整理上下文", tone: "blue" },
  tool_read: { label: "读取", line: "正在看文件", tone: "green" },
  tool_edit: { label: "编辑", line: "正在改代码", tone: "coral" },
  tool_bash: { label: "终端", line: "正在执行命令", tone: "ink" },
  tool_search: { label: "搜索", line: "正在检索线索", tone: "blue" },
  tool_mcp: { label: "MCP", line: "正在调用 MCP 工具", tone: "blue" },
  skill: { label: "技能", line: "正在使用技能", tone: "honey" },
  task: { label: "任务", line: "正在处理任务", tone: "steel" },
  agent: { label: "子代理", line: "正在调用子代理", tone: "steel" },
  waiting_permission: { label: "等待确认", line: "需要你处理一个确认", tone: "honey" },
  done: { label: "完成", line: "这一轮已经处理完", tone: "green" },
  error: { label: "出错", line: "刚才有一步失败了", tone: "coral" }
};

const stateFeedbackMode: Record<PetState, FeedbackMode> = {
  idle: "card",
  thinking: "card",
  tool_read: "thought",
  tool_edit: "card",
  tool_bash: "thought",
  tool_search: "thought",
  tool_mcp: "thought",
  skill: "thought",
  task: "thought",
  agent: "thought",
  waiting_permission: "card",
  done: "card",
  error: "card"
};
const maxSoundMilliseconds = 3000;

function playClippedAudio(dataUrl: string, volume = 1) {
  const audio = new Audio(dataUrl);
  audio.volume = volume;
  const stopTimer = window.setTimeout(() => {
    audio.pause();
    audio.currentTime = 0;
  }, maxSoundMilliseconds);
  audio.addEventListener("ended", () => window.clearTimeout(stopTimer), { once: true });
  void audio.play().catch(() => {
    window.clearTimeout(stopTimer);
  });
}

function getFeedbackMode(event: CompanionEvent): FeedbackMode {
  if (event.tool && event.tool !== "Unknown") return "ribbon";
  return stateFeedbackMode[stateFromEvent(event)] ?? "card";
}

const mappingRows: Array<{ source: string; tool?: string; state: PetState; title: string }> = [
  { source: "SessionStart", state: "thinking", title: "会话开始" },
  { source: "UserPromptSubmit", state: "thinking", title: "收到用户输入" },
  { source: "PreToolUse", tool: "Read / Notebook", state: "tool_read", title: "读取文件" },
  { source: "PreToolUse", tool: "Edit / Write", state: "tool_edit", title: "修改文件" },
  { source: "PreToolUse", tool: "Bash", state: "tool_bash", title: "执行命令" },
  { source: "PreToolUse", tool: "Grep / Glob / WebFetch / WebSearch", state: "tool_search", title: "搜索资料" },
  { source: "PreToolUse", tool: "MCP", state: "tool_mcp", title: "MCP 工具" },
  { source: "PreToolUse", tool: "Skill", state: "skill", title: "技能调用" },
  { source: "PreToolUse", tool: "Task", state: "task", title: "任务处理" },
  { source: "PreToolUse", tool: "Agent", state: "agent", title: "子代理调用" },
  { source: "PreToolUse", tool: "AskUserQuestion", state: "thinking", title: "等待选择" },
  { source: "Notification / idle_prompt", state: "idle", title: "等待输入" },
  { source: "Notification / permission", state: "waiting_permission", title: "等待确认" },
  { source: "Notification / info", state: "idle", title: "信息通知" },
  { source: "Stop", state: "done", title: "处理完成" },
  { source: "转发失败", state: "error", title: "异常提示" }
];

function makeEvent(event: CompanionEvent["event"], source: CompanionEvent["source"], title: string, message: string, tool?: CompanionEvent["tool"]): CompanionEvent {
  return {
    id: crypto.randomUUID(),
    source,
    event,
    tool,
    title,
    message,
    timestamp: Date.now()
  };
}


function PetApp() {
  const { t, locale } = useI18n();
  const { settings, updateSettings, currentEvent, petState, toolStreams, activePermissions, connection, respondToPermission } = useCompanion({ keepEventList: false });
  const editMode = settings.editPosition;
  const dragging = useRef<string | null>(null);
  const dragStart = useRef<{ mx: number; my: number; ox: number; oy: number }>({ mx: 0, my: 0, ox: 0, oy: 0 });
  const offRef = useRef(settings.positionOffsets ?? {});
  const [randomBubble, setRandomBubble] = useState<string | null>(null);
  const [idleAnimConfig, setIdleAnimConfig] = useState<IdleAnimationConfig | null>(settings.idleAnim ?? null);
  const [previewAnimation, setPreviewAnimation] = useState<{ key: string; nonce: number } | null>(null);

  // Git 操作气泡：触发时在 Clawd 头顶弹出，2.2 秒后自动消失
  const [gitToast, setGitToast] = useState<{ id: string; title: string; message: string } | null>(null);
  const gitToastTimer = useRef<number | null>(null);
  useEffect(() => {
    const off = window.companion.onEvent(event => {
      if (event.event !== "git_operation") return;
      if (gitToastTimer.current) window.clearTimeout(gitToastTimer.current);
      const displayEvent = settings.hideSensitiveContent ? redactDisplayEvent(event, locale) : event;
      setGitToast({ id: event.id, title: displayEvent.title, message: displayEvent.message });
      gitToastTimer.current = window.setTimeout(() => setGitToast(null), 2200);
    });
    return () => {
      off();
      if (gitToastTimer.current) window.clearTimeout(gitToastTimer.current);
    };
  }, [locale, settings.hideSensitiveContent]);

  // HTML5 Audio 播放音效
  useEffect(() => {
    const off = window.companion.onPlaySound((dataUrl) => {
      try { playClippedAudio(dataUrl, settings.sound.volume); } catch { /* ignore */ }
    });
    return () => off();
  }, [settings.sound.volume]);

  useEffect(() => {
    const off = window.companion.onPreviewPetAnimation(animationKey => {
      if (animationKey === "__clear_preview") {
        setPreviewAnimation(null);
        return;
      }
      const normalizedKey = normalizeAnimationKey(animationKey, "idle");
      setPreviewAnimation({ key: normalizedKey, nonce: Date.now() });
    });
    return () => off();
  }, []);

  // 同步计算有效待机气泡（渲染时直接计算，避免 useEffect 时序问题）
  const mainIdleSetting = (settings as any).mainClawdIdleAnimation ?? "random";
  const mainIdle = mainIdleSetting === "random" ? "random" : normalizeAnimationKey(mainIdleSetting, "idle");
  // 只检查非退出中的活跃会话，避免 exitingSessions 残留导致 hasActiveSession 误判
  const hasActiveSession = sessions.some(s => s.isActive && !exitingSessions.has(s.sessionId));

  let effectiveIdleBubble: string | null = null;
  if (petState === "idle" && !editMode) {
    if (mainIdle !== "random" && hasActiveSession) {
      effectiveIdleBubble = mainIdle;
    } else if (settings.idleAnim?.enabled && petState === "idle") {
      effectiveIdleBubble = randomBubble;
    }
  }

  // 随机动作只在待机间隔结束后短暂播放；动画测试会暂停调度，
  // 避免预览结束时突然露出后台已经推进到一半的动作。
  useEffect(() => {
    setIdleAnimConfig(previous => keepIdleAnimationConfigReference(previous, settings.idleAnim ?? null));
  }, [settings.idleAnim]);

  useEffect(() => {
    const plan = planIdleAnimation(idleAnimConfig);
    if (!plan || petState !== "idle" || editMode || mainIdle !== "random" || previewAnimation) {
      setRandomBubble(null);
      return;
    }
    return startIdleAnimator(plan, setRandomBubble);
  }, [petState, editMode, idleAnimConfig, mainIdle, previewAnimation]);

  // 同步 effectiveIdleBubble 到设置面板
  useEffect(() => {
    void window.companion.syncIdleBubble(effectiveIdleBubble);
  }, [effectiveIdleBubble]);

  useEffect(() => {
    const selector = editMode
      ? ".edit-zone, .zone-resize, .edge-handle"
      : settings.clickThrough
        ? ".perm-card"
        : ".clawd, .bubble-wrapper, .tool-streams, .permission-card-wrapper, .perm-card";
    let isInteractive = false;
    const setInteractive = (next: boolean) => {
      if (isInteractive === next) return;
      isInteractive = next;
      void window.companion.setPetInteractive(next);
    };
    const handle = (e: MouseEvent) => {
      if (dragging.current) return;
      const target = e.target as HTMLElement;
      setInteractive(!!target.closest(selector));
    };
    const leave = () => setInteractive(false);

    void window.companion.setPetInteractive(false);
    window.addEventListener('mousemove', handle);
    window.addEventListener('mouseleave', leave);
    return () => {
      window.removeEventListener('mousemove', handle);
      window.removeEventListener('mouseleave', leave);
      if (isInteractive) void window.companion.setPetInteractive(false);
    };
  }, [editMode, settings.clickThrough]);

  const offsetsRef = useRef(settings.positionOffsets ?? {});
  const scaleRef = useRef({ clawd: settings.petScale, bubble: settings.feedbackScale, ribbon: settings.feedbackScale, permission: settings.permissionScale });

  useEffect(() => {
    const move = (e: MouseEvent) => {
      const key = dragging.current;
      if (!key) return;
      const { mx, my, ox, oy } = dragStart.current;
      if (key.startsWith("resize-")) {
        const zoneKey = key.slice(7);
        if (zoneKey === "clawd") {
          updateSettings({ petScale: Math.max(0.7, Math.min(1.35, ox + (e.clientX - mx) / 226)) });
        } else if (zoneKey === "bubble") {
          const ns = Math.max(0.6, Math.min(2, oy + (e.clientY - my) / 106));
          updateSettings({ feedbackScale: Math.max(0.75, Math.min(1.35, ns)) });
        } else if (zoneKey === "ribbon") {
          updateSettings({ feedbackScale: Math.max(0.75, Math.min(1.35, ox + (e.clientX - mx) / 144)) });
        } else if (zoneKey === "permission") {
          updateSettings({ permissionScale: Math.max(0.85, Math.min(1.25, ox + (e.clientX - mx) / 240)) });
        } else if (zoneKey.startsWith("edge")) {
          const ws = ox + (e.clientX - mx + e.clientY - my) / 800;
          updateSettings({ viewScale: Math.max(0.7, Math.min(2.5, ws)) });
        }
      } else if (key === "view" || key === "pet") {
        const nx = ox + e.clientX - mx;
        const ny = oy + e.clientY - my;
        const p = offsetsRef.current;
        updateSettings({ positionOffsets: { ...p, view: { x: nx, y: ny } } });
      } else {
        const nx = ox + e.clientX - mx;
        const ny = oy + e.clientY - my;
        const p = offsetsRef.current;
        updateSettings({ positionOffsets: { ...p, [key]: { x: nx, y: ny } } });
      }
    };
    const up = () => { dragging.current = null; };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, []);

  useEffect(() => { offsetsRef.current = settings.positionOffsets ?? {}; }, [settings.positionOffsets]);
  useEffect(() => { scaleRef.current = { clawd: settings.petScale, bubble: settings.feedbackScale, ribbon: settings.feedbackScale, permission: settings.permissionScale }; }, [settings.petScale, settings.feedbackScale, settings.permissionScale]);

  const offsets = settings.positionOffsets ?? {};
  const viewOff = offsets.view ?? { x: 0, y: 0 };

  const permCardRef = useRef<HTMLDivElement>(null);
  const lastPermissionRect = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  useEffect(() => {
    const clearRect = () => {
      if (!lastPermissionRect.current) return;
      lastPermissionRect.current = null;
      void window.companion.updatePermissionCardRect(null);
    };
    if (activePermissions.length === 0) {
      clearRect();
      return;
    }

    let frame = 0;
    const report = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = 0;
        const el = permCardRef.current;
        if (!el) return;
        const { x, y, width, height } = el.getBoundingClientRect();
        const next = { x, y, width, height };
        const prev = lastPermissionRect.current;
        if (prev && Math.abs(prev.x - x) < 1 && Math.abs(prev.y - y) < 1 && Math.abs(prev.width - width) < 1 && Math.abs(prev.height - height) < 1) return;
        lastPermissionRect.current = next;
        void window.companion.updatePermissionCardRect(next);
      });
    };

    report();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(report);
    if (permCardRef.current) observer?.observe(permCardRef.current);
    window.addEventListener("resize", report);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", report);
      clearRect();
    };
  }, [activePermissions[0]?.id, activePermissions[0]?.toolDetail, activePermissions.length, offsets.permission?.x, offsets.permission?.y, settings.permissionScale]);

  const editPreviewEvent = useMemo(
    () => makeEvent("tool_start", "manual", t("pet.editPreviewTitle", "Edit mode preview"), t("pet.editPreviewMessage", "This is where the pet card or bubble is displayed."), "Edit"),
    [t]
  );
  const editPreviewStreams = useMemo(
    () => [{ event: makeEvent("tool_start", "manual", t("pet.toolIndicatorPreviewTitle", "Tool indicator preview"), t("pet.toolIndicatorPreviewMessage", "Preview position for the Edit tool indicator."), "Edit"), exiting: false, slot: 0 }],
    [t]
  );
  const editPreviewPermission = useMemo(
    () => ({ id: "preview", toolName: "Bash" as ToolName, toolDetail: t("pet.permissionPreviewDetail", "Preview permission card position"), timestamp: Date.now(), rawPayload: {} }),
    [t]
  );

  if (!settings.petEnabled) return <main className="pet-stage pet-disabled" />;

  function begin(k: string, e: React.MouseEvent) {
    if (!editMode) return;
    e.stopPropagation();
    dragging.current = k;
    if (k === "view") {
      dragStart.current = { mx: e.clientX, my: e.clientY, ox: viewOff.x, oy: viewOff.y };
    } else {
      dragStart.current = { mx: e.clientX, my: e.clientY, ox: offsets[k as keyof typeof offsets]?.x ?? 0, oy: offsets[k as keyof typeof offsets]?.y ?? 0 };
    }
  }

  function beginResize(k: string, e: React.MouseEvent) {
    if (!editMode) return;
    e.stopPropagation();
    dragging.current = `resize-${k}`;
    if (k.startsWith("edge")) {
      const vs = settings.viewScale ?? settings.petScale;
      dragStart.current = { mx: e.clientX, my: e.clientY, ox: vs, oy: vs };
    } else {
      const s = scaleRef.current;
      dragStart.current = { mx: e.clientX, my: e.clientY, ox: s[k as keyof typeof s] ?? 1, oy: s[k as keyof typeof s] ?? 1 };
    }
  }

  function beginNormalDrag(e: React.MouseEvent) {
    if (editMode || settings.clickThrough) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, input, select, textarea")) return;
    dragging.current = "pet";
    dragStart.current = { mx: e.clientX, my: e.clientY, ox: viewOff.x, oy: viewOff.y };
  }

  if (editMode) {
    const previewEvent = currentEvent ?? editPreviewEvent;
    const previewState = currentEvent ? petState : stateFromEvent(previewEvent);
    const previewStreams = toolStreams.length > 0 ? toolStreams : editPreviewStreams;
    const bubbleMode = getFeedbackMode(previewEvent);
    const cw = Math.round(226 * settings.clawdScale);
    const ch = Math.round(238 * settings.clawdScale);
    const bw = Math.round((bubbleMode === "thought" ? 172 : 234) * 0.75 * settings.feedbackScale);
    const bh = Math.round((bubbleMode === "thought" ? 82 : 124) * 0.75 * settings.feedbackScale);
    const bx = bubbleMode === "thought" ? Math.round(226 - 6 - bw) : -4;
    const by = bubbleMode === "thought" ? 84 : 10;
    const rw = Math.round(144 * settings.feedbackScale);
    const rh = Math.round(144 * settings.feedbackScale);
    const pw = Math.round(240 * settings.permissionScale);
    const ph = Math.round(140 * settings.permissionScale);

    return (
      <main className="pet-stage edit-mode"
        onMouseDown={e => { if (e.target === e.currentTarget) begin("view", e); }}>
        <span className="edge-handle edge-n" onMouseDown={e => beginResize("edgeN", e)} />
        <span className="edge-handle edge-s" onMouseDown={e => beginResize("edgeS", e)} />
        <span className="edge-handle edge-e" onMouseDown={e => beginResize("edgeE", e)} />
        <span className="edge-handle edge-w" onMouseDown={e => beginResize("edgeW", e)} />
        <span className="edge-handle edge-ne" onMouseDown={e => beginResize("edgeNE", e)} />
        <span className="edge-handle edge-nw" onMouseDown={e => beginResize("edgeNW", e)} />
        <span className="edge-handle edge-se" onMouseDown={e => beginResize("edgeSE", e)} />
        <span className="edge-handle edge-sw" onMouseDown={e => beginResize("edgeSW", e)} />
        <section className="pet-anchor" style={{ transform: `translateX(-50%) scale(${settings.petScale}) translate(${viewOff.x}px, ${viewOff.y}px)` }}>
          <div className="edit-live-layer">
            {settings.showBubbles && getFeedbackMode(previewEvent) !== "ribbon" ? (
              <div className="bubble-wrapper" style={{ transform: `translate(${offsets.bubble?.x ?? 0}px, ${offsets.bubble?.y ?? 0}px)` }}>
                <Bubble event={previewEvent} state={stateFromEvent(previewEvent)} settings={settings} />
              </div>
            ) : null}
            <div className={`clawd clawd-${previewState}`} style={{ transform: `translate(${offsets.clawd?.x ?? 0}px, ${offsets.clawd?.y ?? 0}px) scale(${settings.clawdScale})`, opacity: settings.clawdOpacity }}>
              <ClawdSprite state={previewState} idleBubble={effectiveIdleBubble} eventType={previewEvent.event} tool={previewEvent.tool} stateAnimations={settings.stateAnimations} overrideAnimation={previewAnimation} />
              {settings.showStatusProp && previewState !== "idle" ? <StateProp state={previewState} /> : null}
            </div>
            {settings.showBubbles ? (
              <ToolStreams streams={previewStreams} offset={offsets.ribbon} scale={settings.feedbackScale} opacity={settings.feedbackOpacity} />
            ) : null}
            {settings.showBubbles ? (
              <PermissionCard
                permission={editPreviewPermission}
                queueCount={1}
                onAllow={() => {}}
                onDeny={() => {}}
                settings={settings}
                offset={offsets.permission}
              />
            ) : null}
          </div>
          <div className="edit-zone edit-zone-clawd"
            style={{
              left: Math.round((226 - cw) / 2),
              transform: `translate(${offsets.clawd?.x ?? 0}px, ${offsets.clawd?.y ?? 0}px)`,
              width: cw, height: ch
            }}
            onMouseDown={e => begin("clawd", e)}>
            <span className="edit-zone-label">Clawd</span>
            <span className="zone-resize" onMouseDown={e => beginResize("clawd", e)} />
          </div>
          <div className="edit-zone edit-zone-bubble"
            style={{
              left: bx,
              top: by,
              right: "auto",
              bottom: "auto",
              transform: `translate(${offsets.bubble?.x ?? 0}px, ${offsets.bubble?.y ?? 0}px)`,
              width: bw, height: bh
            }}
            onMouseDown={e => begin("bubble", e)}>
            <span className="edit-zone-label">{t("pet.editZoneBubble", "Bubble / card")}</span>
            <span className="zone-resize" onMouseDown={e => beginResize("bubble", e)} />
          </div>
          <div className="edit-zone edit-zone-ribbon"
            style={{
              transform: `translate(${offsets.ribbon?.x ?? 0}px, ${offsets.ribbon?.y ?? 0}px)`,
              width: rw, height: rh
            }}
            onMouseDown={e => begin("ribbon", e)}>
            <span className="edit-zone-label">{t("pet.editZoneRibbon", "Tool ribbon")}</span>
            <span className="zone-resize" onMouseDown={e => beginResize("ribbon", e)} />
          </div>
          <div className="edit-zone edit-zone-permission"
            style={{
              left: 10,
              top: 10,
              transform: `translate(${offsets.permission?.x ?? 0}px, ${offsets.permission?.y ?? 0}px)`,
              width: pw, height: ph
            }}
            onMouseDown={e => begin("permission", e)}>
            <span className="edit-zone-label">{t("pet.editZonePermission", "Permission card")}</span>
            <span className="zone-resize" onMouseDown={e => beginResize("permission", e)} />
          </div>
          <div className="edit-zone edit-zone-git-toast"
            style={{
              top: 8,
              left: "50%",
              transform: `translateX(-50%) translate(${offsets.gitToast?.x ?? 0}px, ${offsets.gitToast?.y ?? 0}px)`,
              width: 240,
              height: 36
            }}
            onMouseDown={e => begin("gitToast", e)}>
            <span className="edit-zone-label">{t("pet.editZoneGitToast", "Git capsule")}</span>
            <span className="zone-resize" onMouseDown={e => beginResize("gitToast", e)} />
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className={`pet-stage ${settings.clickThrough ? 'pet-clickthrough' : ''}`}>
      <PluginSpriteLoader plugins={settings.customPlugins ?? []} />
      <section className="pet-anchor" style={{ transform: `translateX(-50%) scale(${settings.petScale}) translate(${viewOff.x}px, ${viewOff.y}px)` }} onMouseDown={beginNormalDrag}>
      {gitToast && (
        <div className="git-toast" key={gitToast.id} style={{ top: 8, left: "50%", transform: `translateX(-50%) translate(${(settings.positionOffsets?.gitToast?.x ?? 0)}px, ${(settings.positionOffsets?.gitToast?.y ?? 0)}px)` }}>
          <span className="git-toast-title">{gitToast.title}</span>
          <span className="git-toast-message">{gitToast.message}</span>
        </div>
      )}
        {activePermissions.length > 0 ? (
          <PermissionCard
            hitTestRef={permCardRef}
            permission={activePermissions[0]}
            queueCount={activePermissions.length}
            onAllow={() => respondToPermission(activePermissions[0].id, "allow")}
            onDeny={() => respondToPermission(activePermissions[0].id, "deny")}
            settings={settings}
            offset={offsets.permission}
          />
        ) : settings.showBubbles && currentEvent && getFeedbackMode(currentEvent) !== "ribbon" ? (
          <div className="bubble-wrapper" style={{ transform: `translate(${offsets.bubble?.x ?? 0}px, ${offsets.bubble?.y ?? 0}px)` }}>
            <Bubble event={currentEvent} state={stateFromEvent(currentEvent)} settings={settings} />
          </div>
        ) : null}
        <div className={`clawd clawd-${petState}`} style={{ transform: `translate(${offsets.clawd?.x ?? 0}px, ${offsets.clawd?.y ?? 0}px) scale(${settings.clawdScale})`, opacity: settings.clawdOpacity }}>
          <ClawdSprite state={petState} idleBubble={effectiveIdleBubble} eventType={currentEvent?.event} tool={currentEvent?.tool} stateAnimations={settings.stateAnimations} overrideAnimation={previewAnimation} />
          {settings.showStatusProp && petState !== "idle" ? <StateProp state={petState} /> : null}
        </div>
        {settings.showBubbles && toolStreams.length > 0 ? (
          <ToolStreams streams={toolStreams} offset={offsets.ribbon} scale={settings.feedbackScale} opacity={settings.feedbackOpacity} />
        ) : null}

      </section>
    </main>
  );
}

function Bubble({ event, state, settings }: { event: CompanionEvent; state: PetState; settings: CompanionSettings }) {
  const { t } = useI18n();
  const toolLabel = event.tool && event.tool !== "Unknown" ? event.tool : event.source === "deepseek-harness" ? "DeepSeek Harness" : "Manual";
  const feedbackMode = getFeedbackMode(event);
  if (feedbackMode === "thought") {
    return (
      <div className="thought-wrapper" style={{ transform: `scale(${0.75 * settings.feedbackScale})`, opacity: settings.feedbackOpacity }}>
        <section className={`thought-bubble thought-${state}`}>
          <i />
          <span>{toolLabel}</span>
          <strong>{event.detail ?? event.title}</strong>
        </section>
      </div>
    );
  }

  return (
    <div className="bubble-wrapper" style={{ transform: `scale(${0.75 * settings.feedbackScale})`, opacity: settings.feedbackOpacity }}>
      <section className={`bubble bubble-${state}`}>
        <div className="bubble-status-light" />
        <div className="bubble-content">
        <header className="bubble-header">
          <span className="bubble-state">{t(`pet.${state}`, stateCopy[state].label)}</span>
          <span className="bubble-tool">{toolLabel}</span>
        </header>
        <strong>{event.title}</strong>
        <p>{event.message}</p>
        {event.detail ? <code className="bubble-detail">{event.detail}</code> : null}
        <footer className="bubble-footer">
          <span>{t(`pet.${state}Line`, stateCopy[state].line)}</span>
          <time>{new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
        </footer>
      </div>
    </section>
    </div>
  );
}

const toolColorMap: Record<string, string> = {
  Read: "mint",
  Edit: "coral",
  Write: "coral",
  Bash: "ink",
  Grep: "blue",
  Glob: "blue",
  WebFetch: "blue",
  WebSearch: "blue",
  Notebook: "mint",
  Agent: "steel",
  Skill: "honey",
  Task: "steel",
  AskUserQuestion: "honey",
  MCP: "purple",
  Shell: "ink",
  ApplyPatch: "coral",
  UpdatePlan: "steel",
  ViewImage: "blue",
  Unknown: "steel"
};

function ToolStreams({ streams, offset, scale, opacity }: { streams: ToolStream[]; offset?: { x: number; y: number }; scale: number; opacity: number }) {
  const visible = streams.filter((stream, index) => stream.exiting || streams.slice(0, index).filter(s => !s.exiting).length < 5);

  return (
    <div className="tool-streams" style={{ transform: `translate(${offset?.x ?? 0}px, ${offset?.y ?? 0}px) scale(${scale})`, opacity }}>
      {visible.map((stream) => {
        const tool = stream.event.tool ?? "Unknown";
        const color = toolColorMap[tool] ?? "steel";
        const detail = stream.event.detail ?? stream.event.title;
        const slot = stream.exiting ? (stream.exitSlot ?? stream.slot) : stream.slot;
        return (
          <div
            key={stream.event.id}
            className={`tool-stream color-${color} ${stream.exiting ? "exiting" : "active"}`}
            style={{ top: 34 + slot * 18 }}
          >
            <span className="stream-wake" />
            <span className="stream-core" />
            <span className="stream-tool-name">{tool}</span>
            <span className="stream-holo" aria-hidden="true">
              <span className="stream-detail">{detail}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Clawd({ state, settings, forceIdleBubble }: { state: PetState; settings: CompanionSettings; forceIdleBubble?: string | null }) {
  const { t } = useI18n();
  const [syncedSprite, setSyncedSprite] = useState<string | null>(null);

  useEffect(() => {
    const off = window.companion.onIdleBubbleSync(setSyncedSprite);
    return () => off();
  }, []);

  const effectiveBubble = forceIdleBubble ?? syncedSprite;

  return (
    <section className={`clawd clawd-${state}`} style={{ transform: `scale(${settings.clawdScale})`, opacity: settings.clawdOpacity }} aria-label={`Clawd ${t(`pet.${state}`, stateCopy[state].label)}`}>
      <ClawdSprite state={state} idleBubble={effectiveBubble} stateAnimations={settings.stateAnimations} />
      {settings.showStatusProp && state !== "idle" ? <StateProp state={state} /> : null}
    </section>
  );
}

function ClawdSprite({ state, idleBubble, eventType, tool, stateAnimations, overrideAnimation }: { state: PetState; idleBubble?: string | null; eventType?: CompanionEvent["event"]; tool?: string; stateAnimations?: Record<string, string>; overrideAnimation?: { key: string; nonce: number } | null }) {
  void eventType;
  void tool;
  const assets = petAnimationAssets;
  const baseKey = idleBubble ? normalizeAnimationKey(idleBubble, "idle") : animationKeyForPetState(state);
  const animationKey = overrideAnimation ? normalizeAnimationKey(overrideAnimation.key, "idle") : normalizeAnimationKey(stateAnimations?.[baseKey], baseKey);
  const imageKey = overrideAnimation ? `${animationKey}:${overrideAnimation.nonce}` : animationKey;
  const imageSrc = assets?.[animationKey];

  return (
    <>
      <div className="clawd-glow" />
      {imageSrc ? <img key={imageKey} className={`clawd-animation-img clawd-animation-${animationKey}`} src={imageSrc} alt="" draggable={false} /> : null}
      <div className="shadow" />
    </>
  );
}

function StateProp({ state }: { state: PetState }) {
  if (state === "tool_bash") return <Terminal className="state-prop terminal-prop" size={30} />;
  if (state === "tool_edit") return <Code2 className="state-prop edit-prop" size={30} />;
  if (state === "tool_read") return <FileText className="state-prop read-prop" size={30} />;
  if (state === "tool_search") return <Search className="state-prop search-prop" size={30} />;
  if (state === "tool_mcp") return <PlugZap className="state-prop mcp-prop" size={30} />;
  if (state === "waiting_permission") return <Bell className="state-prop bell-prop" size={30} />;
  if (state === "done") return <Check className="state-prop check-prop" size={30} />;
  if (state === "error") return <X className="state-prop error-prop" size={30} />;
  return null;
}

function SettingsApp() {
  const { t, setLocale, locale } = useI18n();
  const { settings, updateSettings, connection, applyConnection, petState, toolStreams } = useCompanion();
  const { petPacks, refreshPetPacks } = usePetPacks();

  // Stable callback identities for the memoized sections below. useCompanion
  // redefines updateSettings on every render, so hand the sections a ref-backed
  // wrapper that always calls the latest one but keeps a fixed identity —
  // otherwise React.memo on the sections could never bail.
  const updateSettingsRef = useRef(updateSettings);
  updateSettingsRef.current = updateSettings;
  const stableUpdateSettings = useCallback(next => updateSettingsRef.current(next), []);

  const activePetTheme = getPetTheme(settings.petTheme, petPacks);
  // Active theme's animation catalog and (for imported packs) its sheet — the
  // animation workbench pickers follow the theme the pet actually shows.
  // Memoized so a slider drag / clock tick doesn't hand AnimationSection new
  // catalog/sheet references and force it (and its sprite grid) to re-render.
  const activeThemeCatalog = useMemo(() => resolveThemeCatalog(settings.petTheme, petPacks), [settings.petTheme, petPacks]);
  const activeThemeSheet = useMemo(() => {
    const packId = packIdFromThemeId(settings.petTheme);
    const pack = packId ? petPacks.find(item => item.id === packId) ?? null : null;
    return pack ? spritesheetAssetsFromPack(pack) : null;
  }, [settings.petTheme, petPacks]);
  // Character chrome (anchor icon, character name in the version bar) only
  // belongs to the pet interface theme; light/dark stay neutral.
  const petChromeActive = (settings.theme ?? "system") === "system" && activePetTheme.interfaceTheme === "pet";
  const [copied, setCopied] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState("general");
  const [activeSettingsSubsection, setActiveSettingsSubsection] = useState("general");
  const [now, setNow] = useState(Date.now());
  const [appVersion, setAppVersion] = useState("...");
  const sectionContentRef = useRef<HTMLDivElement | null>(null);
  const [backgroundSectionsMounted, setBackgroundSectionsMounted] = useState(false);

  // Git 胶囊：在设置窗口也渲染一份（pet 窗口可能被遮挡）
  const [gitToast, setGitToast] = useState<{ id: string; title: string; message: string } | null>(null);
  const gitToastTimer = useRef<number | null>(null);
  useEffect(() => {
    const off = window.companion.onEvent(event => {
      if (event.event !== "git_operation") return;
      if (gitToastTimer.current) window.clearTimeout(gitToastTimer.current);
      const displayEvent = settings.hideSensitiveContent ? redactDisplayEvent(event, locale) : event;
      setGitToast({ id: event.id, title: displayEvent.title, message: displayEvent.message });
      gitToastTimer.current = window.setTimeout(() => setGitToast(null), 2200);
    });
    return () => {
      off();
      if (gitToastTimer.current) window.clearTimeout(gitToastTimer.current);
    };
  }, [locale, settings.hideSensitiveContent]);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({
    checking: false,
    available: false,
    upToDate: false,
    downloaded: false,
    downloading: false
  });
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [persistedStats, setPersistedStats] = useState<any>(defaultStats);
  const [onboardingDone, setOnboardingDone] = useState(() => {
    try { return localStorage.getItem("clawd-onboarding-done") === "1"; } catch { return true; }
  });
  const [onboardingStep, setOnboardingStep] = useState(0);
  // Connection-surface controller (status / checking / error / action outcome,
  // the seq-guarded full-chain recheck, and the navigation-driven refresh) —
  // extracted to a hook so the behavior is covered by the regression harness.
  const connectionSurface = useConnectionSurface({
    surfaceKey: connectionSurfaceKey(activeSection, activeSettingsSubsection),
    checkHooks: () => window.companion.checkHooks(),
    getConnectionStatus: () => window.companion.getConnectionStatus(),
    applyConnection: next => applyConnection?.(next)
  });
  const formatText = (template: string, values: Record<string, string | number>) => Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template);

  useEffect(() => {
    let cancelled = false;
    setBackgroundSectionsMounted(true);
    void window.companion.getStats()
      .then(stats => { if (!cancelled) setPersistedStats(stats); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    window.companion.getAppVersion().then(version => { if (!cancelled) setAppVersion(version); });
    window.companion.getUpdateStatus().then(status => { if (!cancelled) setUpdateStatus(status); });
    const offUpdate = window.companion.onUpdateStatus(setUpdateStatus);
    return () => {
      cancelled = true;
      offUpdate();
    };
  }, []);

  useEffect(() => {
    const offPlaySound = window.companion.onPlaySound((dataUrl) => {
      try { playClippedAudio(dataUrl, settings.sound.volume); } catch { /* ignore */ }
    });
    return () => offPlaySound();
  }, [settings.sound.volume]);

  useEffect(() => {
    if (activeSection !== "data") return undefined;
    let cancelled = false;
    const refreshStats = () => {
      window.companion.getStats().then(stats => {
        if (!cancelled) setPersistedStats(stats);
      });
    };
    refreshStats();
    const statsInterval = window.setInterval(refreshStats, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(statsInterval);
    };
  }, [activeSection]);

  useEffect(() => {
    // Only SettingsSection consumes `now` (relative timestamps), so tick the
    // clock only while that tab is active. Ticking on other tabs re-rendered
    // the whole panel — and every keep-mounted section — once per second for
    // nothing visible.
    if (activeSection !== "settings") return undefined;
    // Re-entering Settings after the clock was parked leaves `now` frozen at
    // whenever we last left — so relative timestamps ("last event 3s ago") would
    // render stale until the first interval fire (~1s later). Sync immediately,
    // then start ticking.
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [activeSection]);

  function jumpTo(section: string) {
    if (section === activeSection) return;
    const resetSectionScroll = () => {
      sectionContentRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
      requestAnimationFrame(() => sectionContentRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" }));
    };

    setActiveSection(section);
    resetSectionScroll();
  }

  useEffect(() => {
    return window.companion.onOpenSection(section => jumpTo(section));
  }, [activeSection]);

  async function copy(text: string, key: string) {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    window.setTimeout(() => setCopied(current => current === key ? null : current), 1600);
  }

  async function handleCheckUpdate() {
    setCheckingUpdate(true);
    setUpdateStatus(prev => ({ ...prev, error: undefined }));
    try {
      const result = await Promise.race([
        window.companion.checkForUpdates(),
        new Promise<{ ok: boolean; error?: string }>(resolve =>
          setTimeout(() => resolve({ ok: false, error: t("update.timeout", "检查超时，请检查网络连接后重试。") }), 15_000)
        )
      ]);
      if (!result.ok) {
        setUpdateStatus(prev => ({ ...prev, error: result.error }));
      }
    } catch {
      setUpdateStatus(prev => ({ ...prev, error: t("update.failed", "检查更新失败，请稍后重试。") }));
    } finally {
      setCheckingUpdate(false);
    }
  }

  async function handleInstallClick() {
    setInstalling(true);
    try {
      const result = await window.companion.installUpdate();
      if (!result.ok) {
        setUpdateStatus(prev => ({ ...prev, error: result.error ?? t("update.installFailed", "安装启动失败") }));
      }
    } catch {
      // IPC 断开（quitAndInstall 触发退出）会到这里，属于正常情况
    } finally {
      setInstalling(false);
    }
  }

  const handleResetStats = useCallback(async () => {
    await window.companion.resetStats();
    setPersistedStats(await window.companion.getStats());
  }, []);

  return (
    <main className="settings-shell">
      {gitToast && (
        <div className="git-toast" key={gitToast.id} style={{ left: "50%", top: 64, transform: "translateX(-50%)" }}>
          <span className="git-toast-title">{gitToast.title}</span>
          <span className="git-toast-message">{gitToast.message}</span>
        </div>
      )}
      <section className="window-bar">
        <div className="window-title">
          {petChromeActive ? <Anchor size={15} /> : <Sparkles size={15} />}
          <span>{APP_DISPLAY_NAME}</span>
          {(updateStatus.available || updateStatus.downloading || updateStatus.downloaded) && (
            <button className="update-hint-btn" onClick={() => {
              const content = document.querySelector('.section-content');
              if (content) {
                content.scrollTo({ top: content.scrollHeight, behavior: 'smooth' });
              }
            }}>
              {t("main.newVersion", "发现新版本")}
            </button>
          )}
        </div>
        <div className="window-actions">
          <button title={t("main.minimize", "最小化")} onClick={() => window.companion.minimizeSettings()} aria-label={t("main.minimize", "最小化")}><Minus size={13} strokeWidth={2} /></button>
          <button title={t("main.maximize", "最大化/还原")} onClick={() => window.companion.toggleMaximizeSettings()} aria-label={t("main.maximize", "最大化/还原")}><Square size={12} strokeWidth={1.8} /></button>
          <button className="close" title={t("main.close", "关闭配置")} onClick={() => window.companion.closeSettings()} aria-label={t("main.close", "关闭配置")}><X size={14} strokeWidth={2.1} /></button>
        </div>
      </section>
      <nav className="tab-bar">
        {[
          { id: "general", icon: <Gauge size={16} />, label: t("settings.tabs.general", "总览") },
          { id: "animation", icon: <Wand2 size={16} />, label: t("settings.tabs.animation", "动画") },
          { id: "themes", icon: <Palette size={16} />, label: t("settings.tabs.themes", "主题") },
          { id: "plugins", icon: <PlugZap size={16} />, label: t("settings.tabs.plugins", "插件") },
          { id: "data", icon: <FileText size={16} />, label: t("settings.tabs.data", "数据") },
          { id: "settings", icon: <Wrench size={16} />, label: t("settings.tabs.settings", "设置") }
        ].map(tab => (
          <button
            key={tab.id}
            className={`tab-item ${activeSection === tab.id ? "active" : ""}`}
            onClick={() => jumpTo(tab.id)}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </nav>

      <div className="section-content" ref={sectionContentRef}>
        {activeSection === "general" && (
          <OverviewSection
            settings={settings}
            updateSettings={stableUpdateSettings}
            connection={connection}
            hookStatus={connectionSurface.hookStatus}
            checkError={connectionSurface.checkError}
            checking={connectionSurface.checking}
            actionOutcome={connectionSurface.actionOutcome}
            onRecheck={() => void connectionSurface.recheck()}
            onOperationComplete={connectionSurface.handleOperation}
          />
        )}

        {(activeSection === "settings" || backgroundSectionsMounted) && (
          <div style={{ display: activeSection === "settings" ? "contents" : "none" }} aria-hidden={activeSection !== "settings"}>
            <SettingsSection
              settings={settings}
              updateSettings={stableUpdateSettings}
              connection={connection}
              now={now}
              hookStatus={connectionSurface.hookStatus}
              hookCheckError={connectionSurface.checkError}
              hookChecking={connectionSurface.checking}
              hookActionOutcome={connectionSurface.actionOutcome}
              onHookRecheck={() => void connectionSurface.recheck()}
              onHookOperationComplete={connectionSurface.handleOperation}
              activeSettingsSubsection={activeSettingsSubsection}
              setActiveSettingsSubsection={setActiveSettingsSubsection}
              sectionContentRef={sectionContentRef}
              locale={locale}
              setLocale={setLocale}
              appVersion={appVersion}
              updateStatus={updateStatus}
              checkingUpdate={checkingUpdate}
              handleCheckUpdate={handleCheckUpdate}
              petPacks={petPacks}
              refreshPetPacks={refreshPetPacks}
            />
          </div>
        )}

        {(activeSection === "animation" || backgroundSectionsMounted) && (
          <div style={{ display: activeSection === "animation" ? "contents" : "none" }} aria-hidden={activeSection !== "animation"}>
            <AnimationSection active={activeSection === "animation"} settings={settings} updateSettings={stableUpdateSettings} catalog={activeThemeCatalog} spritesheet={activeThemeSheet} />
          </div>
        )}

        {(activeSection === "plugins" || backgroundSectionsMounted) && (
          <div style={{ display: activeSection === "plugins" ? "contents" : "none" }} aria-hidden={activeSection !== "plugins"}>
            <PluginsPage active={activeSection === "plugins"} hideSensitiveContent={settings.hideSensitiveContent} />
          </div>
        )}

        {(activeSection === "themes" || backgroundSectionsMounted) && (
          <div style={{ display: activeSection === "themes" ? "contents" : "none" }} aria-hidden={activeSection !== "themes"}>
            <DshThemesPage active={activeSection === "themes"} />
          </div>
        )}

        {(activeSection === "data" || backgroundSectionsMounted) && (
          <div style={{ display: activeSection === "data" ? "contents" : "none" }} aria-hidden={activeSection !== "data"}>
            <DataSection
              persistedStats={persistedStats}
              hideSensitiveContent={settings.hideSensitiveContent}
              displayCurrency={settings.displayCurrency ?? "CNY"}
              onResetStats={handleResetStats}
            />
          </div>
        )}
      </div>

      <footer className="version-bar">
        <div className="version-left">
          <span className="version-label">{petChromeActive ? activePetTheme.characterName : APP_DISPLAY_NAME}</span>
          <button
            className="version-link"
            onClick={() => window.companion.openExternal("https://github.com/Renakoni/dsh-desk")}
            title={t("update.github", "在 GitHub 上查看")}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.385-1.335-1.755-1.335-1.755-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.605-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 21.795 24 17.295 24 12 24 5.37 18.63 0 12 0z"/></svg>
            GitHub
          </button>
        </div>
        <div className="version-right" title={updateStatus.lastCheckedAt ? `${t("update.lastChecked", "上次检查")}: ${new Date(updateStatus.lastCheckedAt).toLocaleString()}` : undefined}>
          {updateStatus.error ? (
            <span className="update-error">{updateStatus.error}</span>
          ) : updateStatus.downloaded ? (
            <div className="update-install-wrap">
              <button className="update-btn update-ready" onClick={handleInstallClick} disabled={installing}>
                {installing ? t("update.installing", "正在启动安装...") : formatText(t("update.install", "点击重启并安装 v{version}"), { version: updateStatus.version ?? "" })}
              </button>
              <span className="update-install-hint">{t("update.installHint", "若安装失败，请右键本软件并以管理员身份运行后再次尝试")}</span>
            </div>
          ) : updateStatus.downloading ? (
            <span className="update-progress">{formatText(t("update.downloading", "下载中 {progress}%"), { progress: Math.round(updateStatus.progress ?? 0) })}</span>
          ) : updateStatus.checking ? (
            <span className="update-checking">{t("update.checking", "正在检查更新...")}</span>
          ) : updateStatus.available ? (
            <span className="update-available">{formatText(t("update.available", "发现新版本 v{version}，正在下载..."), { version: updateStatus.version ?? "" })}</span>
          ) : updateStatus.upToDate ? (
            <span className="update-uptodate">
              <Check size={14} />{t("update.upToDate", "已是最新版本")}
              <button className="update-refresh-btn" onClick={handleCheckUpdate} disabled={checkingUpdate} title={t("update.manualCheck", "手动检查更新")}>
                ↻
              </button>
            </span>
          ) : (
            <button className="update-btn" onClick={handleCheckUpdate} disabled={checkingUpdate}>
              {checkingUpdate ? t("update.checkShort", "检查中...") : t("update.check", "检查更新")}
            </button>
          )}
        </div>
      </footer>
    </main>
  );
}

function Panel({ id, title, icon, wide, children }: { id?: string; title: string; icon: React.ReactNode; wide?: boolean; children: React.ReactNode }) {
  return <section id={id} className={`panel ${wide ? "wide" : ""}`}><header>{icon}<h2>{title}</h2></header>{children}</section>;
}


function Step({ number, title, text }: { number: string; title: string; text: string }) {
  return <article className="step"><b>{number}</b><div><strong>{title}</strong><p>{text}</p></div></article>;
}

function MappingRow({ row }: { row: { source: string; tool?: string; state: PetState; title: string } }) {
  const { t } = useI18n();
  return (
    <article className="mapping-row">
      <div><strong>{row.source}</strong><span>{row.tool ?? row.title}</span></div>
      <i />
      <em className={`tone-${stateCopy[row.state].tone}`}>{t(`pet.${row.state}`, stateCopy[row.state].label)}</em>
    </article>
  );
}

export function ClawdSettingsRoot() {
  const route = window.location.hash.replace("#/", "") || "settings";
  const initialSettings = window.companion.initialState?.settings ?? defaultSettings;
  const [locale] = React.useState(() => {
    if (initialSettings.language === "en" || initialSettings.language === "zh") return initialSettings.language;
    return detectLocale();
  });

  return (
    <I18nProvider initialLocale={locale}>
      {route === "pet" ? <PetApp /> : <SettingsApp />}
    </I18nProvider>
  );
}

if (new URLSearchParams(window.location.search).get("view") === "clawd-standalone") {
  createRoot(document.getElementById("root")!).render(
    <ErrorBoundary>
      <ClawdSettingsRoot />
    </ErrorBoundary>
  );
}

