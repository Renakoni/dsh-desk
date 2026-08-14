import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Blocks,
  Check,
  Code2,
  Download,
  ExternalLink,
  FolderOpen,
  LockKeyhole,
  Package,
  RefreshCw,
  Search,
  ShieldCheck,
  Star,
  Store,
  Trash2,
  X
} from "lucide-react";
import type {
  DshInstalledPlugin,
  DshMarketplacePlugin,
  DshMarketplaceSnapshot,
  DshPluginMutationResult,
  DshPluginSnapshot,
  DshSkillItem,
  DshSkillSnapshot
} from "../../../../shared/dshPlugins";
import { useI18n } from "../../useI18n";
import { ConfirmDialog } from "../dsh-routing/ConfirmDialog";

type ResourceView = "installed" | "marketplace" | "skills";
type MarketSort = "popular" | "new" | "name";

function PluginsPageInner({ hideSensitiveContent, active = true }: { hideSensitiveContent: boolean; active?: boolean }) {
  const { locale } = useI18n();
  const zh = locale === "zh";
  const [view, setView] = useState<ResourceView>("installed");
  const [snapshot, setSnapshot] = useState<DshPluginSnapshot | null>(null);
  const [marketplace, setMarketplace] = useState<DshMarketplaceSnapshot | null>(null);
  const [skills, setSkills] = useState<DshSkillSnapshot | null>(null);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState<MarketSort>("popular");
  const [targetProfiles, setTargetProfiles] = useState<string[]>(["web"]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [restartProfiles, setRestartProfiles] = useState<string[]>([]);
  const [removeTarget, setRemoveTarget] = useState<DshInstalledPlugin | null>(null);
  const requestId = useRef(0);

  const refreshInventory = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      const [nextSnapshot, nextSkills] = await Promise.all([
        window.companion.listDshPlugins(),
        window.companion.listDshSkills()
      ]);
      if (requestId.current !== currentRequest) return;
      setSnapshot(nextSnapshot);
      setSkills(nextSkills);
      const unreadable = nextSnapshot.profiles.filter(profile => profile.readError).map(profile => profile.label);
      if (unreadable.length > 0) {
        setError(zh ? `无法读取 Profile：${unreadable.join(" / ")}` : `Could not read profiles: ${unreadable.join(" / ")}`);
      }
      setTargetProfiles(current => {
        const available = new Set(nextSnapshot.profiles.map(profile => profile.name));
        const kept = current.filter(profile => available.has(profile));
        return kept.length > 0 ? kept : nextSnapshot.profiles[0] ? [nextSnapshot.profiles[0].name] : [];
      });
    } catch (reason) {
      if (requestId.current === currentRequest) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (requestId.current === currentRequest) setLoading(false);
    }
  }, [zh]);

  const refreshMarketplace = useCallback(async (force = false) => {
    setLoading(true);
    setError("");
    try {
      const next = await window.companion.getDshPluginMarketplace(force);
      setMarketplace(next);
      if (next.source === "unavailable" && next.error) setError(next.error);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void refreshInventory();
  }, [active, refreshInventory]);

  useEffect(() => {
    if (!active || view !== "marketplace" || marketplace) return;
    void refreshMarketplace();
  }, [active, marketplace, refreshMarketplace, view]);

  const installed = useMemo(() => {
    const plugins = snapshot?.plugins ?? [];
    if (!deferredQuery) return plugins;
    return plugins.filter(plugin => [plugin.name, plugin.packageName, plugin.description ?? "", plugin.version ?? ""]
      .some(value => value.toLocaleLowerCase().includes(deferredQuery)));
  }, [deferredQuery, snapshot]);

  const marketItems = useMemo(() => {
    const items = (marketplace?.plugins ?? []).filter(plugin => {
      if (category !== "all" && plugin.category !== category) return false;
      if (!deferredQuery) return true;
      const description = zh ? plugin.description.zh : plugin.description.en;
      return [plugin.name, plugin.owner, plugin.packageName, description].some(value => value.toLocaleLowerCase().includes(deferredQuery));
    });
    return [...items].sort((left, right) => {
      if (sort === "name") return left.name.localeCompare(right.name);
      if (sort === "new") return right.added.localeCompare(left.added) || (right.stars ?? -1) - (left.stars ?? -1);
      return (right.stars ?? -1) - (left.stars ?? -1) || left.name.localeCompare(right.name);
    });
  }, [category, deferredQuery, marketplace, sort, zh]);

  const skillItems = useMemo(() => {
    const items = skills?.skills ?? [];
    if (!deferredQuery) return items;
    return items.filter(skill => [skill.name, skill.description, skill.source].some(value => value.toLocaleLowerCase().includes(deferredQuery)));
  }, [deferredQuery, skills]);

  function acceptMutation(result: DshPluginMutationResult) {
    setSnapshot(result.snapshot);
    if (result.restartRequired) {
      setRestartProfiles(current => [...new Set([...current, ...result.changedProfiles])]);
    }
    if (!result.ok) {
      setError(result.error ?? (zh ? "插件操作失败。" : "The plugin operation failed."));
      return false;
    }
    return true;
  }

  async function setPluginEnabled(plugin: DshInstalledPlugin, profile: string, enabled: boolean) {
    const key = `state:${plugin.packageName}:${profile}`;
    setBusy(key);
    setError("");
    try {
      acceptMutation(await window.companion.setDshPluginEnabled({ packageName: plugin.packageName, profile, enabled }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  }

  async function installPlugin(plugin: DshMarketplacePlugin) {
    const key = `install:${plugin.id}`;
    setBusy(key);
    setError("");
    try {
      acceptMutation(await window.companion.installDshMarketplacePlugin({ installSpec: plugin.installSpec, profiles: targetProfiles }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  }

  async function removePlugin(plugin: DshInstalledPlugin) {
    const profiles = plugin.states.filter(state => state.dependencySpec || state.enabled).map(state => state.profile);
    const key = `remove:${plugin.packageName}`;
    setBusy(key);
    setError("");
    setRemoveTarget(null);
    try {
      acceptMutation(await window.companion.removeDshPluginPackage({ packageName: plugin.packageName, profiles }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  }

  function toggleTarget(profile: string) {
    setTargetProfiles(current => current.includes(profile) ? current.filter(item => item !== profile) : [...current, profile]);
  }

  const tabs = [
    { id: "installed" as const, label: zh ? "已安装" : "Installed", icon: Package, count: snapshot?.plugins.length ?? 0 },
    { id: "marketplace" as const, label: zh ? "插件市场" : "Marketplace", icon: Store, count: marketplace?.plugins.length },
    { id: "skills" as const, label: "Skills", icon: Code2, count: skills?.skills.filter(skill => skill.active).length ?? 0 }
  ];
  const title = view === "installed" ? (zh ? "搜索已安装插件" : "Search installed plugins")
    : view === "marketplace" ? (zh ? "搜索插件市场" : "Search marketplace")
      : (zh ? "搜索 Skills" : "Search Skills");

  return (
    <div className="dsh-plugins-page settings-page">
      <header className="dsh-plugins-head">
        <div className="dsh-plugins-heading">
          <Blocks size={19} aria-hidden="true" />
          <div>
            <span>{zh ? "DSH 资源" : "DSH Resources"}</span>
            <h2>{zh ? "插件" : "Plugins"}</h2>
          </div>
        </div>
        <nav className="dsh-resource-tabs" aria-label={zh ? "资源视图" : "Resource view"}>
          {tabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button key={tab.id} type="button" className={view === tab.id ? "active" : ""} onClick={() => {
                setView(tab.id);
                setQuery("");
              }} aria-pressed={view === tab.id}>
                <Icon size={15} aria-hidden="true" />
                <span>{tab.label}</span>
                {tab.count !== undefined ? <small>{tab.count}</small> : null}
              </button>
            );
          })}
        </nav>
      </header>

      {restartProfiles.length > 0 ? (
        <div className="dsh-plugin-notice restart" role="status">
          <RefreshCw size={15} aria-hidden="true" />
          <span>{zh ? `重启 ${restartProfiles.join(" / ")} profile 后生效` : `Restart ${restartProfiles.join(" / ")} to apply changes`}</span>
          <button type="button" onClick={() => setRestartProfiles([])} aria-label={zh ? "关闭提示" : "Dismiss"}><X size={14} /></button>
        </div>
      ) : null}
      {error ? (
        <div className="dsh-plugin-notice error" role="alert">
          <AlertTriangle size={15} aria-hidden="true" />
          <span>{error}</span>
          <button type="button" onClick={() => setError("")} aria-label={zh ? "关闭错误" : "Dismiss error"}><X size={14} /></button>
        </div>
      ) : null}

      <section className="dsh-plugin-toolbar">
        <label className="dsh-plugin-search">
          <Search size={15} aria-hidden="true" />
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder={title} aria-label={title} />
        </label>
        {view === "marketplace" ? (
          <>
            <select value={category} onChange={event => setCategory(event.target.value)} aria-label={zh ? "插件分类" : "Plugin category"}>
              <option value="all">{zh ? "全部分类" : "All categories"}</option>
              {(marketplace?.categories ?? []).map(item => <option key={item.id} value={item.id}>{zh ? item.zh : item.en}</option>)}
            </select>
            <select value={sort} onChange={event => setSort(event.target.value as MarketSort)} aria-label={zh ? "排序方式" : "Sort order"}>
              <option value="popular">{zh ? "最受欢迎" : "Most popular"}</option>
              <option value="new">{zh ? "最近收录" : "Recently added"}</option>
              <option value="name">{zh ? "名称" : "Name"}</option>
            </select>
          </>
        ) : null}
        <button type="button" className="dsh-plugin-icon-button" onClick={() => view === "marketplace" ? void refreshMarketplace(true) : void refreshInventory()} disabled={loading || busy !== null} title={zh ? "刷新" : "Refresh"} aria-label={zh ? "刷新" : "Refresh"}>
          <RefreshCw size={16} className={loading ? "spinning" : undefined} />
        </button>
      </section>

      {view === "marketplace" ? (
        <section className="dsh-market-targets" aria-label={zh ? "安装目标" : "Install targets"}>
          <span>{zh ? "安装到" : "Install to"}</span>
          {(snapshot?.profiles ?? []).map(profile => (
            <label key={profile.name}>
              <input type="checkbox" checked={targetProfiles.includes(profile.name)} onChange={() => toggleTarget(profile.name)} />
              <span>{profile.label}</span>
            </label>
          ))}
          {snapshot && !snapshot.npxAvailable ? <span className="dsh-market-warning">{zh ? "未找到 npx" : "npx unavailable"}</span> : null}
          <MarketplaceSource marketplace={marketplace} zh={zh} />
        </section>
      ) : null}

      <section className="dsh-resource-list" aria-busy={loading}>
        {loading && ((view === "installed" && !snapshot) || (view === "marketplace" && !marketplace) || (view === "skills" && !skills)) ? (
          <div className="dsh-resource-empty">{zh ? "正在读取..." : "Loading..."}</div>
        ) : view === "installed" ? (
          installed.length > 0
            ? installed.map(plugin => <InstalledRow key={plugin.packageName} plugin={plugin} profiles={snapshot?.profiles ?? []} busy={busy} zh={zh} onToggle={setPluginEnabled} onRemove={setRemoveTarget} />)
            : <div className="dsh-resource-empty">{deferredQuery ? (zh ? "没有匹配插件" : "No matching plugins") : (zh ? "尚未发现插件" : "No plugins found")}</div>
        ) : view === "marketplace" ? (
          marketItems.length > 0
            ? marketItems.map(plugin => <MarketplaceRow key={plugin.id} plugin={plugin} installed={snapshot?.plugins.find(item => item.packageName === plugin.packageName)} category={marketplace?.categories.find(item => item.id === plugin.category)} targets={targetProfiles} canInstall={snapshot?.npxAvailable === true} operationBusy={busy !== null} installing={busy === `install:${plugin.id}`} zh={zh} onInstall={installPlugin} />)
            : <div className="dsh-resource-empty">{deferredQuery || category !== "all" ? (zh ? "没有匹配插件" : "No matching plugins") : (zh ? "插件市场暂不可用" : "Marketplace unavailable")}</div>
        ) : (
          skillItems.length > 0
            ? skillItems.map(skill => <SkillRow key={skill.id} skill={skill} hidePath={hideSensitiveContent} zh={zh} />)
            : <div className="dsh-resource-empty">{deferredQuery ? (zh ? "没有匹配 Skill" : "No matching Skills") : (zh ? "未发现本地 Skill" : "No local Skills found")}</div>
        )}
      </section>

      {view === "installed" && snapshot ? <footer className="dsh-resource-foot">{hideSensitiveContent ? "$DSH_HOME" : snapshot.dshHome} · {new Date(snapshot.scannedAt).toLocaleTimeString()}</footer> : null}
      {view === "skills" && skills ? <footer className="dsh-resource-foot">{hideSensitiveContent ? "$DSH_HOME/skills · $DSH_AGENTS_HOME/skills" : skills.roots.map(root => root.path).join(" · ")}</footer> : null}

      {removeTarget ? (
        <ConfirmDialog
          title={zh ? "卸载插件？" : "Uninstall plugin?"}
          cancelLabel={zh ? "取消" : "Cancel"}
          confirmLabel={zh ? "卸载" : "Uninstall"}
          danger
          onCancel={() => setRemoveTarget(null)}
          onConfirm={() => void removePlugin(removeTarget)}
        >
          <p>{zh ? `将从已安装的 DSH profiles 中移除 ${removeTarget.packageName}。` : `${removeTarget.packageName} will be removed from its DSH profiles.`}</p>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

function InstalledRow({ plugin, profiles, busy, zh, onToggle, onRemove }: {
  plugin: DshInstalledPlugin;
  profiles: DshPluginSnapshot["profiles"];
  busy: string | null;
  zh: boolean;
  onToggle: (plugin: DshInstalledPlugin, profile: string, enabled: boolean) => void;
  onRemove: (plugin: DshInstalledPlugin) => void;
}) {
  const removable = !plugin.protected && plugin.states.some(state => state.dependencySpec);
  const kindLabel = plugin.kind === "builtin" ? (zh ? "DSH 内置" : "Built in")
    : plugin.kind === "desk" ? (zh ? "Desk 必需" : "Desk required")
      : plugin.kind === "dependency" ? (zh ? "普通依赖" : "Dependency")
        : plugin.kind === "broken" ? (zh ? "未解析" : "Unresolved")
          : (zh ? "第三方" : "Third-party");
  return (
    <article className={`dsh-resource-row installed ${plugin.kind}`}>
      <div className="dsh-resource-mark"><Package size={17} aria-hidden="true" /></div>
      <div className="dsh-resource-copy">
        <div className="dsh-resource-title">
          <strong>{plugin.name}</strong>
          {plugin.version ? <small>v{plugin.version}</small> : null}
          <span className={`dsh-kind-label ${plugin.kind}`}>{plugin.protected ? <LockKeyhole size={11} /> : null}{kindLabel}</span>
        </div>
        <p>{plugin.description ?? plugin.packageName}</p>
        {plugin.name !== plugin.packageName ? <code>{plugin.packageName}</code> : null}
      </div>
      <div className="dsh-profile-states" aria-label={zh ? "Profile 状态" : "Profile states"}>
        {profiles.map(profile => {
          const state = plugin.states.find(item => item.profile === profile.name);
          const operable = !plugin.protected && (state?.enabled === true || (!!state?.dependencySpec && state.bundleCapable === true));
          const stateBusy = busy === `state:${plugin.packageName}:${profile.name}`;
          return (
            <button
              key={profile.name}
              type="button"
              className={state?.enabled ? "active" : state?.dependencySpec ? "inactive" : "missing"}
              aria-pressed={state?.enabled === true}
              aria-label={`${state?.enabled ? (zh ? "禁用" : "Disable") : (zh ? "启用" : "Enable")} ${plugin.name} ${profile.label}`}
              title={plugin.protected ? (zh ? "核心插件不可停用" : "Core plugin cannot be disabled") : state?.enabled && !state.dependencySpec ? (zh ? "依赖缺失，可停用此配置层" : "Dependency missing; this configured layer can be disabled") : !state?.dependencySpec ? (zh ? "此 Profile 未安装" : "Not installed in this profile") : state?.bundleCapable !== true ? (zh ? "此依赖不提供 DSH bundle" : "This dependency does not expose a DSH bundle") : profile.label}
              disabled={!operable || busy !== null || stateBusy}
              onClick={() => onToggle(plugin, profile.name, !state?.enabled)}
            >
              <span className="dsh-profile-state-icon">{state?.enabled ? <Check size={12} aria-hidden="true" /> : null}</span>
              <span>{profile.label}</span>
            </button>
          );
        })}
      </div>
      <div className="dsh-row-actions">
        {plugin.homepage ? <button type="button" onClick={() => window.companion.openExternal(plugin.homepage!)} title={zh ? "项目主页" : "Project page"} aria-label={zh ? `打开 ${plugin.name} 项目主页` : `Open ${plugin.name} project page`}><ExternalLink size={15} /></button> : null}
        {plugin.protected ? <span className="dsh-protected-action" title={zh ? "受保护" : "Protected"}><ShieldCheck size={16} /></span> : null}
        {removable ? <button type="button" className="danger" disabled={busy !== null} onClick={() => onRemove(plugin)} title={zh ? "卸载" : "Uninstall"} aria-label={zh ? `卸载 ${plugin.name}` : `Uninstall ${plugin.name}`}><Trash2 size={15} /></button> : null}
      </div>
    </article>
  );
}

function MarketplaceRow({ plugin, installed, category, targets, canInstall, operationBusy, installing, zh, onInstall }: {
  plugin: DshMarketplacePlugin;
  installed?: DshInstalledPlugin;
  category?: { en: string; zh: string };
  targets: string[];
  canInstall: boolean;
  operationBusy: boolean;
  installing: boolean;
  zh: boolean;
  onInstall: (plugin: DshMarketplacePlugin) => void;
}) {
  const installedTargets = new Set(installed?.states.filter(state => state.dependencySpec).map(state => state.profile) ?? []);
  const complete = targets.length > 0 && targets.every(profile => installedTargets.has(profile));
  return (
    <article className="dsh-resource-row marketplace">
      <div className="dsh-resource-mark"><Blocks size={17} aria-hidden="true" /></div>
      <div className="dsh-resource-copy">
        <div className="dsh-resource-title">
          <strong>{plugin.name}</strong>
          <small>@{plugin.owner}</small>
          {category ? <span className="dsh-kind-label market">{zh ? category.zh : category.en}</span> : null}
        </div>
        <p>{zh ? plugin.description.zh : plugin.description.en}</p>
      </div>
      <div className="dsh-market-meta">
        {plugin.stars !== null ? <span><Star size={13} fill="currentColor" />{plugin.stars.toLocaleString()}</span> : null}
        {plugin.added ? <time dateTime={plugin.added}>{plugin.added}</time> : null}
      </div>
      <div className="dsh-row-actions market">
        <button type="button" onClick={() => window.companion.openExternal(plugin.repositoryUrl)} title={zh ? "查看源码" : "View source"} aria-label={zh ? `打开 ${plugin.name} 源码` : `Open ${plugin.name} source`}><ExternalLink size={15} /></button>
        <button type="button" className="install" disabled={!canInstall || operationBusy || targets.length === 0 || complete} onClick={() => onInstall(plugin)} title={!canInstall ? (zh ? "未找到 npx" : "npx unavailable") : undefined}>
          {complete ? <Check size={14} /> : <Download size={14} />}
          <span>{installing ? (zh ? "安装中" : "Installing") : complete ? (zh ? "已安装" : "Installed") : (zh ? "安装" : "Install")}</span>
        </button>
      </div>
    </article>
  );
}

function SkillRow({ skill, hidePath, zh }: { skill: DshSkillItem; hidePath: boolean; zh: boolean }) {
  return (
    <article className={`dsh-resource-row skill ${skill.active ? "" : "shadowed"}`}>
      <div className="dsh-resource-mark"><Code2 size={17} aria-hidden="true" /></div>
      <div className="dsh-resource-copy">
        <div className="dsh-resource-title">
          <strong>/{skill.name}</strong>
          <span className="dsh-kind-label skill-source">{skill.source === "user-dsh" ? "DSH" : "Agents"}</span>
          {!skill.active ? <span className="dsh-kind-label shadowed">{zh ? "已被覆盖" : "Shadowed"}</span> : null}
        </div>
        <p>{skill.description}</p>
        {!hidePath ? <code>{skill.path}</code> : null}
      </div>
      <div className="dsh-skill-policy">
        <span className={skill.modelInvocable ? "active" : "disabled"} title={zh ? "允许模型调用" : "Model invocation"}>{skill.modelInvocable ? <Check size={10} /> : <X size={10} />}{zh ? "模型" : "Model"}</span>
        <span className={skill.userInvocable ? "active" : "disabled"} title={zh ? "允许用户调用" : "User invocation"}>{skill.userInvocable ? <Check size={10} /> : <X size={10} />}{zh ? "用户" : "User"}</span>
      </div>
      <div className="dsh-row-actions">
        <button type="button" onClick={() => void window.companion.revealDshSkill(skill.directory)} title={zh ? "在资源管理器中显示" : "Show in file manager"} aria-label={zh ? `打开 ${skill.name} 所在目录` : `Open ${skill.name} directory`}><FolderOpen size={15} /></button>
      </div>
    </article>
  );
}

function MarketplaceSource({ marketplace, zh }: { marketplace: DshMarketplaceSnapshot | null; zh: boolean }) {
  if (!marketplace) return <span className="dsh-market-source">awesome-dsh-plugin</span>;
  return (
    <button type="button" className="dsh-market-source" onClick={() => window.companion.openExternal("https://awesome-dsh-plugin.com")} title={zh ? "打开插件目录" : "Open plugin directory"}>
      <span>{marketplace.sourceName}</span>
      {marketplace.updatedAt ? <time dateTime={marketplace.updatedAt}>{marketplace.updatedAt}</time> : null}
      {marketplace.source === "cache" ? <small>{zh ? "缓存" : "Cached"}</small> : null}
      <ExternalLink size={12} />
    </button>
  );
}

export const PluginsPage = React.memo(PluginsPageInner);
