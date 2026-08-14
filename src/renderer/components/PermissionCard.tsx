import type { CSSProperties } from "react";
import { actionForTool, toolLabel } from "./toolPresentation";

export interface PermissionRequestView {
  id: string;
  tool: string;
  detail?: string;
}

interface PermissionCardProps {
  request: PermissionRequestView;
  queueCount?: number;
  onAllow: () => void;
  onDeny: () => void;
  /** Permission-card size (permissionScale). */
  scale?: number;
}

type RiskLevel = "low" | "medium" | "high";

const riskLabels: Record<RiskLevel, string> = { low: "Low", medium: "Review", high: "Caution" };

/** Longest raw detail we render — the scroll box shows it, but a pathological
 *  mega-string (a whole file, a 1MB patch) is capped so layout/perf stay sane. */
const DETAIL_CAP = 1200;

function getRiskLevel(tool: string, detail: string): RiskLevel {
  const value = `${tool} ${detail}`.toLowerCase();
  if (/bash|shell|powershell|cmd|terminal|rm |sudo|curl|wget|del /.test(value)) return "high";
  if (/edit|write|notebookedit|multiedit|apply/.test(value)) return "medium";
  return "low";
}

export function PermissionCard({ request, queueCount = 0, onAllow, onDeny, scale = 1 }: PermissionCardProps) {
  const rawDetail = (request.detail ?? "").trim();
  const detail = rawDetail.length > DETAIL_CAP ? `${rawDetail.slice(0, DETAIL_CAP)}…` : rawDetail;
  const risk = getRiskLevel(request.tool, rawDetail);

  return (
    <section
      className={`pet-bubble permission-card risk-${risk}`}
      style={{ "--bubble-scale": scale } as CSSProperties}
      aria-label="Permission request"
      role="alertdialog"
    >
      <header className="bubble-head">
        <span className="bubble-eyebrow">
          <span className="bubble-dot" aria-hidden="true" />
          Permission
        </span>
        <span className="permission-risk">{riskLabels[risk]}</span>
      </header>

      <div className="bubble-body">
        <p className="bubble-action">{actionForTool(request.tool)}</p>
        <span className="bubble-tool-chip">{toolLabel(request.tool)}</span>
      </div>

      {detail ? <pre className="bubble-detail">{detail}</pre> : null}

      <footer className="permission-foot">
        {queueCount > 1 ? <span className="permission-queue">+{queueCount - 1} more waiting</span> : <span />}
        <div className="permission-actions">
          <button type="button" className="permission-deny" onClick={onDeny}>Deny</button>
          <button type="button" className="permission-allow" onClick={onAllow}>Allow</button>
        </div>
      </footer>
    </section>
  );
}
