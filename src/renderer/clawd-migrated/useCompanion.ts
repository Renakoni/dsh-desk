// @ts-nocheck
import { useEffect, useMemo, useRef, useState } from "react";
import type { CompanionConnectionStatus, CompanionEvent, CompanionSession, CompanionSettings, PermissionRequest, PetState } from "../shared/events";
import { defaultSettings, stateFromEvent } from "../shared/events";
import { redactDisplayEvent } from "../../shared/privacy";
import { applyCompanionAppearance } from "./appearance";
import { pickThrottledDisplayEvent, pickThrottledStateEvent } from "./eventThrottle";

export interface ToolStream {
  event: CompanionEvent;
  exiting: boolean;
  slot: number;
  exitSlot?: number;
}

function isInformationalNotification(event: CompanionEvent) {
  return event.event === "notification" && event.notificationKind === "info";
}

export function useCompanion(options: { keepEventList?: boolean } = {}) {
  const keepEventList = options.keepEventList ?? true;
  const initialSettings = window.companion.initialState?.settings ?? defaultSettings;
  const [settings, setSettings] = useState<CompanionSettings>(initialSettings);
  const [connection, setConnection] = useState<CompanionConnectionStatus>({
    port: 0,
    serverListening: false
  });
  const [events, setEvents] = useState<CompanionEvent[]>([]);
  const [currentEvent, setCurrentEvent] = useState<CompanionEvent | null>(null);
  const [petState, setPetState] = useState<PetState>("idle");
  const [toolStreams, setToolStreams] = useState<ToolStream[]>([]);
  const [activePermissions, setActivePermissions] = useState<PermissionRequest[]>([]);
  const [sessions, setSessions] = useState<CompanionSession[]>([]);
  const [exitingSessions, setExitingSessions] = useState<Set<string>>(new Set());
  const [mainSessionId, setMainSessionId] = useState<string | null>(null);
  const sessionsRef = useRef<Map<string, CompanionSession>>(new Map());
  const settingsRef = useRef<CompanionSettings>(initialSettings);
  const mainSessionIdRef = useRef<string | null>(null);
  const exitingSessionsRef = useRef<Set<string>>(new Set());
  const ribbonTimers = useRef<Map<string, number>>(new Map());
  const ribbonTimestamps = useRef<Map<string, number>>(new Map());
  const eventThrottleRef = useRef<{ timer: number | null; lastFlush: number }>({ timer: null, lastFlush: 0 });
  const pendingEventsRef = useRef<CompanionEvent[]>([]);
  const companionSlotRef = useRef<Map<string, number>>(new Map());
  const transientTimersRef = useRef<Set<number>>(new Set());

  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { mainSessionIdRef.current = mainSessionId; }, [mainSessionId]);
  useEffect(() => { exitingSessionsRef.current = exitingSessions; }, [exitingSessions]);

  function updateExitingSessions(updater: (previous: Set<string>) => Set<string>) {
    setExitingSessions(previous => {
      const next = updater(previous);
      exitingSessionsRef.current = next;
      return next;
    });
  }

  function scheduleTransientTimer(callback: () => void, delay: number) {
    const timer = window.setTimeout(() => {
      transientTimersRef.current.delete(timer);
      callback();
    }, delay);
    transientTimersRef.current.add(timer);
  }

  function scheduleStreamRemoval(eventId: string) {
    scheduleTransientTimer(() => {
      setToolStreams(previous => previous.filter(s => s.event.id !== eventId));
      ribbonTimers.current.delete(eventId);
      ribbonTimestamps.current.delete(eventId);
    }, 780);
  }

  function markExiting(eventId: string) {
    setToolStreams(previous => {
      const target = previous.find(s => s.event.id === eventId);
      if (!target) return previous;
      const exitSlot = target.slot;
      return previous.map(s => {
        if (s.event.id === eventId) return { ...s, exiting: true, exitSlot };
        if (!s.exiting && s.slot > exitSlot) return { ...s, slot: s.slot - 1 };
        return s;
      });
    });
    scheduleStreamRemoval(eventId);
  }

  useEffect(() => {
    let disposed = false;
    let settingsBroadcastReceived = false;
    let connectionBroadcastReceived = false;
    const applySettingsSnapshot = (next: CompanionSettings) => {
      if (disposed) return;
      settingsRef.current = next;
      setSettings(next);
      applyCompanionAppearance(next);
    };
    const offSettings = window.companion.onSettings(next => {
      settingsBroadcastReceived = true;
      applySettingsSnapshot(next);
    });
    const offConnection = window.companion.onConnection(next => {
      connectionBroadcastReceived = true;
      if (!disposed) setConnection(next);
    });
    void window.companion.getSettings().then(next => {
      if (!settingsBroadcastReceived) applySettingsSnapshot(next);
    });
    void window.companion.getConnectionStatus().then(next => {
      if (!disposed && !connectionBroadcastReceived) setConnection(next);
    });
    const showEvent = (event: CompanionEvent) => {
      setCurrentEvent(event);
      if (!isInformationalNotification(event)) setPetState(stateFromEvent(event));
    };
    const offEvent = window.companion.onEvent(event => {
      const sid = event.sessionId;
      const isDone = event.event === "done" || event.event === "error";
      const displayOnly = isInformationalNotification(event);
      let sessionsChanged = false;
      if (sid) {
        const existing = sessionsRef.current.get(sid);
        if (!mainSessionIdRef.current && sessionsRef.current.size === 0) {
          mainSessionIdRef.current = sid;
          setMainSessionId(sid);
        }
        let title = existing?.title ?? "";
        const raw = event.detail || event.title || event.message || "";
        const clean = raw.length > 25 ? raw.slice(0, 25) + "…" : raw;
        if (!title && clean) title = clean;
        if (event.event === "prompt_submit") {
          const prompt = event.detail || event.message || "";
          if (prompt) title = prompt.length > 25 ? prompt.slice(0, 25) + "…" : prompt;
        }
        const wasActive = existing?.isActive ?? true;
        const session: CompanionSession = {
          sessionId: sid,
          title: title || existing?.title || sid.slice(0, 6),
          state: displayOnly ? (existing?.state ?? "idle") : stateFromEvent(event),
          lastEvent: event,
          lastEventTime: Date.now(),
          isActive: displayOnly ? (existing?.isActive ?? true) : !isDone,
          eventCount: (existing?.eventCount ?? 0) + 1
        };
        sessionsRef.current.set(sid, session);
        sessionsChanged = true;
        if (!displayOnly && !wasActive && !isDone) updateExitingSessions(prev => { const next = new Set(prev); next.delete(sid); return next; });
        if (wasActive && isDone) {
          updateExitingSessions(prev => new Set(prev).add(sid));
          const exitId = sid;
          scheduleTransientTimer(() => {
            const revived = sessionsRef.current.get(exitId);
            if (revived?.isActive) return;
            updateExitingSessions(prev => { const next = new Set(prev); next.delete(exitId); return next; });
            sessionsRef.current.delete(exitId);
            setSessions(Array.from(sessionsRef.current.values()));
          }, 700);
        }
      } else if (isDone) {
        for (const [id, session] of sessionsRef.current) {
          if (session.isActive) {
            sessionsRef.current.set(id, { ...session, isActive: false });
            sessionsChanged = true;
            updateExitingSessions(prev => new Set(prev).add(id));
            const exitId = id;
            scheduleTransientTimer(() => {
              const revived = sessionsRef.current.get(exitId);
              if (revived?.isActive) return;
              updateExitingSessions(prev => { const next = new Set(prev); next.delete(exitId); return next; });
              sessionsRef.current.delete(exitId);
              setSessions(Array.from(sessionsRef.current.values()));
            }, 700);
          }
        }
      }

      // The idle (60s) and cleanup (300s) sweeps over the WHOLE session map are time-threshold based,
      // so they run on a low-frequency timer (see the sessionSweep interval below) rather than on
      // every event — a tool burst no longer re-scans + reallocates the map on the UI thread per
      // event. Only this event's own session is updated synchronously above.
      if (sessionsChanged) setSessions(Array.from(sessionsRef.current.values()));

      const now = Date.now();
      if (now - eventThrottleRef.current.lastFlush < 100) {
        pendingEventsRef.current.push(event);
        if (!eventThrottleRef.current.timer) {
          eventThrottleRef.current.timer = window.setTimeout(() => {
            const pending = pendingEventsRef.current;
            pendingEventsRef.current = [];
            eventThrottleRef.current.timer = null;
            eventThrottleRef.current.lastFlush = Date.now();
            // Select display and state SEPARATELY from the burst. The bubble shows the
            // latest surfacing event (which may be an info notification), but pet state
            // must be driven by the latest STATE event — info notifications are excluded
            // there because showEvent refuses to apply them to state. Using one event
            // for both let a trailing info notification mask an earlier done/error and
            // strand the pet on "using tool". Both are computed before the in-place
            // reverse below and are order-independent regardless of keepEventList.
            const displayEvent = pickThrottledDisplayEvent(pending);
            const stateEvent = pickThrottledStateEvent(pending);
            if (keepEventList) setEvents(previous => [...pending.reverse(), ...previous].slice(0, settingsRef.current.eventHistoryLimit));
            if (displayEvent) setCurrentEvent(displayEvent);
            if (stateEvent) setPetState(stateFromEvent(stateEvent));
          }, 100 - (now - eventThrottleRef.current.lastFlush));
        }
      } else {
        eventThrottleRef.current.lastFlush = now;
        if (keepEventList) setEvents(previous => [event, ...previous].slice(0, settingsRef.current.eventHistoryLimit));
        if (event.event !== "tool_end" && event.event !== "git_operation") {
          showEvent(event);
        }
      }

      if (event.event === "tool_end") {
        setToolStreams(previous => {
          const matching = previous.find(stream => stream.event.event === "tool_start" && stream.event.tool === event.tool && !stream.exiting);
          if (!matching) return previous;
          const addedAt = ribbonTimestamps.current.get(matching.event.id) ?? Date.now();
          const elapsed = Date.now() - addedAt;
          const minDisplayMs = Math.max(300, settingsRef.current.toolStreamMinDuration * 1000);
          const fallbackId = ribbonTimers.current.get(matching.event.id);
          if (fallbackId) window.clearTimeout(fallbackId);
          ribbonTimers.current.delete(matching.event.id);
          if (elapsed >= minDisplayMs) markExiting(matching.event.id);
          else {
            const delayTimeout = window.setTimeout(() => { markExiting(matching.event.id); }, minDisplayMs - elapsed);
            ribbonTimers.current.set(matching.event.id, delayTimeout);
          }
          return previous;
        });
      }

      if (event.event === "tool_start") {
        let overflowId: string | undefined;
        setToolStreams(previous => {
          const active = previous.filter(stream => !stream.exiting);
          const overflow = active.length >= 5 ? active.at(-1) : undefined;
          if (overflow) {
            overflowId = overflow.event.id;
            const fallbackId = ribbonTimers.current.get(overflow.event.id);
            if (fallbackId) window.clearTimeout(fallbackId);
            ribbonTimers.current.delete(overflow.event.id);
          }
          const next = previous.map(stream => {
            const exiting = overflow && stream.event.id === overflow.event.id ? true : stream.exiting;
            return exiting ? { ...stream, exiting } : { ...stream, slot: Math.min(stream.slot + 1, 4) };
          });
          return [{ event, exiting: false, slot: 0 }, ...next].slice(0, 8);
        });
        if (overflowId) scheduleStreamRemoval(overflowId);
        ribbonTimestamps.current.set(event.id, Date.now());
        ribbonTimers.current.set(event.id, window.setTimeout(() => { markExiting(event.id); }, 10_000));
      }

      const timeout = (event.event === "done" || event.event === "error" ? 5.2 : settingsRef.current.bubbleDuration) * 1000;
      scheduleTransientTimer(() => {
        if (!displayOnly) setPetState(current => current === stateFromEvent(event) ? "idle" : current);
        setCurrentEvent(current => current?.id === event.id ? null : current);
      }, timeout);
    });
    // Idle/expiry are time facts, not per-event facts — sweep the session map on a low-frequency
    // timer so bursts stay off the per-event path. Deactivate a non-main session idle >60s, drop one
    // untouched >300s. Runs in this effect's scope so it shares the exact refs the event handler uses.
    const sessionSweep = window.setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [id, session] of sessionsRef.current) {
        if (id !== mainSessionIdRef.current && session.isActive && now - session.lastEventTime > 60_000 && !exitingSessionsRef.current.has(id)) {
          sessionsRef.current.set(id, { ...session, isActive: false });
          changed = true;
          updateExitingSessions(prev => new Set(prev).add(id));
          const exitId = id;
          scheduleTransientTimer(() => {
            const revived = sessionsRef.current.get(exitId);
            if (revived?.isActive) return;
            updateExitingSessions(prev => { const next = new Set(prev); next.delete(exitId); return next; });
            sessionsRef.current.delete(exitId);
            setSessions(Array.from(sessionsRef.current.values()));
          }, 700);
        }
      }
      for (const [id, session] of sessionsRef.current) {
        if (now - session.lastEventTime > 300_000) {
          sessionsRef.current.delete(id);
          updateExitingSessions(prev => { const next = new Set(prev); next.delete(id); return next; });
          changed = true;
        }
      }
      if (changed) setSessions(Array.from(sessionsRef.current.values()));
    }, 7_000);
    const offPermissionRequest = window.companion.onPermissionRequest(request => {
      setActivePermissions(prev => [...prev, request]);
      setPetState("waiting_permission");
    });
    const offPermissionResolved = window.companion.onPermissionResolved(({ id }) => {
      setActivePermissions(prev => prev.filter(permission => permission.id !== id));
    });

    return () => {
      disposed = true;
      offSettings();
      offConnection();
      offEvent();
      window.clearInterval(sessionSweep);
      offPermissionRequest();
      offPermissionResolved();
      ribbonTimers.current.forEach(id => window.clearTimeout(id));
      ribbonTimers.current.clear();
      ribbonTimestamps.current.clear();
      transientTimersRef.current.forEach(id => window.clearTimeout(id));
      transientTimersRef.current.clear();
      if (eventThrottleRef.current.timer !== null) window.clearTimeout(eventThrottleRef.current.timer);
      eventThrottleRef.current.timer = null;
      pendingEventsRef.current = [];
    };
  }, [keepEventList]);

  useEffect(() => {
    if (mainSessionId && !sessionsRef.current.has(mainSessionId) && sessionsRef.current.size === 0) {
      setMainSessionId(null);
    }
  }, [sessions, exitingSessions, mainSessionId]);

  useEffect(() => {
    const companionIds = sessions
      .filter(session => session.sessionId !== mainSessionId && (session.isActive || exitingSessions.has(session.sessionId)))
      .slice(0, 3)
      .map(session => session.sessionId);
    for (const [sid] of companionSlotRef.current) {
      if (!companionIds.includes(sid)) companionSlotRef.current.delete(sid);
    }
    const usedSlots = new Set(companionSlotRef.current.values());
    for (const sid of companionIds) {
      if (!companionSlotRef.current.has(sid)) {
        let slot = 0;
        while (usedSlots.has(slot)) slot++;
        companionSlotRef.current.set(sid, slot);
        usedSlots.add(slot);
      }
    }
  }, [sessions, exitingSessions, mainSessionId]);

  async function updateSettings(next: Partial<CompanionSettings>) {
    const saved = await window.companion.saveSettings(next);
    settingsRef.current = saved;
    setSettings(saved);
    if (next.theme || next.petTheme || next.uiStyle) applyCompanionAppearance(saved);
  }

  async function respondToPermission(id: string, decision: "allow" | "deny") {
    await window.companion.respondPermission({
      id,
      decision,
      reason: decision === "allow" ? "Approved via Clawd" : "Denied via Clawd"
    });
    setActivePermissions(prev => prev.filter(permission => permission.id !== id));
  }

  async function clearActivityHistory() {
    await window.companion.clearEventHistory();
    setEvents([]);
    setCurrentEvent(null);
    setToolStreams([]);
    sessionsRef.current.clear();
    setSessions([]);
    setExitingSessions(new Set());
    setMainSessionId(null);
    mainSessionIdRef.current = null;
    if (activePermissions.length === 0) setPetState("idle");
  }

  const displayLanguage = settings.language === "zh" || (settings.language === "auto" && document.documentElement.lang.startsWith("zh")) ? "zh" : "en";
  const displayEvents = useMemo(() => settings.hideSensitiveContent ? events.map(event => redactDisplayEvent(event, displayLanguage)) : events, [displayLanguage, events, settings.hideSensitiveContent]);
  const displayCurrentEvent = useMemo(() => settings.hideSensitiveContent && currentEvent ? redactDisplayEvent(currentEvent, displayLanguage) : currentEvent, [currentEvent, displayLanguage, settings.hideSensitiveContent]);
  const displayToolStreams = useMemo(() => settings.hideSensitiveContent ? toolStreams.map(stream => ({ ...stream, event: redactDisplayEvent(stream.event, displayLanguage) })) : toolStreams, [displayLanguage, toolStreams, settings.hideSensitiveContent]);
  const displaySessions = useMemo(() => settings.hideSensitiveContent ? sessions.map(session => ({
    ...session,
    title: `${displayLanguage === "zh" ? "会话" : "Session"} ${session.sessionId.slice(0, 6)}`,
    lastEvent: session.lastEvent ? redactDisplayEvent(session.lastEvent, displayLanguage) : session.lastEvent
  })) : sessions, [displayLanguage, sessions, settings.hideSensitiveContent]);

  // Apply a connection status fetched by the caller. The workbench Recheck pulls
  // connection status itself (so it can detect and report a failure) and applies
  // the result here only when its request sequence is still current; the
  // onConnection subscription still keeps connection live between rechecks.
  function applyConnection(next: CompanionConnectionStatus) {
    setConnection(next);
  }

  return { settings, updateSettings, connection, applyConnection, events: displayEvents, currentEvent: displayCurrentEvent, petState, toolStreams: displayToolStreams, activePermissions, sessions: displaySessions, exitingSessions, mainSessionId, companionSlotRef, respondToPermission, clearActivityHistory };
}

