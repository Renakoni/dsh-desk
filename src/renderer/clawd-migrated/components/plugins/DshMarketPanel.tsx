import React, { useDeferredValue, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, Code2, ExternalLink, LoaderCircle, Package, Plus, RefreshCw, Search, Settings2, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { DshMarketplaceSnapshot, DshPluginSnapshot, DshSkillMarketplaceSnapshot } from "../../../../shared/dshPlugins";
import { type I18nTranslate, useI18n } from "../../useI18n";

type MarketTab = "plugins" | "skills";
type MarketSortKey = "name" | "stars";
type MarketSort = { key: MarketSortKey; direction: "asc" | "desc" };

function compareNullableStars(left: number | null, right: number | null, direction: MarketSort["direction"]): number {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  return direction === "asc" ? left - right : right - left;
}

function sortRows<T extends { name: string; stars: number | null }>(rows: T[], sort: MarketSort): T[] {
  return [...rows].sort((left, right) => {
    const primary = sort.key === "stars"
      ? compareNullableStars(left.stars, right.stars, sort.direction)
      : (sort.direction === "asc" ? 1 : -1) * left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
    return primary || left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  });
}

function rawErrorMessage(value: unknown): string {
  return value instanceof Error ? value.message : typeof value === "string" ? value : "";
}

function friendlyInstallError(value: unknown, t: I18nTranslate): string {
  const raw = rawErrorMessage(value);
  const normalized = raw.toLocaleLowerCase();
  if (/git_dep_prepare_not_allowed|prepare.*not allowed|needs to execute build scripts/.test(normalized)) {
    return t("dshResources.buildScriptBlocked", "This resource needs a build script, but pnpm blocked it. Allow its build script in the DSH profile, then try again.");
  }
  if (/pnpm.*not found|pnpm-missing/.test(normalized)) {
    return t("dshResources.pnpmMissing", "pnpm is unavailable, so this resource could not be installed.");
  }
  if (/econnreset|econnrefused|enotfound|etimedout|eai_again|network|fetch|download|timeout/.test(normalized)) {
    return t("dshResources.downloadFailed", "The resource could not be downloaded. Check your network connection and try again.");
  }
  if (/profile|dsh/.test(normalized)) {
    return t("dshResources.profileInstallFailed", "DSH could not install this resource in the selected profiles.");
  }
  return t("dshResources.installationFailed", "Installation failed. Try again later.");
}

function showInstallError(message: string) {
  toast.error(message, {
    id: "dsh-market-install-error",
    duration: 5000,
    closeButton: true,
    className: "dsh-market-toast"
  });
}

export function DshMarketPanel({ onBack, onChanged }: { onBack: () => void; onChanged: () => void }) {
  const { locale, t } = useI18n();
  const [tab, setTab] = useState<MarketTab>("plugins");
  const [plugins, setPlugins] = useState<DshMarketplaceSnapshot | null>(null);
  const [installed, setInstalled] = useState<DshPluginSnapshot | null>(null);
  const [skills, setSkills] = useState<DshSkillMarketplaceSnapshot | null>(null);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const [loading, setLoading] = useState<Record<MarketTab, boolean>>({ plugins: false, skills: false });
  const [busy, setBusy] = useState("");
  const [errors, setErrors] = useState<Record<MarketTab, string>>({ plugins: "", skills: "" });
  const [repoManager, setRepoManager] = useState(false);
  const [repoUrl, setRepoUrl] = useState("");
  const [repoBranch, setRepoBranch] = useState("");
  const [sort, setSort] = useState<MarketSort>({ key: "name", direction: "asc" });

  const error = errors[tab];
  const isLoading = loading[tab];

  function setMarketError(market: MarketTab, message: string) {
    setErrors(current => ({ ...current, [market]: message }));
  }

  function setSnapshotErrors(market: MarketTab, messages: string[], empty: boolean) {
    if (messages.length === 0) { setMarketError(market, ""); return; }
    const prefix = empty
      ? t("dshResources.marketLoadFailed", "The marketplace is currently unavailable.")
      : t("dshResources.marketPartialFailure", "Some sources could not be loaded:");
    setMarketError(market, `${prefix} ${messages.join("; ")}`);
  }

  async function loadPlugins(force = false) {
    setLoading(current => ({ ...current, plugins: true }));
    setMarketError("plugins", "");
    try {
      const [catalog, inventory] = await Promise.all([
        window.companion.getDshPluginMarketplace(force),
        window.companion.listDshPlugins()
      ]);
      setPlugins(catalog);
      setInstalled(inventory);
      setSnapshotErrors("plugins", catalog.error ? [catalog.error] : [], catalog.plugins.length === 0);
    } catch (reason) {
      setMarketError("plugins", reason instanceof Error ? reason.message : String(reason));
    } finally { setLoading(current => ({ ...current, plugins: false })); }
  }

  async function loadSkills(force = false) {
    setLoading(current => ({ ...current, skills: true }));
    setMarketError("skills", "");
    try {
      const snapshot = await window.companion.getDshSkillMarketplace(force);
      setSkills(snapshot);
      setSnapshotErrors("skills", snapshot.errors, snapshot.skills.length === 0);
    } catch (reason) {
      setMarketError("skills", reason instanceof Error ? reason.message : String(reason));
    } finally { setLoading(current => ({ ...current, skills: false })); }
  }

  useEffect(() => { void loadPlugins(); }, []);
  useEffect(() => {
    setQuery("");
    setSort({ key: "name", direction: "asc" });
    if (tab === "skills" && !skills) void loadSkills();
  }, [tab, skills]);

  const pluginRows = useMemo(() => sortRows((plugins?.plugins ?? []).filter(plugin => !deferredQuery || [plugin.name, plugin.owner, plugin.description.zh, plugin.description.en].join(" ").toLocaleLowerCase().includes(deferredQuery)), sort), [deferredQuery, plugins, sort]);
  const skillRows = useMemo(() => sortRows((skills?.skills ?? []).filter(skill => !deferredQuery || [skill.name, skill.description, skill.repoOwner, skill.repoName].join(" ").toLocaleLowerCase().includes(deferredQuery)), sort), [deferredQuery, skills, sort]);
  const targetProfiles = (installed?.profiles ?? [])
    .filter(profile => profile.exists && !profile.readError)
    .map(profile => profile.name);
  const installedByPackage = new Map((installed?.plugins ?? []).map(plugin => [plugin.packageName, plugin]));

  function isPluginInstalled(packageName: string): boolean {
    if (targetProfiles.length === 0) return false;
    const plugin = installedByPackage.get(packageName);
    if (!plugin) return false;
    return targetProfiles.every(profile => plugin.states.some(state => state.profile === profile && state.materialized));
  }

  function changeSort(key: MarketSortKey) {
    setSort(current => current.key === key
      ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
      : { key, direction: key === "stars" ? "desc" : "asc" });
  }

  async function installPlugin(index: number) {
    const plugin = pluginRows[index];
    if (!plugin || !installed) return;
    setMarketError("plugins", "");
    setBusy(plugin.id);
    try {
      const result = await window.companion.installDshMarketplacePlugin({
        installSpec: plugin.installSpec,
        profiles: installed.profiles.filter(profile => profile.exists && !profile.readError).map(profile => profile.name)
      });
      setInstalled(result.snapshot);
      if (!result.ok) {
        const failure = friendlyInstallError(result.error, t);
        if (result.changedProfiles.length > 0) {
          onChanged();
          const partial = t("dshResources.partialInstallationFailed", "Installed in {profiles}, but installation failed for the remaining profiles.", { profiles: result.changedProfiles.join(", ") });
          const restart = result.restartRequired ? ` ${t("dshResources.restartCompletedProfiles", "Restart DSH to use the completed changes.")}` : "";
          showInstallError(`${partial}${restart} ${failure}`);
        } else {
          showInstallError(failure);
        }
        return;
      }
      onChanged();
    } catch (reason) {
      showInstallError(friendlyInstallError(reason, t));
    } finally {
      setBusy("");
    }
  }

  async function installSkill(index: number) {
    const skill = skillRows[index];
    if (!skill) return;
    setMarketError("skills", "");
    setBusy(skill.key);
    try {
      const result = await window.companion.installDshSkill(skill);
      if (!result.ok) { showInstallError(friendlyInstallError(result.error, t)); return; }
      setSkills(current => current ? { ...current, skills: current.skills.map(item => item.key === skill.key ? { ...item, installed: true } : item) } : current);
      onChanged();
    } catch (reason) {
      showInstallError(friendlyInstallError(reason, t));
    } finally {
      setBusy("");
    }
  }

  async function addRepo() {
    const value = repoUrl.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "");
    const [owner, name, ...rest] = value.split("/");
    if (!owner || !name || rest.length > 0) { setMarketError("skills", t("dshResources.invalidRepository", "Enter a GitHub repository in owner/repository format.")); return; }
    setBusy("repo:add");
    const result = await window.companion.addDshSkillRepo({ owner, name, branch: repoBranch.trim() || "main", enabled: true });
    setBusy("");
    if (!result.ok || !result.snapshot) { setMarketError("skills", result.error ?? t("dshResources.repositoryAddFailed", "Couldn't add the repository.")); return; }
    setSkills(result.snapshot);
    setSnapshotErrors("skills", result.snapshot.errors, result.snapshot.skills.length === 0);
    setRepoUrl("");
    setRepoBranch("");
  }

  async function removeRepo(owner: string, name: string) {
    setBusy(`repo:${owner}/${name}`);
    const result = await window.companion.removeDshSkillRepo(owner, name);
    setBusy("");
    if (!result.ok || !result.snapshot) { setMarketError("skills", result.error ?? t("dshResources.repositoryRemoveFailed", "Couldn't remove the repository.")); return; }
    setSkills(result.snapshot);
    setSnapshotErrors("skills", result.snapshot.errors, result.snapshot.skills.length === 0);
  }

  return (
    <div className="dsh-market-panel">
      <header className="dsh-market-header">
        <button type="button" className="claude-profile-icon-button" onClick={onBack} aria-label={t("common.back", "Back")}><ArrowLeft size={17} /></button>
        <nav className="dsh-market-tabs">
          <button type="button" className={tab === "plugins" ? "active" : ""} onClick={() => setTab("plugins")}><Package size={15} />{t("dshResources.pluginMarketplace", "Plugin marketplace")}</button>
          <button type="button" className={tab === "skills" ? "active" : ""} onClick={() => setTab("skills")}><Code2 size={15} />{t("dshResources.skillMarketplace", "Skill marketplace")}</button>
        </nav>
        {tab === "skills" ? <button type="button" className={`claude-profile-icon-button ${repoManager ? "active" : ""}`} onClick={() => setRepoManager(value => !value)} title={t("dshResources.repositories", "Skill repositories")}><Settings2 size={16} /></button> : <span />}
      </header>

      {repoManager && tab === "skills" ? (
        <section className="dsh-repo-manager">
          <div className="dsh-repo-add"><input value={repoUrl} onChange={event => setRepoUrl(event.target.value)} placeholder="owner/repository" /><input value={repoBranch} onChange={event => setRepoBranch(event.target.value)} placeholder={t("dshResources.branchPlaceholder", "Branch (default: main)")} /><button type="button" className="claude-profile-icon-button" onClick={() => void addRepo()} disabled={busy !== ""} aria-label={t("dshResources.addRepository", "Add repository")}><Plus size={16} /></button></div>
          <div className="dsh-repo-list">{(skills?.repos ?? []).map(repo => <span key={`${repo.owner}/${repo.name}`}><b>{repo.owner}/{repo.name}</b><small>{repo.branch}</small><button type="button" onClick={() => void removeRepo(repo.owner, repo.name)} disabled={busy !== ""} aria-label={t("dshResources.removeRepository", "Remove {repository}", { repository: `${repo.owner}/${repo.name}` })}><Trash2 size={13} /></button></span>)}</div>
        </section>
      ) : null}

      {error ? <section className="connection-error">{error}</section> : null}
      <section className="claude-resource-list-toolbar dsh-plugin-toolbar">
        <div className="claude-resource-search dark dsh-plugin-search"><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={t(tab === "plugins" ? "dshResources.searchPlugins" : "dshResources.searchSkills", tab === "plugins" ? "Search plugins" : "Search skills")} /></div>
        <button type="button" className="claude-resource-search-refresh dsh-plugin-icon-button" onClick={() => void (tab === "plugins" ? loadPlugins(true) : loadSkills(true))} disabled={isLoading || busy !== ""} aria-label={t("dshResources.refresh", "Refresh")}><RefreshCw size={17} className={isLoading ? "spinning" : undefined} /></button>
      </section>

      <section className="dsh-market-list">
        <header className="dsh-market-list-head">
          <span className="dsh-market-list-mark" aria-hidden="true" />
          <button type="button" onClick={() => changeSort("name")} aria-label={t("dshResources.sortByName", "Sort by name")}><span>{t("dshResources.nameHeader", "Name")}</span>{sort.key === "name" ? (sort.direction === "asc" ? <ArrowUp size={13} /> : <ArrowDown size={13} />) : null}</button>
          <button type="button" onClick={() => changeSort("stars")} aria-label={t("dshResources.sortByStars", "Sort by Stars")}><Star size={12} /><span>{t("dshResources.starsHeader", "Stars")}</span>{sort.key === "stars" ? (sort.direction === "asc" ? <ArrowUp size={13} /> : <ArrowDown size={13} />) : null}</button>
          <span>{t("dshResources.action", "Action")}</span>
        </header>
        {isLoading && (tab === "plugins" ? !plugins : !skills) ? <div className="claude-resource-empty">{t("dshResources.loading", "Loading...")}</div> : null}
        {tab === "plugins" ? pluginRows.map((plugin, index) => {
          const isInstalled = isPluginInstalled(plugin.packageName);
          const installing = busy === plugin.id;
          const description = locale === "zh" ? plugin.description.zh : plugin.description.en;
          return <article key={plugin.id} className="dsh-market-row"><div className="dsh-resource-mark"><Package size={17} aria-hidden="true" /></div><div className="dsh-market-copy"><strong>{plugin.name}</strong><p title={description}>{description}</p></div><span className="dsh-market-stars">{plugin.stars !== null ? <><Star size={12} fill="currentColor" />{plugin.stars.toLocaleString()}</> : "-"}</span><div className="dsh-market-row-actions"><button type="button" onClick={() => void window.companion.openExternal(plugin.repositoryUrl)} aria-label={t("dshResources.openRepository", "Open repository")}><ExternalLink size={14} /></button><button type="button" className="claude-profile-primary-button dsh-market-install-button" onClick={() => void installPlugin(index)} disabled={isInstalled || busy !== ""} aria-busy={installing}>{installing ? <><LoaderCircle size={13} className="spinning" />{t("dshResources.installing", "Installing…")}</> : t(isInstalled ? "dshResources.installed" : "dshResources.install", isInstalled ? "Installed" : "Install")}</button></div></article>;
        }) : skillRows.map((skill, index) => { const installing = busy === skill.key; return <article key={skill.key} className="dsh-market-row"><div className="dsh-resource-mark"><Code2 size={17} aria-hidden="true" /></div><div className="dsh-market-copy"><strong>{skill.name}</strong><p title={skill.description}>{skill.description}</p></div><span className="dsh-market-stars" title={`${skill.repoOwner}/${skill.repoName}`}>{skill.stars !== null ? <><Star size={12} fill="currentColor" />{skill.stars.toLocaleString()}</> : "-"}</span><div className="dsh-market-row-actions"><button type="button" onClick={() => void window.companion.openExternal(skill.readmeUrl)} aria-label={t("dshResources.openSkillDocument", "Open Skill document")}><ExternalLink size={14} /></button><button type="button" className="claude-profile-primary-button dsh-market-install-button" onClick={() => void installSkill(index)} disabled={skill.installed || busy !== ""} aria-busy={installing}>{installing ? <><LoaderCircle size={13} className="spinning" />{t("dshResources.installing", "Installing…")}</> : t(skill.installed ? "dshResources.installed" : "dshResources.install", skill.installed ? "Installed" : "Install")}</button></div></article>; })}
        {!isLoading && !error && (tab === "plugins" ? Boolean(plugins) && pluginRows.length === 0 : Boolean(skills) && skillRows.length === 0) ? <div className="claude-resource-empty">{t("dshResources.noMatches", "No matches")}</div> : null}
      </section>
    </div>
  );
}
