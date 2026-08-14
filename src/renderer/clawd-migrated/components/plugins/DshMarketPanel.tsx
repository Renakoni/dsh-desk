import React, { useDeferredValue, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Code2, ExternalLink, Package, Plus, RefreshCw, Search, Settings2, Trash2 } from "lucide-react";
import type { DshMarketplaceSnapshot, DshPluginSnapshot, DshSkillMarketplaceSnapshot } from "../../../../shared/dshPlugins";

type MarketTab = "plugins" | "skills";

export function DshMarketPanel({ zh, onBack, onChanged }: { zh: boolean; onBack: () => void; onChanged: () => void }) {
  const [tab, setTab] = useState<MarketTab>("plugins");
  const [plugins, setPlugins] = useState<DshMarketplaceSnapshot | null>(null);
  const [installed, setInstalled] = useState<DshPluginSnapshot | null>(null);
  const [skills, setSkills] = useState<DshSkillMarketplaceSnapshot | null>(null);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [repoManager, setRepoManager] = useState(false);
  const [repoUrl, setRepoUrl] = useState("");
  const [repoBranch, setRepoBranch] = useState("");

  async function loadPlugins(force = false) {
    setLoading(true);
    setError("");
    try {
      const [catalog, inventory] = await Promise.all([
        window.companion.getDshPluginMarketplace(force),
        window.companion.listDshPlugins()
      ]);
      setPlugins(catalog);
      setInstalled(inventory);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally { setLoading(false); }
  }

  async function loadSkills() {
    setLoading(true);
    setError("");
    try { setSkills(await window.companion.getDshSkillMarketplace()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  }

  useEffect(() => { void loadPlugins(); }, []);
  useEffect(() => {
    setQuery("");
    if (tab === "skills" && !skills) void loadSkills();
  }, [tab, skills]);

  const pluginRows = useMemo(() => (plugins?.plugins ?? []).filter(plugin => !deferredQuery || [plugin.name, plugin.owner, plugin.description.zh, plugin.description.en].join(" ").toLocaleLowerCase().includes(deferredQuery)), [deferredQuery, plugins]);
  const skillRows = useMemo(() => (skills?.skills ?? []).filter(skill => !deferredQuery || [skill.name, skill.description, skill.repoOwner, skill.repoName].join(" ").toLocaleLowerCase().includes(deferredQuery)), [deferredQuery, skills]);
  const installedPackages = new Set((installed?.plugins ?? []).map(plugin => plugin.packageName));

  async function installPlugin(index: number) {
    const plugin = pluginRows[index];
    if (!plugin || !installed) return;
    setBusy(plugin.id);
    const result = await window.companion.installDshMarketplacePlugin({
      installSpec: plugin.installSpec,
      profiles: installed.profiles.filter(profile => profile.exists && !profile.readError).map(profile => profile.name)
    });
    setBusy("");
    if (!result.ok) { setError(result.error ?? (zh ? "安装失败" : "Installation failed")); return; }
    setInstalled(result.snapshot);
    onChanged();
  }

  async function installSkill(index: number) {
    const skill = skillRows[index];
    if (!skill) return;
    setBusy(skill.key);
    const result = await window.companion.installDshSkill(skill);
    setBusy("");
    if (!result.ok) { setError(result.error ?? (zh ? "安装失败" : "Installation failed")); return; }
    setSkills(current => current ? { ...current, skills: current.skills.map(item => item.key === skill.key ? { ...item, installed: true } : item) } : current);
    onChanged();
  }

  async function addRepo() {
    const value = repoUrl.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "");
    const [owner, name, ...rest] = value.split("/");
    if (!owner || !name || rest.length > 0) { setError(zh ? "请输入有效的 GitHub 仓库" : "Enter a valid GitHub repository"); return; }
    setBusy("repo:add");
    const result = await window.companion.addDshSkillRepo({ owner, name, branch: repoBranch.trim() || "main", enabled: true });
    setBusy("");
    if (!result.ok || !result.snapshot) { setError(result.error ?? (zh ? "添加失败" : "Could not add repository")); return; }
    setSkills(result.snapshot);
    setRepoUrl("");
    setRepoBranch("");
  }

  async function removeRepo(owner: string, name: string) {
    setBusy(`repo:${owner}/${name}`);
    const result = await window.companion.removeDshSkillRepo(owner, name);
    setBusy("");
    if (!result.ok || !result.snapshot) { setError(result.error ?? (zh ? "删除失败" : "Could not remove repository")); return; }
    setSkills(result.snapshot);
  }

  return (
    <div className="dsh-market-panel">
      <header className="dsh-market-header">
        <button type="button" className="claude-profile-icon-button" onClick={onBack} aria-label={zh ? "返回" : "Back"}><ArrowLeft size={17} /></button>
        <nav className="dsh-market-tabs">
          <button type="button" className={tab === "plugins" ? "active" : ""} onClick={() => setTab("plugins")}><Package size={15} />{zh ? "插件市场" : "Plugin market"}</button>
          <button type="button" className={tab === "skills" ? "active" : ""} onClick={() => setTab("skills")}><Code2 size={15} />{zh ? "Skill 市场" : "Skill market"}</button>
        </nav>
        {tab === "skills" ? <button type="button" className={`claude-profile-icon-button ${repoManager ? "active" : ""}`} onClick={() => setRepoManager(value => !value)} title={zh ? "仓库" : "Repositories"}><Settings2 size={16} /></button> : <span />}
      </header>

      {repoManager && tab === "skills" ? (
        <section className="dsh-repo-manager">
          <div className="dsh-repo-add"><input value={repoUrl} onChange={event => setRepoUrl(event.target.value)} placeholder="owner/repository" /><input value={repoBranch} onChange={event => setRepoBranch(event.target.value)} placeholder={zh ? "分支（默认 main）" : "Branch (main)"} /><button type="button" className="claude-profile-icon-button" onClick={() => void addRepo()} disabled={busy !== ""}><Plus size={16} /></button></div>
          <div className="dsh-repo-list">{(skills?.repos ?? []).map(repo => <span key={`${repo.owner}/${repo.name}`}><b>{repo.owner}/{repo.name}</b><small>{repo.branch}</small><button type="button" onClick={() => void removeRepo(repo.owner, repo.name)} disabled={busy !== ""} aria-label={zh ? `删除 ${repo.owner}/${repo.name}` : `Remove ${repo.owner}/${repo.name}`}><Trash2 size={13} /></button></span>)}</div>
        </section>
      ) : null}

      {error ? <section className="connection-error">{error}</section> : null}
      <section className="claude-resource-list-toolbar">
        <div className="claude-resource-search dark"><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={tab === "plugins" ? (zh ? "搜索插件" : "Search plugins") : (zh ? "搜索 Skills" : "Search Skills")} /></div>
        <button type="button" className="claude-resource-search-refresh" onClick={() => void (tab === "plugins" ? loadPlugins(true) : loadSkills())} disabled={loading || busy !== ""} aria-label={zh ? "刷新" : "Refresh"}><RefreshCw size={17} className={loading ? "spinning" : undefined} /></button>
      </section>

      <section className="dsh-market-list">
        {loading && (tab === "plugins" ? !plugins : !skills) ? <div className="claude-resource-empty">{zh ? "正在加载..." : "Loading..."}</div> : null}
        {tab === "plugins" ? pluginRows.map((plugin, index) => {
          const isInstalled = installedPackages.has(plugin.packageName);
          return <article key={plugin.id} className="dsh-market-row"><div><strong>{plugin.name}</strong><p>{zh ? plugin.description.zh : plugin.description.en}</p><small>{plugin.owner}</small></div><div className="dsh-market-row-actions"><button type="button" onClick={() => void window.companion.openExternal(plugin.repositoryUrl)} aria-label={zh ? "打开仓库" : "Open repository"}><ExternalLink size={14} /></button><button type="button" className="claude-profile-primary-button" onClick={() => void installPlugin(index)} disabled={isInstalled || busy !== ""}>{isInstalled ? (zh ? "已安装" : "Installed") : (zh ? "安装" : "Install")}</button></div></article>;
        }) : skillRows.map((skill, index) => <article key={skill.key} className="dsh-market-row"><div><strong>{skill.name}</strong><p>{skill.description}</p><small>{skill.repoOwner}/{skill.repoName} · {skill.repoBranch}</small></div><button type="button" className="claude-profile-primary-button" onClick={() => void installSkill(index)} disabled={skill.installed || busy !== ""}>{skill.installed ? (zh ? "已安装" : "Installed") : (zh ? "安装" : "Install")}</button></article>)}
        {!loading && (tab === "plugins" ? pluginRows.length === 0 : skillRows.length === 0) ? <div className="claude-resource-empty">{zh ? "没有匹配项" : "No matches"}</div> : null}
      </section>
    </div>
  );
}
