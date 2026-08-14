export function timeAgo(timestamp: number | undefined, now = Date.now()) {
  const isZh = document.documentElement.lang.startsWith("zh");
  if (!timestamp) return isZh ? "暂无" : "None";
  const seconds = Math.max(1, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return isZh ? `${seconds} 秒前` : `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return isZh ? `${minutes} 分钟前` : `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return isZh ? `${hours} 小时前` : `${hours}h ago`;
}
