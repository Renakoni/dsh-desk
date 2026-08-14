// @ts-nocheck
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { CompanionSettings, NotificationRule } from "../../shared/events";
import { useI18n } from "../useI18n";
import { Slider } from "./ui/Slider";
import { Toggle } from "./ui/Toggle";

type BuiltInSound = "done" | "error" | "permission";
type SoundEventType = "done" | "error" | "permission_wait";

const maxSoundMilliseconds = 3000;
const soundEventTypes: SoundEventType[] = ["done", "error", "permission_wait"];
const builtInByEvent: Record<SoundEventType, BuiltInSound> = {
  done: "done",
  error: "error",
  permission_wait: "permission"
};

async function playPreview(dataUrl: string, volume: number, cleanups: Set<() => void>) {
  const audio = new Audio(dataUrl);
  audio.volume = volume;
  let stopped = false;
  let stopTimer = 0;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    window.clearTimeout(stopTimer);
    audio.pause();
    audio.currentTime = 0;
    cleanups.delete(stop);
  };
  stopTimer = window.setTimeout(stop, maxSoundMilliseconds);
  cleanups.add(stop);
  audio.addEventListener("ended", stop, { once: true });
  try {
    await audio.play();
  } catch (error) {
    stop();
    throw error;
  }
}

export function NotificationRulesPanel({ settings, updateSettings }: { settings: CompanionSettings; updateSettings: (s: Partial<CompanionSettings>) => void }) {
  const { t } = useI18n();
  const rules: NotificationRule[] = settings.notificationRules ?? [];
  const sound = settings.sound;
  const [status, setStatus] = useState<Record<string, { ok: boolean; error?: string } | null>>({});
  const [defaultPaths, setDefaultPaths] = useState<Record<BuiltInSound, string | null> | null>(null);
  const rulesRef = useRef(rules);
  const soundRef = useRef(sound);
  const mountedRef = useRef(true);
  const previewCleanupsRef = useRef<Set<() => void>>(new Set());
  const statusTimersRef = useRef<Set<number>>(new Set());

  useEffect(() => { rulesRef.current = rules; }, [rules]);
  useEffect(() => { soundRef.current = sound; }, [sound]);

  useEffect(() => {
    let cancelled = false;
    void window.companion.getDefaultSoundPaths()
      .then(paths => { if (!cancelled) setDefaultPaths(paths); })
      .catch(() => { if (!cancelled) setDefaultPaths(null); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      statusTimersRef.current.forEach(timer => window.clearTimeout(timer));
      statusTimersRef.current.clear();
      previewCleanupsRef.current.forEach(stop => stop());
      previewCleanupsRef.current.clear();
    };
  }, []);

  const eventLabels: Record<SoundEventType, string> = {
    done: t("notifRules.done", "Done"),
    error: t("notifRules.error", "Error"),
    permission_wait: t("notifRules.permission", "Permission request")
  };

  const defaultRule = (eventType: SoundEventType): NotificationRule => ({
    eventType,
    enabled: true,
    playSound: true
  });

  const rulesByEvent = useMemo(() => new Map(rules.map(rule => [rule.eventType, rule])), [rules]);
  const updateRule = (eventType: SoundEventType, patch: Partial<NotificationRule>) => {
    const currentRules = rulesRef.current;
    const existing = currentRules.find(rule => rule.eventType === eventType) ?? defaultRule(eventType);
    const nextRules = [
      ...currentRules.filter(rule => rule.eventType !== eventType),
      { ...existing, ...patch, eventType, enabled: true }
    ];
    rulesRef.current = nextRules;
    updateSettings({
      notificationRules: nextRules
    });
  };

  const updateSound = (patch: Partial<typeof sound>) => {
    const nextSound = { ...soundRef.current, ...patch };
    soundRef.current = nextSound;
    updateSettings({ sound: nextSound });
  };

  const setDefaultSound = (eventType: SoundEventType) => {
    const next = { ...(soundRef.current.eventFiles ?? {}) };
    delete next[eventType];
    updateSound({ eventFiles: next });
    updateRule(eventType, { playSound: true });
  };

  const pickEventSound = async (eventType: SoundEventType) => {
    const file = await window.companion.pickSoundFile();
    if (file !== null) {
      updateSound({ eventFiles: { ...(soundRef.current.eventFiles ?? {}), [eventType]: file } });
      updateRule(eventType, { playSound: true });
    }
  };

  const clearEventSound = (eventType: SoundEventType) => {
    const next = { ...(soundRef.current.eventFiles ?? {}) };
    delete next[eventType];
    updateSound({ eventFiles: next });
  };

  const previewEventSound = async (eventType: SoundEventType) => {
    const currentSound = soundRef.current;
    const builtIn = builtInByEvent[eventType];
    const customFile = currentSound.eventFiles?.[eventType];
    setStatus(prev => ({ ...prev, [eventType]: null }));
    const result = customFile ? await window.companion.previewSoundFile(customFile) : await window.companion.previewSound(builtIn);
    if (!mountedRef.current) return;
    if (result.ok && result.dataUrl) {
      try {
        await playPreview(result.dataUrl, currentSound.volume, previewCleanupsRef.current);
        if (mountedRef.current) setStatus(prev => ({ ...prev, [eventType]: { ok: true } }));
      } catch {
        if (mountedRef.current) setStatus(prev => ({ ...prev, [eventType]: { ok: false, error: t("sound.failed", "播放失败") } }));
      }
    } else {
      setStatus(prev => ({ ...prev, [eventType]: result }));
    }
    if (!mountedRef.current) return;
    const timer = window.setTimeout(() => {
      statusTimersRef.current.delete(timer);
      if (mountedRef.current) setStatus(prev => ({ ...prev, [eventType]: null }));
    }, 3000);
    statusTimersRef.current.add(timer);
  };

  const pathLines = soundEventTypes
    .filter(eventType => rulesByEvent.get(eventType)?.playSound || sound.eventFiles?.[eventType])
    .map(eventType => {
      const customFile = sound.eventFiles?.[eventType];
      const builtIn = builtInByEvent[eventType];
      const path = customFile ?? (defaultPaths ? defaultPaths[builtIn] : null);
      return path ? { eventType, path, custom: Boolean(customFile) } : null;
    })
    .filter((item): item is { eventType: SoundEventType; path: string; custom: boolean } => Boolean(item));

  return (
    <div className="notification-sound-panel">
      <div className="notification-master-row">
        <div className="notification-master-copy">
          <strong>{t("notifications.masterSwitch", "通知和音效")}</strong>
          <p>{t("notifications.masterHint", "Windows 通知由桌宠统一发送；音效只保留完成、错误和权限请求。")}</p>
        </div>
        <Toggle label={t("notifications.systemNotification", "Windows 通知")} checked={settings.notificationsEnabled !== false} onChange={notificationsEnabled => updateSettings({ notificationsEnabled })} />
      </div>

      <div className="notification-global-grid">
        <Toggle label={t("sound.enable", "启用音效")} checked={sound.enabled} onChange={soundEnabled => updateSound({ enabled: soundEnabled })} />
        <Slider label={t("sound.volume", "音量")} min={0} max={1} step={0.05} value={sound.volume} format={v => `${Math.round(v * 100)}%`} onChange={volume => updateSound({ volume })} />
      </div>

      <div className="notification-rules-table">
        <div className="notification-rules-head compact">
          <span>{t("notifications.eventType", "事件类型")}</span>
          <span>{t("common.enabled", "启用")}</span>
          <span>{t("sound.audioSource", "音频来源")}</span>
        </div>
        {soundEventTypes.map(eventType => {
          const rule = rulesByEvent.get(eventType) ?? defaultRule(eventType);
          const builtIn = builtInByEvent[eventType];
          const customFile = sound.eventFiles?.[eventType];
          return (
            <div key={eventType} className="notification-rule-row compact">
              <strong>{eventLabels[eventType]}</strong>
              <div className="notification-toggle-cell">
                <Toggle label="" ariaLabel={eventLabels[eventType]} checked={rule.enabled !== false && rule.playSound !== false} onChange={playSound => updateRule(eventType, { playSound })} />
              </div>
              <div className="notification-sound-actions">
                <span className={`sound-file-pill ${customFile ? "custom" : "default"}`}>
                  {customFile ? t("sound.custom", "自定义") : t("sound.default", "默认")}
                </span>
                {customFile ? <button className="ghost-btn" onClick={() => setDefaultSound(eventType)}>{t("sound.useDefault", "使用默认")}</button> : null}
                <button className="ghost-btn" onClick={() => pickEventSound(eventType)}>{customFile ? t("sound.changeFile", "更换") : t("sound.chooseFile", "选择文件")}</button>
                <button className="ghost-btn" onClick={() => previewEventSound(eventType)}>{t("sound.preview", "试听")}</button>
                {customFile ? <button className="ghost-btn danger" onClick={() => clearEventSound(eventType)}>{t("sound.clear", "清除")}</button> : null}
                {status[eventType] ? <span className={`sound-status ${status[eventType]!.ok ? "ok" : "err"}`}>{status[eventType]!.ok ? t("sound.played", "已播放") : status[eventType]!.error ?? t("common.failed", "失败")}</span> : null}
              </div>
            </div>
          );
        })}
      </div>

      <p className="note">{t("sound.hint", "音频文件仅支持 wav/mp3；长音频最多播放 3 秒。")}</p>
      {pathLines.length > 0 && !settings.hideSensitiveContent ? (
        <div className="sound-path-tips">
          <span>{t("sound.pathTips", "当前音频路径")}</span>
          {pathLines.map(item => (
            <small key={item.eventType}>{eventLabels[item.eventType]} · {item.custom ? t("sound.custom", "自定义") : t("sound.default", "默认")}: {item.path}</small>
          ))}
        </div>
      ) : null}
    </div>
  );
}
