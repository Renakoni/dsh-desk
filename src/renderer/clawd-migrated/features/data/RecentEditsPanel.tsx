// @ts-nocheck
import React, { useEffect, useState } from "react";
import { ArrowUpRight, FilePen, FilePlus2 } from "lucide-react";
import { useI18n } from "../../useI18n";

const PAGE_SIZE = 10;

function formatWhen(timestamp: number, zh: boolean) {
  if (!timestamp) return "—";
  const delta = Date.now() - timestamp;
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return zh ? "刚刚" : "just now";
  if (minutes < 60) return zh ? `${minutes} 分钟前` : `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return zh ? `${hours} 小时前` : `${hours} h ago`;
  return new Date(timestamp).toLocaleDateString(zh ? "zh-CN" : "en-US", { month: "2-digit", day: "2-digit" });
}

function splitPath(filePath: string) {
  const normalized = (filePath || "").replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? { name: normalized.slice(index + 1), dir: normalized.slice(0, index) } : { name: normalized, dir: "" };
}

export function RecentEditsPanel({ hideSensitiveContent = false, onOpenSession }: {
  hideSensitiveContent?: boolean;
  onOpenSession?: (sessionFilePath: string) => void;
}) {
  const { t, locale } = useI18n();
  const zh = locale === "zh";
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const load = async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.companion.getRecentEdits(force);
      setSnapshot(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(false); }, []);

  const edits = snapshot?.edits ?? [];
  const rows = edits.slice(0, visibleCount);
  const summary = snapshot
    ? zh ? `${snapshot.totalEdits} 条记录 · ${snapshot.totalFiles} 个文件` : `${snapshot.totalEdits} records · ${snapshot.totalFiles} files`
    : zh ? "正在从会话日志提取编辑记录…" : "Extracting edits from session logs…";

  return (
    <div className="recent-edits-panel">
      <div className="recent-edits-head">
        <p className="note">{error ? `${zh ? "加载失败" : "Failed to load"}: ${error}` : summary}</p>
        <button className="ghost-btn" onClick={() => void load(true)} disabled={loading}>{loading ? (zh ? "扫描中…" : "Scanning…") : t("common.refresh", "刷新")}</button>
      </div>

      {snapshot && edits.length === 0 && !error ? <p className="note">{zh ? "暂无编辑记录，DSH 工具修改过的文件会出现在这里。" : "No edits recorded yet. Files modified by DSH tools will appear here."}</p> : null}

      {rows.length > 0 ? (
        <div className="recent-edits-list">
          {rows.map((edit, index) => {
            const { name, dir } = splitPath(edit.filePath);
            return (
              <article key={edit.id} className="recent-edit-row">
                {edit.op === "create"
                  ? <FilePlus2 size={15} className="recent-edit-icon create" />
                  : <FilePen size={15} className="recent-edit-icon" />}
                <div className="recent-edit-file">
                  <strong title={hideSensitiveContent ? undefined : edit.filePath}>{hideSensitiveContent ? `${zh ? "文件" : "File"} ${index + 1}` : name}</strong>
                  <p title={hideSensitiveContent ? undefined : dir}>{hideSensitiveContent ? (zh ? "详情已隐藏" : "Details hidden") : dir || edit.projectName}</p>
                </div>
                <span className={`recent-edit-op ${edit.op}`}>{edit.op === "create" ? (zh ? "新建" : "Created") : (zh ? "编辑" : "Edited")}</span>
                <span className="recent-edit-lines">
                  {edit.addedLines > 0 ? <b className="add">+{edit.addedLines}</b> : null}
                  {edit.removedLines > 0 ? <b className="del">−{edit.removedLines}</b> : null}
                  {edit.addedLines === 0 && edit.removedLines === 0 ? <b className="none">—</b> : null}
                </span>
                <time>{formatWhen(edit.timestamp, zh)}</time>
                {onOpenSession ? (
                  <button
                    type="button"
                    className="recent-edit-jump"
                    title={zh ? "查看所属会话" : "View session"}
                    aria-label={zh ? "查看所属会话" : "View session"}
                    onClick={() => onOpenSession(edit.sessionFilePath)}
                  >
                    <ArrowUpRight size={14} />
                  </button>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}

      {edits.length > visibleCount || (visibleCount > PAGE_SIZE && edits.length > PAGE_SIZE) ? (
        <div className="recent-edits-footer">
          {edits.length > visibleCount ? (
            <button className="ghost-btn token-more-btn" onClick={() => setVisibleCount(count => count + 20)}>{t("stats.showMore", "查看更多")} ({edits.length - visibleCount})</button>
          ) : null}
          {visibleCount > PAGE_SIZE && edits.length > PAGE_SIZE ? (
            <button className="ghost-btn token-more-btn" onClick={() => setVisibleCount(PAGE_SIZE)}>{t("stats.collapse", "收起")}</button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
