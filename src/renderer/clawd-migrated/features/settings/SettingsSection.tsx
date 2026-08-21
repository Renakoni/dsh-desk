// @ts-nocheck
import React from "react";
import { Bell, Bot, Cable, Gauge, LockKeyhole, MessageSquareText, MousePointer2, RefreshCw, RotateCcw, Shield, ShieldCheck, SlidersHorizontal, Sparkles, Timer } from "lucide-react";
import { defaultSettings } from "../../../shared/events";
import { useI18n } from "../../useI18n";
import minatoAquaCover from "../../../assets/themes/minato-aqua-cover.png";
import { NotificationRulesPanel } from "../../components/NotificationRulesPanel";
import { CurrencySegmented, GroupCard, LanguageSegmented, SettingsInfoRow, Slider, ThemeSegmented, Toggle } from "../../components/workbench/Primitives";
import { ConnectionManagement } from "./ConnectionManagement";
import { getPetTheme } from "../../utils/petThemes";

export function SettingsSection({
  settings,
  updateSettings,
  connection,
  now,
  hookStatus,
  hookCheckError = false,
  hookChecking = false,
  hookActionOutcome = null,
  onHookRecheck,
  onHookOperationComplete,
  activeSettingsSubsection,
  setActiveSettingsSubsection,
  sectionContentRef,
  locale,
  setLocale,
  appVersion,
  updateStatus,
  checkingUpdate,
  handleCheckUpdate,
  petPacks = []
}: {
  settings: any;
  updateSettings: (settings: any) => void;
  connection: any;
  now: number;
  hookStatus: any;
  hookCheckError?: boolean;
  hookChecking?: boolean;
  hookActionOutcome?: any;
  onHookRecheck?: () => void;
  onHookOperationComplete?: (outcome: any) => void;
  activeSettingsSubsection: string;
  setActiveSettingsSubsection: (section: string) => void;
  sectionContentRef: React.MutableRefObject<HTMLDivElement | null>;
  locale: string;
  setLocale: (locale: string) => void;
  appVersion: string;
  updateStatus: any;
  checkingUpdate: boolean;
  handleCheckUpdate: () => void;
  petPacks?: any[];
}) {
  const { t } = useI18n();
  const activePetTheme = getPetTheme(settings.petTheme, petPacks);
  const petThemeCovers: Record<string, string> = {
    "minato-aqua": minatoAquaCover
  };
  const aboutCover = petThemeCovers[activePetTheme.id] ?? minatoAquaCover;
  // Mirrors the footer's update state machine faithfully (same priority order)
  // instead of collapsing every in-between state to "idle".
  const aboutUpdateValue = updateStatus.error ? updateStatus.error
    : updateStatus.downloaded ? t("update.ready", "已下载")
    : updateStatus.downloading ? t("update.downloading", "下载中 {progress}%").replace("{progress}", String(Math.round(updateStatus.progress ?? 0)))
    : checkingUpdate || updateStatus.checking ? t("update.checking", "正在检查更新...")
    : updateStatus.available ? `${t("update.availableShort", "发现新版本")}${updateStatus.version ? ` v${updateStatus.version}` : ""}`
    : updateStatus.upToDate ? t("update.upToDate", "已是最新版本")
    : t("update.notChecked", "尚未检查");
  const aboutUpdateTitle = updateStatus.error ? updateStatus.error
    : updateStatus.lastCheckedAt ? `${t("update.lastChecked", "上次检查")}: ${new Date(updateStatus.lastCheckedAt).toLocaleString()}`
    : undefined;

  return (
    <section className="settings-page">
      <header className="settings-page-head">
        <div>
          <span>{t("settings.eyebrow", "Settings")}</span>
          <h2>DSH Desk</h2>
        </div>
        <nav className="settings-subtabs">
          {[
            { id: "general", icon: <Gauge size={14} />, label: t("settings.subtabs.general", "通用") },
            { id: "pet", icon: <Bot size={14} />, label: t("settings.subtabs.pet", "桌宠") },
            { id: "notifications", icon: <Bell size={14} />, label: t("settings.subtabs.notifications", "通知") },
            { id: "about", icon: <Sparkles size={14} />, label: t("settings.subtabs.about", "关于") }
          ].map(tab => (
            <button
              key={tab.id}
              className={`settings-subtab ${activeSettingsSubsection === tab.id ? "active" : ""}`}
              onClick={() => {
                setActiveSettingsSubsection(tab.id);
                sectionContentRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
              }}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>
      </header>

      <div className="settings-subsection-content">
        {activeSettingsSubsection === "general" && <>
          <GroupCard icon={<Gauge size={18} />} title={t("sections.basicPreferences", "基础偏好")}>
            <section className="settings-group theme-settings-group">
              <h3 className="panel-subtitle">{t("sections.theme", "界面主题")}</h3>
              <div className="theme-style-row">
                <ThemeSegmented value={settings.theme ?? "system"} onChange={theme => updateSettings({ theme })} />
                <LanguageSegmented value={settings.language === "auto" ? locale : settings.language ?? locale} onChange={language => {
                  updateSettings({ language });
                  setLocale(language);
                }} />
              </div>
            </section>
          </GroupCard>

          <GroupCard icon={<MousePointer2 size={18} />} title={t("sections.startup", "启动与更新")}>
            <Toggle label={t("behavior.launchAtLogin", "开机自启")} checked={settings.launchAtLogin} onChange={launchAtLogin => updateSettings({ launchAtLogin })} />
            <Toggle label={t("behavior.autoUpdate", "启动时自动检查更新")} checked={settings.autoUpdateEnabled} onChange={autoUpdateEnabled => updateSettings({ autoUpdateEnabled })} />
            <Toggle label={t("behavior.openSettingsOnStart", "启动时打开配置面板")} checked={settings.openSettingsOnStart} onChange={openSettingsOnStart => updateSettings({ openSettingsOnStart })} />
          </GroupCard>

          <GroupCard icon={<Shield size={18} />} title={t("sections.contentDisplay", "内容显示")}>
            <CurrencySegmented value={settings.displayCurrency ?? "CNY"} onChange={displayCurrency => updateSettings({ displayCurrency })} />
            <Toggle label={t("appearance.hideSensitiveContent", "隐藏路径与内容")} checked={settings.hideSensitiveContent} onChange={hideSensitiveContent => updateSettings({ hideSensitiveContent })} />
            <p className="note">{t("appearance.hideSensitiveContentNote", "在界面和系统通知中隐藏文件路径与消息内容；仅改变屏幕上的显示，不会删除或加密任何本地数据。权限确认仍会显示决策所需的详情。")}</p>
          </GroupCard>

          <GroupCard
            icon={<Cable size={18} />}
            title={t("sections.connectionDetails", "连接详情")}
            action={onHookRecheck ? (
              <button
                type="button"
                className="group-reset-button"
                title={t("connection.recheck", "重新检查")}
                aria-label={t("connection.recheck", "重新检查")}
                disabled={hookChecking}
                onClick={onHookRecheck}
              >
                <RefreshCw size={14} className={hookChecking ? "spin" : undefined} />
              </button>
            ) : undefined}
          >
            <label className="settings-inline-field">
              <span>{t("connection.webOrigin", "DSH Web 地址")}</span>
              <input
                type="url"
                value={settings.dshWebOrigin ?? "http://127.0.0.1:3080"}
                onChange={event => updateSettings({ dshWebOrigin: event.target.value })}
                placeholder="http://127.0.0.1:3080"
                spellCheck={false}
              />
            </label>
            <p className="note">{t("connection.webOriginNote", "主题管理请求发送到正在运行的 DSH Web。使用 --port 启动 DSH 时，请填写对应端口。")}</p>
            <ConnectionManagement
              hideSensitive={settings.hideSensitiveContent === true}
              connection={connection}
              now={now}
              hookStatus={hookStatus}
              checkError={hookCheckError}
              actionOutcome={hookActionOutcome}
              onRecheck={onHookRecheck}
              onOperationComplete={onHookOperationComplete}
            />
          </GroupCard>
        </>}

        {activeSettingsSubsection === "pet" && <>
          <GroupCard icon={<Bot size={18} />} title={t("sections.petDisplay", "桌宠显示")}>
            <Toggle label={t("appearance.enablePet", "启用桌宠")} checked={settings.petEnabled} onChange={petEnabled => updateSettings({ petEnabled })} />
            <Toggle label={t("appearance.alwaysOnTop", "始终置顶")} checked={settings.alwaysOnTop} onChange={alwaysOnTop => updateSettings({ alwaysOnTop })} />
            <Toggle label={t("appearance.showBubbles", "显示气泡")} checked={settings.showBubbles} onChange={showBubbles => updateSettings({ showBubbles })} />
          </GroupCard>

          <div className="pet-display-controls">
            <GroupCard
              className="pet-display-group pet-display-group-primary"
              icon={<SlidersHorizontal size={17} />}
              title={t("appearance.petAppearance", "桌宠外观")}
              action={<button type="button" className="group-reset-button" title={t("common.reset", "重置")} aria-label={t("common.reset", "重置")} disabled={settings.petScale === defaultSettings.petScale && settings.clawdScale === defaultSettings.clawdScale && settings.clawdOpacity === defaultSettings.clawdOpacity} onClick={() => updateSettings({ petScale: defaultSettings.petScale, clawdScale: defaultSettings.clawdScale, clawdOpacity: defaultSettings.clawdOpacity })}><RotateCcw size={14} /></button>}
            >
              <Slider label={t("appearance.petSize", "桌宠大小")} min={0.7} max={1.35} step={0.05} value={settings.petScale} format={v => `${Math.round(v * 100)}%`} onChange={petScale => updateSettings({ petScale })} />
              <Slider label={t("appearance.clawdOpacity", "桌宠透明度")} min={0.5} max={1} step={0.05} value={settings.clawdOpacity} format={v => `${Math.round(v * 100)}%`} onChange={clawdOpacity => updateSettings({ clawdOpacity })} />
            </GroupCard>

            <GroupCard
              className={`pet-display-group${settings.showBubbles ? "" : " pet-display-group-disabled"}`}
              icon={<MessageSquareText size={17} />}
              title={t("appearance.statusFeedback", "状态反馈")}
              action={<button type="button" className="group-reset-button" title={t("common.reset", "重置")} aria-label={t("common.reset", "重置")} disabled={!settings.showBubbles || (settings.feedbackScale === defaultSettings.feedbackScale && settings.feedbackOpacity === defaultSettings.feedbackOpacity)} onClick={() => updateSettings({ feedbackScale: defaultSettings.feedbackScale, feedbackOpacity: defaultSettings.feedbackOpacity })}><RotateCcw size={14} /></button>}
            >
              <Slider disabled={!settings.showBubbles} label={t("appearance.feedbackSize", "反馈大小")} min={0.75} max={1.35} step={0.05} value={settings.feedbackScale} format={v => `${Math.round(v * 100)}%`} onChange={feedbackScale => updateSettings({ feedbackScale })} />
              <Slider disabled={!settings.showBubbles} label={t("appearance.feedbackOpacity", "反馈透明度")} min={0.5} max={1} step={0.05} value={settings.feedbackOpacity} format={v => `${Math.round(v * 100)}%`} onChange={feedbackOpacity => updateSettings({ feedbackOpacity })} />
            </GroupCard>

            <GroupCard
              className="pet-display-group"
              icon={<ShieldCheck size={17} />}
              title={t("appearance.permissionConfirmation", "权限确认")}
              action={<button type="button" className="group-reset-button" title={t("common.reset", "重置")} aria-label={t("common.reset", "重置")} disabled={settings.permissionScale === defaultSettings.permissionScale} onClick={() => updateSettings({ permissionScale: defaultSettings.permissionScale })}><RotateCcw size={14} /></button>}
            >
              <Slider label={t("appearance.permissionCardSize", "权限卡片大小")} min={0.85} max={1.25} step={0.05} value={settings.permissionScale} format={v => `${Math.round(v * 100)}%`} onChange={permissionScale => updateSettings({ permissionScale })} />
              <div className="pet-display-fixed-row">
                <span>{t("appearance.opacity", "透明度")}</span>
                <strong><LockKeyhole size={13} aria-hidden="true" />100%</strong>
              </div>
            </GroupCard>
          </div>

        </>}

        {activeSettingsSubsection === "notifications" && <>
          <GroupCard icon={<Bell size={18} />} title={t("sections.sound", "通知和音效")}>
            <NotificationRulesPanel settings={settings} updateSettings={updateSettings} />
          </GroupCard>

          <GroupCard icon={<Timer size={18} />} title={t("sections.time", "时间与提示")}>
            <Toggle label={t("behavior.permissionDialog", "权限申请卡片")} checked={settings.permissionDialogEnabled} onChange={permissionDialogEnabled => updateSettings({ permissionDialogEnabled })} />
            <Slider label={t("behavior.bubbleStay", "气泡停留")} min={3} max={18} step={1} value={settings.bubbleDuration} format={v => `${v} ${t("common.seconds", "秒")}`} onChange={bubbleDuration => updateSettings({ bubbleDuration })} />
            <Slider label={t("behavior.permissionWait", "权限等待")} min={5} max={60} step={5} value={settings.permissionWaitSeconds} format={v => `${v} ${t("common.seconds", "秒")}`} onChange={permissionWaitSeconds => updateSettings({ permissionWaitSeconds })} />
            <Slider label={t("behavior.toolStreamStay", "工具流停留")} min={0.3} max={3} step={0.1} value={settings.toolStreamMinDuration} format={v => `${v.toFixed(1)} ${t("common.seconds", "秒")}`} onChange={toolStreamMinDuration => updateSettings({ toolStreamMinDuration })} />
          </GroupCard>
        </>}

        {activeSettingsSubsection === "about" && (
          <div className="settings-about-page">
            {aboutCover ? (
              <img className="settings-about-portrait" src={aboutCover} alt="" draggable={false} />
            ) : (
              <div className="settings-about-portrait settings-about-portrait-fallback">{activePetTheme.characterName}</div>
            )}
            <h3 className="settings-about-name">DSH Desk</h3>
            <span className="settings-about-version">{appVersion ? `v${appVersion}` : "—"}</span>
            <p className="settings-about-tagline">{t("settings.about.description", "面向 DeepSeek Harness 的本地桌宠和工作台。")}</p>
            <div className="settings-about-actions">
              <button className="inline-action" onClick={() => window.companion.openExternal("https://github.com/Renakoni/dsh-desk")}>GitHub</button>
              <button className="inline-action" onClick={handleCheckUpdate} disabled={checkingUpdate || updateStatus.checking || updateStatus.downloading}>
                {checkingUpdate || updateStatus.checking ? t("update.checkShort", "检查中...") : t("update.check", "检查更新")}
              </button>
            </div>
            <div className="settings-info-list settings-about-facts">
              <SettingsInfoRow label={t("update.status", "更新状态")} value={aboutUpdateValue} title={aboutUpdateTitle} tone={updateStatus.error ? "danger" : undefined} />
            </div>
            <p className="settings-about-credit">{t("settings.about.character", "桌宠角色")} · {activePetTheme.displayName}</p>
          </div>
        )}
      </div>
    </section>
  );
}
