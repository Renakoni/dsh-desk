type DisplayEvent = {
  event: string;
  notificationKind?: string;
  title?: string;
  message?: string;
  detail?: string;
  tool?: string;
  cwd?: string;
};

export type DisplayLanguage = "en" | "zh";

function privateTitle(event: DisplayEvent, language: DisplayLanguage): string {
  const zh = language === "zh";
  if (event.notificationKind === "attention") return zh ? "需要处理" : "Attention required";
  if (event.notificationKind === "info") return zh ? "通知" : "Notification";
  if (event.tool) return zh ? `${event.tool} 操作` : `${event.tool} activity`;

  switch (event.event) {
    case "session_start": return zh ? "会话已开始" : "Session started";
    case "prompt_submit": return zh ? "新任务" : "New task";
    case "permission-prompt":
    case "permission_wait": return zh ? "权限请求" : "Permission request";
    case "completed":
    case "done": return zh ? "已完成" : "Completed";
    case "error": return zh ? "任务出错" : "Task error";
    case "git_operation": return zh ? "Git 操作" : "Git activity";
    case "idle":
    case "heartbeat": return zh ? "等待中" : "Waiting";
    default: return zh ? "活动更新" : "Activity update";
  }
}

export function redactDisplayEvent<T extends DisplayEvent>(event: T, language: DisplayLanguage = "en"): T {
  return {
    ...event,
    title: privateTitle(event, language),
    message: "",
    detail: undefined,
    cwd: undefined
  };
}

// Filesystem paths inside free-form status/error strings still leak the home
// directory (and therefore the username) even when the rest of the UI is
// redacted. These patterns strip absolute paths — INCLUDING ones with spaces
// such as "C:\Program Files\.." or "/opt/DSH Desk/.." — while leaving
// status words, counts, event names, and versions intact.
//
// This is a best-effort fallback for arbitrary error text: the path-bearing hook
// errors are handled structurally (the backend returns an error kind + the path
// as a separate field, and the renderer only shows the path when hiding is off).
// Where the two conflict, this deliberately OVER-redacts rather than risk leaking
// a path — so trailing prose after a path may also be hidden.
const POSIX_PATH_ROOTS = "Users|home|root|opt|tmp|var|usr|etc|srv|mnt|media|run|workspace|snap|data|bin|sbin|dev|proc|Applications|Volumes|Library|System|private|Network";
const SENSITIVE_PATH_PATTERNS = [
  // Windows drive paths (segments may contain spaces). Stops before a following
  // " X:\" drive path, a quote, a shell redirect, or end of line.
  /(?<![A-Za-z0-9])[A-Za-z]:[\\/](?:(?! [A-Za-z]:[\\/])[^\r\n"'|<>])*/g,
  // UNC paths: \\server\share\... or //server/share/... . The negative
  // lookbehind keeps the latter from treating the // in https:// as a path.
  /(?:\\\\|(?<!:)\/\/)[^\r\n"'|<>]*/g,
  // POSIX absolute paths from a known root, plus ~/ home paths (segments may
  // contain spaces). Stops before a following " /" path, a quote, or line end.
  new RegExp(`(?:~/|/(?:${POSIX_PATH_ROOTS})/)(?:(?! /)[^\\r\\n"'|<>])*`, "g")
];

// Replace absolute filesystem paths in a free-form string with a generic
// placeholder. Only used when "hide paths and content" is enabled.
export function redactSensitiveText(text: string, language: DisplayLanguage = "en"): string {
  const placeholder = language === "zh" ? "[路径已隐藏]" : "[path hidden]";
  return SENSITIVE_PATH_PATTERNS.reduce((out, pattern) => out.replace(pattern, placeholder), text);
}
