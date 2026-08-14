// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FolderOpen, Hash, Play, RefreshCw, Search, Terminal, TriangleAlert } from "lucide-react";
import type { ClaudeSessionDetail, ClaudeSessionIndexItem, ClaudeSessionSnapshot } from "../../../shared/events";
import { useI18n } from "../../useI18n";
import { useVirtualRows } from "../plugins/useVirtualRows";

const emptySnapshot: ClaudeSessionSnapshot = {
  sessions: [],
  scannedAt: 0,
  projectsDir: "~/.claude/projects"
};

const SESSION_ROW_HEIGHT = 97;

function SessionsPageInner({ active = true, hideSensitiveContent = false, focusSessionPath = null, onFocusSessionHandled }: {
  active?: boolean;
  hideSensitiveContent?: boolean;
  /** Transcript path to select on arrival (jump-in from the data tab's recent-edits list). */
  focusSessionPath?: string | null;
  onFocusSessionHandled?: () => void;
}) {
  const { locale } = useI18n();
  const zh = locale === "zh";
  const [snapshot, setSnapshot] = useState<ClaudeSessionSnapshot>(emptySnapshot);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [detail, setDetail] = useState<ClaudeSessionDetail | null>(null);
  const [detailPath, setDetailPath] = useState<string | null>(null);
  const [detailRevision, setDetailRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wasActiveRef = useRef(active);
  const activeRef = useRef(active);
  useEffect(() => { activeRef.current = active; }, [active]);

  const refresh = useCallback(async (force = false, preserveContent = false) => {
    if (!preserveContent) setLoading(true);
    setError(null);
    try {
      const next = await window.companion.getClaudeSessions(force);
      const safe = next ?? emptySnapshot;
      setSnapshot(safe);
      setSelectedPath(current => current ?? safe.sessions?.[0]?.filePath ?? null);
      setDetailRevision(current => current + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!preserveContent) setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const wasActive = wasActiveRef.current;
    wasActiveRef.current = active;
    if (active && !wasActive) void refresh(false, true);
  }, [active, refresh]);

  // Live refresh: main runs a debounced forced rescan on SessionStart / Stop hook events and
  // pushes every fresh scan result over this channel. Subscribing (even while hidden) is what
  // makes a new session appear within seconds — pulling via getClaudeSessions would only get
  // the stale snapshot that stale-while-revalidate serves.
  useEffect(() => {
    if (typeof window.companion.onSessionsUpdated !== "function") return undefined;
    return window.companion.onSessionsUpdated(next => {
      const safe = (next as ClaudeSessionSnapshot | null) ?? emptySnapshot;
      setSnapshot(safe);
      setSelectedPath(current => current ?? safe.sessions?.[0]?.filePath ?? null);
      // Detail refetch parses up to 16MB of transcript in main. The page stays mounted for
      // the app's whole lifetime, and pushes arrive after every Claude turn — so only refetch
      // while the tab is actually visible; activation's refresh() bumps the revision anyway.
      if (activeRef.current) setDetailRevision(current => current + 1);
    });
  }, []);

  // Jump-in from the data tab: select the requested transcript and clear any filter that
  // could hide it. The scroll is parked in pendingFocusRef because the snapshot may still be
  // loading when the jump lands — the effect below retries whenever the session list changes
  // and only consumes the pending path once the target row actually exists in it.
  const pendingFocusRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusSessionPath) return;
    pendingFocusRef.current = focusSessionPath;
    setQuery("");
    setSelectedPath(focusSessionPath);
    onFocusSessionHandled?.();
  }, [focusSessionPath]);

  useEffect(() => {
    const target = pendingFocusRef.current;
    if (!target) return;
    const index = snapshot.sessions.findIndex(session => session.filePath === target);
    if (index < 0) return; // not scanned in yet (or beyond the scan cap) — keep waiting
    pendingFocusRef.current = null;
    requestAnimationFrame(() => {
      virtual.viewportRef.current?.scrollTo({ top: Math.max(0, (index - 1) * SESSION_ROW_HEIGHT), behavior: "auto" });
    });
  }, [snapshot.sessions, focusSessionPath]);

  const filteredSessions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return snapshot.sessions;
    return snapshot.sessions.filter(session => [
      hideSensitiveContent ? "" : session.title,
      hideSensitiveContent ? "" : session.firstPrompt,
      hideSensitiveContent ? "" : session.projectName,
      hideSensitiveContent ? "" : session.projectPath,
      session.sessionId,
      session.model,
      hideSensitiveContent ? "" : session.branch
    ].filter(Boolean).join(" ").toLowerCase().includes(needle));
  }, [hideSensitiveContent, query, snapshot.sessions]);
  const virtual = useVirtualRows(filteredSessions, SESSION_ROW_HEIGHT, `${hideSensitiveContent}:${query}`);

  const selected = filteredSessions.find(session => session.filePath === selectedPath) ?? filteredSessions[0] ?? null;
  const previewMessages = useMemo(() => {
    return (detail?.messages ?? []).filter(message => {
      const text = message.text.trim();
      if (!text) return false;
      if (/^(PowerShell|Bash|Shell|cmd)$/i.test(text)) return false;
      return message.role === "user" || message.role === "assistant";
    });
  }, [detail?.messages]);

  useEffect(() => {
    if (!selected?.filePath) {
      setDetail(null);
      setDetailPath(null);
      setDetailLoading(false);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    window.companion.getClaudeSessionDetail(selected.filePath)
      .then(next => {
        if (cancelled) return;
        setDetail(next);
        setDetailPath(selected.filePath);
      })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [detailRevision, selected?.filePath]);

  const selectedDetailReady = detailPath === selected?.filePath && detail !== null;

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // The resume command mirrors what the Resume button launches, with a cd prefix so a paste
  // lands in the session's original working directory first. Joined with ";" not "&&":
  // Windows PowerShell 5.1 (the shell the Resume button itself opens, and the Windows
  // Terminal default) rejects "&&", while ";" works in both PS 5.1 and PowerShell 7 — and
  // PowerShell's cd changes drives without the /d that cmd's cd would need.
  function resumeCommandFor(session: ClaudeSessionIndexItem) {
    const base = `claude --resume ${session.sessionId}`;
    return session.projectPath ? `cd "${session.projectPath}"; ${base}` : base;
  }

  async function copyToClipboard(text: string, doneMessage: string) {
    try {
      await navigator.clipboard.writeText(text);
      setToast(doneMessage);
    } catch {
      setToast(zh ? "复制失败" : "Copy failed");
    }
  }

  async function resumeSession(session: ClaudeSessionIndexItem) {
    const command = `claude --resume ${session.sessionId}`;
    setError(null);
    try {
      const result = await window.companion.resumeClaudeSession(session.sessionId, session.projectPath);
      if (result?.ok) {
        setToast(zh ? "已打开终端恢复会话" : "Opened terminal to resume");
        return;
      }
      // Surface the actionable error from main (missing CLI + install/restart hint,
      // an unsupported working directory, or a launch failure). Copying the command
      // only helps when it could actually run, so copy + say so only when main marks
      // the result copyable (claude resolved) — otherwise the error is the guidance,
      // and copying an unrunnable `claude --resume ...` would just mislead.
      if (result?.copyable) {
        await navigator.clipboard.writeText(result?.command || command);
        setToast(zh ? "终端未打开，已复制恢复命令" : "Could not open terminal; command copied");
      }
      if (result?.error) setError(result.error);
    } catch (err) {
      await navigator.clipboard.writeText(command);
      setToast(zh ? "调用失败，已复制恢复命令" : "Resume failed; command copied");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="claude-sessions-page">
      <nav className="session-viewer-toolbar">
        <div className="session-viewer-search">
          <Search size={16} />
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder={zh ? "搜索会话、项目或 session id..." : "Search sessions, projects, or session id..."} />
          <span>{formatSessionCount(filteredSessions.length, snapshot.sessions.length, zh)}</span>
        </div>
        <button onClick={() => void refresh(true)} disabled={loading} title={zh ? "刷新" : "Refresh"}>
          <RefreshCw size={17} />
        </button>
      </nav>

      {error ? <section className="session-viewer-error"><TriangleAlert size={16} />{error}</section> : null}

      <section className="session-viewer-layout">
        <aside ref={virtual.viewportRef} className="session-viewer-list" onScroll={event => virtual.onScroll(event.currentTarget.scrollTop)}>
          {loading ? (
            <div className="session-viewer-empty">{zh ? "正在扫描 ~/.claude/projects..." : "Scanning ~/.claude/projects..."}</div>
          ) : filteredSessions.length === 0 ? (
            <div className="session-viewer-empty">{zh ? "没有发现 Claude Code 历史会话。" : "No Claude Code sessions found."}</div>
          ) : (
            <div className="session-viewer-virtual-space" style={{ height: virtual.totalHeight }}>
              {virtual.visible.map((session, offset) => {
                const index = virtual.start + offset;
                return (
                  <button
                    key={session.filePath}
                    className={`session-viewer-row ${selected?.filePath === session.filePath ? "active" : ""}`}
                    style={{ height: SESSION_ROW_HEIGHT, transform: `translateY(${index * SESSION_ROW_HEIGHT}px)` }}
                    onClick={() => { pendingFocusRef.current = null; setSelectedPath(session.filePath); }}
                  >
                    <strong>{hideSensitiveContent ? `${zh ? "会话" : "Session"} ${session.sessionId.slice(0, 8)}` : compactTitle(session.title)}</strong>
                    <p className="session-viewer-project-path">{hideSensitiveContent ? (zh ? "详情已隐藏" : "Details hidden") : session.projectPath || session.projectName}</p>
                    <footer>
                      <em className={session.status}>{session.status}</em>
                      <span>{session.messageCount} {zh ? "条事件" : "events"}</span>
                      <time>{formatTime(session.lastMessageAt)}</time>
                    </footer>
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        <article className="session-viewer-detail">
          {selected ? (
            <>
              <header>
                <div>
                  <h2>{hideSensitiveContent ? `${zh ? "会话" : "Session"} ${selected.sessionId.slice(0, 8)}` : selected.title}</h2>
                </div>
                <div className="session-viewer-actions">
                  <button
                    className="session-icon-button"
                    title={zh ? "复制恢复命令" : "Copy resume command"}
                    aria-label={zh ? "复制恢复命令" : "Copy resume command"}
                    onClick={() => void copyToClipboard(resumeCommandFor(selected), zh ? "已复制恢复命令" : "Resume command copied")}
                  ><Terminal size={14} /></button>
                  <button
                    className="session-icon-button"
                    title={zh ? "复制会话 ID" : "Copy session ID"}
                    aria-label={zh ? "复制会话 ID" : "Copy session ID"}
                    onClick={() => void copyToClipboard(selected.sessionId, zh ? "已复制会话 ID" : "Session ID copied")}
                  ><Hash size={14} /></button>
                  <button
                    className="session-icon-button"
                    title={zh ? "在资源管理器中显示日志" : "Show transcript in Explorer"}
                    aria-label={zh ? "在资源管理器中显示日志" : "Show transcript in Explorer"}
                    onClick={() => void window.companion.openClaudeResource(selected.filePath)}
                  ><FolderOpen size={14} /></button>
                  <button className="session-resume-button" onClick={() => void resumeSession(selected)}><Play size={14} />{zh ? "恢复" : "Resume"}</button>
                </div>
              </header>

              <div className="session-viewer-meta">
                <Meta label="Model" value={selected.model || unknownValue(zh)} />
                <Meta label={zh ? "Git 分支" : "Git branch"} value={hideSensitiveContent ? (zh ? "已隐藏" : "Hidden") : selected.branch || unknownValue(zh)} />
                <Meta label={zh ? "消息" : "Messages"} value={String(selectedDetailReady ? detail?.totalMessages ?? selected.messageCount : selected.messageCount)} />
                <Meta label={zh ? "最后活动" : "Last activity"} value={formatDateTime(selected.lastMessageAt)} />
              </div>

              <div className="session-message-list" aria-busy={detailLoading}>
                {detailLoading && !selectedDetailReady ? <div className="session-viewer-empty small">{zh ? "加载消息中..." : "Loading messages..."}</div> : null}
                {!detailLoading && selectedDetailReady && (hideSensitiveContent || previewMessages.length === 0) ? <div className="session-viewer-empty small">{hideSensitiveContent ? (zh ? "敏感内容已隐藏。" : "Sensitive content is hidden.") : (zh ? "没有可预览的消息。" : "No messages to preview.")}</div> : null}
                {!hideSensitiveContent && selectedDetailReady && previewMessages.map(message => (
                  <section key={message.id} className={`session-message-row ${message.role}`}>
                    <div>
                      <strong>{roleLabel(message.role, zh)}</strong>
                      {message.timestamp ? <time>{formatTime(message.timestamp)}</time> : null}
                    </div>
                    <p>{message.text}</p>
                  </section>
                ))}
              </div>
            </>
          ) : (
            <div className="session-viewer-empty"><Terminal size={18} />{zh ? "选择一个会话查看详情。" : "Select a session to view details."}</div>
          )}
        </article>
      </section>

      {toast ? <div className="session-toast">{toast}</div> : null}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function compactTitle(title: string) {
  const normalized = (title || "").replace(/\s+/g, " ").trim();
  return normalized || "Untitled session";
}

function formatSessionCount(filtered: number, total: number, zh: boolean) {
  if (filtered === total) return zh ? `${total} 项` : `${total} items`;
  return zh ? `${filtered} / ${total} 项` : `${filtered} / ${total} items`;
}

function unknownValue(zh: boolean) {
  return zh ? "未知" : "unknown";
}

function roleLabel(role: string, zh: boolean) {
  if (role === "assistant") return "Claude";
  if (!zh) return role;
  if (role === "user") return "用户";
  if (role === "system") return "记录";
  return role;
}

function shortId(id: string) {
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

function formatTime(timestamp: number) {
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDateTime(timestamp: number) {
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleString();
}

// Keep-mounted under the tab container: memoized so an unrelated settings change
// or a tab switch doesn't re-render the session list + detail panel.
export const SessionsPage = React.memo(SessionsPageInner);
