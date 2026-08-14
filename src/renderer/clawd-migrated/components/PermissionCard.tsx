// @ts-nocheck
import React, { useRef, useState, useEffect } from "react";
import type { PermissionRequest, ToolName } from "../../shared/events";
import { useI18n } from "../useI18n";
import { Shield, Check, X, AlertTriangle, ChevronRight, Layers } from "lucide-react";

interface PermissionCardProps {
  permission: PermissionRequest;
  queueCount: number;
  onAllow: () => void;
  onDeny: () => void;
  settings: { permissionScale?: number; petScale?: number };
  hitTestRef?: React.Ref<HTMLDivElement>;
  offset?: { x?: number; y?: number };
}

type Risk = "low" | "medium" | "high";

const toolMeta: Record<string, { color: string; icon: string }> = {
  Read: { color: "mint", icon: "R" },
  Edit: { color: "coral", icon: "E" },
  Write: { color: "coral", icon: "W" },
  Bash: { color: "ink", icon: "$" },
  Shell: { color: "ink", icon: "$" },
  Grep: { color: "blue", icon: "G" },
  Glob: { color: "blue", icon: "G" },
  WebFetch: { color: "blue", icon: "W" },
  WebSearch: { color: "blue", icon: "S" },
  Notebook: { color: "mint", icon: "N" },
  Agent: { color: "steel", icon: "A" },
  Skill: { color: "honey", icon: "K" },
  Task: { color: "steel", icon: "T" },
  AskUserQuestion: { color: "honey", icon: "?" },
  MCP: { color: "purple", icon: "M" },
  ApplyPatch: { color: "coral", icon: "P" },
  UpdatePlan: { color: "steel", icon: "U" },
  ViewImage: { color: "blue", icon: "V" },
  Unknown: { color: "steel", icon: "?" },
};

function riskForTool(tool: ToolName, detail?: string): Risk {
  if (tool === "Bash" || tool === "Shell") {
    const command = detail?.toLowerCase() ?? "";
    if (/rm\s|reset --hard|push --force|del\s|rmdir|kill|shutdown|format\s|mkfs|dd\s/i.test(command)) return "high";
    return "medium";
  }
  if (tool === "Edit" || tool === "Write" || tool === "Notebook" || tool === "ApplyPatch") return "medium";
  return "low";
}

const riskConfig: Record<Risk, { label: string; color: string; glow: string }> = {
  low: { label: "LOW", color: "var(--mint)", glow: "rgba(86,166,123,0.3)" },
  medium: { label: "MED", color: "var(--honey)", glow: "rgba(234,187,88,0.3)" },
  high: { label: "HIGH", color: "var(--coral)", glow: "rgba(210,95,80,0.35)" },
};

export function PermissionCard({ permission, queueCount, onAllow, onDeny, settings, hitTestRef, offset }: PermissionCardProps) {
  const { t } = useI18n();
  const risk = riskForTool(permission.toolName, permission.toolDetail);
  const rc = riskConfig[risk];
  const meta = toolMeta[permission.toolName] ?? toolMeta.Unknown;

  const detailRef = useRef<HTMLElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useEffect(() => {
    const el = detailRef.current;
    if (!el) { setIsOverflowing(false); return; }
    setIsOverflowing(el.scrollWidth > el.clientWidth);
  }, [permission.toolDetail]);

  const stop = (e: React.MouseEvent | React.PointerEvent) => e.stopPropagation();

  return (
    <div
      className="permission-card-wrapper"
      style={{ transform: `translate(${offset?.x ?? 0}px, ${offset?.y ?? 0}px)` }}
      onPointerDownCapture={stop}
      onMouseDown={stop}
    >
      <div
        ref={hitTestRef}
        className="perm-card"
        style={{
          transform: `scale(${(settings.permissionScale ?? 1) / Math.max(settings.petScale ?? 1, 0.01)})`,
          "--risk-color": rc.color,
          "--risk-glow": rc.glow,
        } as React.CSSProperties}
      >
        <div className="perm-card-risk-bar" data-risk={risk}>
          <div className="perm-card-risk-pulse" />
        </div>

        <div className="perm-card-header">
          <div className="perm-card-header-left">
            <Shield size={14} style={{ color: rc.color }} />
            <span className="perm-card-title">{t("pet.permissionTitle", "权限确认")}</span>
          </div>
          <div className="perm-card-risk-badge" data-risk={risk}>
            <AlertTriangle size={10} />
            <span>{rc.label}</span>
          </div>
        </div>

        <div className="perm-card-body">
          <div className="perm-card-tool-row">
            <span className="perm-card-tool-icon" data-color={meta.color}>{meta.icon}</span>
            <div className="perm-card-tool-info">
              <span className="perm-card-tool-name">{permission.toolName}</span>
              {permission.toolDetail && (
                <code ref={detailRef} className={`perm-card-tool-detail${isOverflowing ? " marquee" : ""}`}>{permission.toolDetail}</code>
              )}
            </div>
          </div>
        </div>

        {queueCount > 1 && (
          <div className="perm-card-queue">
            <Layers size={11} />
            <span>{t("pet.permissionQueue", `${queueCount - 1} 个等待中`).replace("{count}", String(queueCount - 1))}</span>
          </div>
        )}

        <div className="perm-card-actions">
          <button className="perm-card-btn perm-card-btn-deny" onPointerDown={stop} onMouseDown={stop} onClick={e => { stop(e); onDeny(); }}>
            <X size={13} />
            <span>{t("pet.permissionDeny", "拒绝")}</span>
          </button>
          <button className="perm-card-btn perm-card-btn-allow" onPointerDown={stop} onMouseDown={stop} onClick={e => { stop(e); onAllow(); }}>
            <Check size={13} />
            <span>{t("pet.permissionAllow", "允许")}</span>
            <ChevronRight size={12} className="perm-card-btn-arrow" />
          </button>
        </div>
      </div>
    </div>
  );
}

