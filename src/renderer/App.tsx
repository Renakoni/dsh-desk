import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { createPetEvent, PetEvent, PetState } from "../shared/events";
import {
  PET_IMAGE_SIZE,
  clampFeedbackOpacity,
  clampFeedbackScale,
  clampPermissionScale,
  clampPetOpacity,
  clampPetScale,
  getPetBubbleBottom
} from "../shared/petDisplaySettings";
import { redactDisplayEvent } from "../shared/privacy";
import { Panel } from "./components/Panel";
import { PermissionCard, type PermissionRequestView } from "./components/PermissionCard";
import { Pet } from "./components/Pet";
import { type PetAnimationKey } from "../shared/petAnimationKeys";
import type { PetPackManifest } from "../shared/petPack";
import { spritesheetAssetsFromPack } from "../shared/petPackAssets";
import { packIdFromThemeId, resolveThemeCatalog } from "../shared/petThemeCatalog";
import { displayedSpriteHeight } from "../shared/spriteFrame";
import { dragAnimationForDirection, type DragDirection } from "../shared/petDrag";
import { keepIdleAnimationConfigReference, type IdleAnimationConfig, planIdleAnimation, startIdleAnimator } from "./state/petIdleAnimator";
import { nextPetState } from "./state/petStateMachine";
import { isPetElement } from "./petHitTest";

const defaultBubbleSeconds = 8;
const soundClipMs = 3000;
const showDebugPanel = import.meta.env.DEV;

type PermissionRequestPayload = { id: string; toolName?: string; toolDetail?: string };
type PetDisplaySettings = {
  petScale?: number;
  clawdOpacity?: number;
  feedbackScale?: number;
  feedbackOpacity?: number;
  permissionScale?: number;
  bubbleDuration?: number;
  sound?: { volume?: number } | null;
  hideSensitiveContent?: boolean;
  language?: "auto" | "zh" | "en";
  stateAnimations?: Record<string, string> | null;
  idleAnim?: IdleAnimationConfig | null;
  petTheme?: string;
};

type PetCompanionApi = {
  initialState?: { settings: PetDisplaySettings; petPacks: PetPackManifest[] };
  notifyPetRendered?: () => void;
  getSettings?: () => Promise<PetDisplaySettings>;
  onSettings?: (callback: (settings: PetDisplaySettings) => void) => () => void;
  onPreviewPetAnimation: (callback: (animationKey: string) => void) => () => void;
  onPermissionRequest?: (callback: (request: PermissionRequestPayload) => void) => () => void;
  onPermissionResolved?: (callback: (payload: { id: string }) => void) => () => void;
  respondPermission?: (response: { id: string; decision: "allow" | "deny"; reason?: string }) => Promise<void>;
  onPlaySound?: (callback: (dataUrl: string) => void) => () => void;
  listPetPacks?: () => Promise<PetPackManifest[]>;
  onPetPacksChanged?: (callback: (payload: unknown) => void) => () => void;
  onPetDragDirection?: (callback: (direction: "left" | "right" | null) => void) => () => void;
  onPetDoubleClickProbe?: (callback: (point: { x: number; y: number }) => void) => () => void;
  openSettings?: () => Promise<void> | void;
};

function petCompanion(): PetCompanionApi | undefined {
  return (window as Window & { companion?: PetCompanionApi }).companion;
}

function normalizePetRendererSettings(settings?: PetDisplaySettings) {
  const seconds = typeof settings?.bubbleDuration === "number" && settings.bubbleDuration > 0
    ? Math.min(120, settings.bubbleDuration)
    : defaultBubbleSeconds;
  const volume = settings?.sound?.volume;
  const mappings = settings?.stateAnimations;
  const idleAnim = settings?.idleAnim && typeof settings.idleAnim === "object" ? settings.idleAnim : null;
  return {
    display: {
      scale: clampPetScale(settings?.petScale),
      opacity: clampPetOpacity(settings?.clawdOpacity),
      feedbackScale: clampFeedbackScale(settings?.feedbackScale),
      feedbackOpacity: clampFeedbackOpacity(settings?.feedbackOpacity),
      permissionScale: clampPermissionScale(settings?.permissionScale)
    },
    hideSensitiveContent: settings?.hideSensitiveContent === true,
    stateAnimations: mappings && typeof mappings === "object" && !Array.isArray(mappings) ? mappings : {},
    idleAnim,
    petTheme: typeof settings?.petTheme === "string" ? settings.petTheme : "",
    displayLanguage: settings?.language === "zh" || (settings?.language === "auto" && navigator.language.toLowerCase().startsWith("zh")) ? "zh" as const : "en" as const,
    bubbleDurationMs: seconds * 1000,
    soundVolume: typeof volume === "number" ? Math.max(0, Math.min(1, volume)) : 0.6
  };
}

