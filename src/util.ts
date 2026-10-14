/** 通用工具函数 */

export function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message || e.name;
  try {
    return String(e);
  } catch {
    return "未知错误";
  }
}

export function isHttpUrl(u: string): boolean {
  return /^https?:\/\//i.test(u.trim());
}

/** 拼接 base 与 path，保留 base 中可能存在的子路径。 */
export function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : "/" + path;
  return b + p;
}

export function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + "…";
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "-";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

/** 生成短随机 ID（记录主键等场景）。 */
export function shortId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