export default function App() {
  const initialState = useMemo(() => petCompanion()?.initialState, []);
  const initialSettings = useMemo(() => normalizePetRendererSettings(initialState?.settings), [initialState]);
  const [state, setState] = useState<PetState>("idle");
  const [lastEvent, setLastEvent] = useState<PetEvent | null>(null);
  const [permissions, setPermissions] = useState<PermissionRequestView[]>([]);
  const [petDisplay, setPetDisplay] = useState(initialSettings.display);
  const [hideSensitiveContent, setHideSensitiveContent] = useState(initialSettings.hideSensitiveContent);
  const [stateAnimations, setStateAnimations] = useState<Record<string, string>>(initialSettings.stateAnimations);
  const [idleAnimConfig, setIdleAnimConfig] = useState<IdleAnimationConfig | null>(initialSettings.idleAnim);
  const [idleAnimation, setIdleAnimation] = useState<PetAnimationKey | null>(null);
  const [petTheme, setPetTheme] = useState<string>(initialSettings.petTheme);
  const [petPacks, setPetPacks] = useState<PetPackManifest[]>(initialState?.petPacks ?? []);
  const [displayLanguage, setDisplayLanguage] = useState<"zh" | "en">(initialSettings.displayLanguage);
  const [previewAnimation, setPreviewAnimation] = useState<{ key: string; nonce: number } | null>(null);
  const resetTimer = useRef<number | null>(null);
  const notificationTimer = useRef<number | null>(null);
  const stableEvent = useRef<PetEvent | null>(null);
  // "Bubble stay" (bubbleDuration) and sound volume live in refs so the timers
  // and the play-sound handler read the latest value without re-subscribing.
  const bubbleDurationMsRef = useRef(initialSettings.bubbleDurationMs);
  const soundVolumeRef = useRef(initialSettings.soundVolume);

  useEffect(() => {
    const notify = () => petCompanion()?.notifyPetRendered?.();
    if (typeof window.requestAnimationFrame !== "function") {
      notify();
      return undefined;
    }
    const frame = window.requestAnimationFrame(notify);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  function applyEvent(event: PetEvent) {
    if (notificationTimer.current) {
      window.clearTimeout(notificationTimer.current);
      notificationTimer.current = null;
    }

    if (event.notificationKind === "info") {
      const previous = stableEvent.current;
      setLastEvent(event);
      notificationTimer.current = window.setTimeout(() => {
        setLastEvent(current => current?.id === event.id ? previous : current);
        notificationTimer.current = null;
      }, bubbleDurationMsRef.current);
      return;
    }

    setState(current => {
      const next = nextPetState(current, event);
      if (next !== current || event.event === current) {
        stableEvent.current = event;
        setLastEvent(event);
      }
      return next;
    });
  }

  function applyDebugEvent(event: PetEvent) {
    if (notificationTimer.current) window.clearTimeout(notificationTimer.current);
    notificationTimer.current = null;
    stableEvent.current = event;
    setLastEvent(event);
    setState(event.event);
  }

  useEffect(() => {
    const unsubscribe = window.petAPI?.onPetEvent(applyEvent);
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    const companion = petCompanion();
    const applySettings = (settings: PetDisplaySettings) => {
      const next = normalizePetRendererSettings(settings);
      setPetDisplay(next.display);
      bubbleDurationMsRef.current = next.bubbleDurationMs;
      soundVolumeRef.current = next.soundVolume;
      setHideSensitiveContent(next.hideSensitiveContent);
      setStateAnimations(next.stateAnimations);
      // Settings broadcasts always deliver a fresh object; keep the previous
      // reference when the config is unchanged so unrelated saves don't reset
      // the rotation timers below.
      setIdleAnimConfig(previous => keepIdleAnimationConfigReference(previous, next.idleAnim));
      setDisplayLanguage(next.displayLanguage);
      setPetTheme(next.petTheme);
    };
    let disposed = false;
    let settingsBroadcastReceived = false;
    const offSettings = companion?.onSettings?.(settings => {
      settingsBroadcastReceived = true;
      if (!disposed) applySettings(settings);
    });
    const initialSettings = companion?.getSettings?.();
    if (initialSettings) {
      void initialSettings.then(settings => {
        if (!disposed && !settingsBroadcastReceived) applySettings(settings);
      });
    }
    return () => {
      disposed = true;
      offSettings?.();
    };
  }, []);

  // The floating pet is the always-alive window, so it plays notification sounds
  // (done/error/permission). The main process gates on sound.enabled + rules
  // before sending, so here we just play the clip at the current volume.
  useEffect(() => {
    return petCompanion()?.onPlaySound?.(dataUrl => {
      try {
        const audio = new Audio(dataUrl);
        audio.volume = soundVolumeRef.current;
        const stop = window.setTimeout(() => { audio.pause(); audio.currentTime = 0; }, soundClipMs);
        audio.addEventListener("ended", () => window.clearTimeout(stop), { once: true });
        // play() rejects (autoplay policy, decode/device error) inside a Promise
        // the sync try/catch can't see, so handle it here to avoid an unhandled
        // rejection and clear the clip timer.
        audio.play().catch(() => window.clearTimeout(stop));
      } catch { /* audio playback is best-effort */ }
    });
  }, []);

  // Permission requests come from the main-process broker (the /permission
  // blocking flow), carrying an id we must echo back so the waiting hook —
  // and therefore Claude Code — receives the real allow/deny decision.
  useEffect(() => {
    const companion = petCompanion();
    const offRequest = companion?.onPermissionRequest?.(request => {
      setPermissions(current => {
        if (current.some(item => item.id === request.id)) return current;
        return [...current, { id: request.id, tool: request.toolName ?? "Tool request", detail: request.toolDetail }];
      });
    });
    const offResolved = companion?.onPermissionResolved?.(({ id }) => {
      setPermissions(current => current.filter(item => item.id !== id));
    });
    return () => { offRequest?.(); offResolved?.(); };
  }, []);

  function respondPermission(id: string, decision: "allow" | "deny") {
    void petCompanion()?.respondPermission?.({ id, decision });
    setPermissions(current => current.filter(item => item.id !== id));
  }

  useEffect(() => {
    const unsubscribe = petCompanion()?.onPreviewPetAnimation(animationKey => {
      if (animationKey === "__clear_preview") {
        setPreviewAnimation(null);
        return;
      }
      setPreviewAnimation({ key: animationKey, nonce: Date.now() });
    });
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    if (resetTimer.current) window.clearTimeout(resetTimer.current);

    if (state === "completed") {
      resetTimer.current = window.setTimeout(() => {
        const idleEvent = createPetEvent("idle", { title: "Idle" });
        setState("idle");
        stableEvent.current = idleEvent;
        setLastEvent(idleEvent);
      }, bubbleDurationMsRef.current);
    }

    return () => {
      if (resetTimer.current) window.clearTimeout(resetTimer.current);
    };
  }, [state]);

  useEffect(() => () => {
    if (notificationTimer.current) window.clearTimeout(notificationTimer.current);
  }, []);

  // The active theme decides which animations exist and how states resolve.
  // Installed packs are fetched when a pack theme becomes active and
  // refetched when the pack store changes (import/overwrite/remove), so a
  // reinstalled active pack never plays stale frame data.
  const [petPacksVersion, setPetPacksVersion] = useState(0);
  useEffect(() => {
    return petCompanion()?.onPetPacksChanged?.(() => setPetPacksVersion(version => version + 1));
  }, []);
  useEffect(() => {
    if (!packIdFromThemeId(petTheme)) {
      setPetPacks([]);
      return;
    }
    let cancelled = false;
    void petCompanion()?.listPetPacks?.()
      .then(packs => { if (!cancelled) setPetPacks(Array.isArray(packs) ? packs : []); })
      .catch(() => { if (!cancelled) setPetPacks([]); });
    return () => { cancelled = true; };
  }, [petTheme, petPacksVersion]);

  const themeCatalog = useMemo(() => resolveThemeCatalog(petTheme, petPacks), [petTheme, petPacks]);
  const activePack = useMemo(() => {
    const packId = packIdFromThemeId(petTheme);
    return packId ? petPacks.find(pack => pack.id === packId) ?? null : null;
  }, [petTheme, petPacks]);
  const spritesheet = useMemo(() => activePack ? spritesheetAssetsFromPack(activePack) : null, [activePack]);
  const petImageHeight = spritesheet
    ? displayedSpriteHeight(spritesheet.cellWidth, spritesheet.cellHeight, PET_IMAGE_SIZE)
    : PET_IMAGE_SIZE;

  const activePermission = permissions[0];
  const petState: PetState = activePermission ? "permission-prompt" : state;

  // Random idle rotation runs only while the pet is actually idling (a pending
  // permission counts as busy); leaving idle or changing the config stops the
  // animator, which also clears any sprite it is currently showing.
  useEffect(() => {
    if (petState !== "idle") {
      setIdleAnimation(null);
      return;
    }
    const plan = planIdleAnimation(idleAnimConfig, themeCatalog);
    if (!plan) {
      setIdleAnimation(null);
      return;
    }
    return startIdleAnimator(plan, setIdleAnimation);
  }, [petState, idleAnimConfig, themeCatalog]);

  // Dragging is native OS window drag (-webkit-app-region: drag on the pet
  // element): the compositor moves the window at input rate — smoother than
  // any app-driven loop — and no pointer capture exists to corrupt. Main
  // watches the window's move stream and reports the walk direction
  // (reference 4px threshold), which is all the renderer needs to play the
  // codex-pet locomotion rows.
  const [dragDirection, setDragDirection] = useState<DragDirection | null>(null);
  useEffect(() => {
    return petCompanion()?.onPetDragDirection?.(direction => {
      setDragDirection(direction === "left" || direction === "right" ? direction : null);
    });
  }, []);

  // Main reconstructs a pet double-click from WM_PARENTNOTIFY and sends the click
  // point (physical px, parent-client space). Convert to CSS px and hit-test it
  // against the actual pet element: only the pet opens the panel — the bubble,
  // permission card, Allow/Deny buttons and transparent background are excluded.
  useEffect(() => {
    return petCompanion()?.onPetDoubleClickProbe?.(({ x, y }) => {
      const ratio = window.devicePixelRatio || 1;
      const target = document.elementFromPoint(x / ratio, y / ratio);
      if (isPetElement(target)) void petCompanion()?.openSettings?.();
    });
  }, []);

  const appStyle = { "--pet-bubble-bottom": `${getPetBubbleBottom(petDisplay.scale, petImageHeight)}px` } as CSSProperties;
  const displayEvent = hideSensitiveContent && lastEvent ? redactDisplayEvent(lastEvent, displayLanguage) : lastEvent;

  return (
    <main className={`app state-${petState}`} style={appStyle}>
      {activePermission ? (
        <PermissionCard
          request={activePermission}
          queueCount={permissions.length}
          onAllow={() => respondPermission(activePermission.id, "allow")}
          onDeny={() => respondPermission(activePermission.id, "deny")}
          scale={petDisplay.permissionScale}
        />
      ) : (
        <Panel state={state} event={displayEvent} scale={petDisplay.feedbackScale} opacity={petDisplay.feedbackOpacity} />
      )}
      <Pet
        state={petState}
        stateAnimations={stateAnimations}
        idleAnimation={idleAnimation}
        previewAnimation={previewAnimation}
        dragAnimation={dragAnimationForDirection(themeCatalog, dragDirection)}
        scale={petDisplay.scale}
        opacity={petDisplay.opacity}
        catalog={themeCatalog}
        spritesheet={spritesheet}
      />
      {showDebugPanel && (
        <div className="debug-panel">
          <button onClick={() => applyDebugEvent(createPetEvent("idle", { title: "Idle" }))}>Idle</button>
          <button onClick={() => applyDebugEvent(createPetEvent("running", { title: "Working", tool: "Read", detail: "src/renderer/components/PermissionCard.tsx" }))}>Running</button>
          <button onClick={() => setPermissions([{ id: `debug-${Date.now()}`, tool: "Bash", detail: "npm run build" }])}>Permission</button>
          <button onClick={() => applyDebugEvent(createPetEvent("completed", { title: "Completed", message: "Task finished" }))}>Completed</button>
          <button onClick={() => applyDebugEvent(createPetEvent("error", { title: "Tool failed", tool: "Bash", message: "npm run build: exited with code 1" }))}>Error</button>
          <button onClick={() => applyDebugEvent(createPetEvent("idle", { title: "Waiting for you" }))}>Waiting</button>
        </div>
      )}
    </main>
  );
}
