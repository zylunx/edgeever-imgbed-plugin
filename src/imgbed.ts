import { PluginContext, NetworkResponse } from "./types";
import { ImgbedSettings } from "./settings";
import { errMsg, isHttpUrl, joinUrl, truncate } from "./util";

/** CloudFlare ImgBed 客户端（依据 图床api指南 实现）。 */

export interface UploadResult {
  /** 最终可访问的绝对 URL */
  url: string;
  /** 图床返回的原始 src（如 /file/xxx），用于删除接口 */
  src: string;
  name: string;
  size: number;
}

export class ImgbedError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ImgbedError";
    this.status = status;
  }
}

function base(settings: ImgbedSettings): string {
  return settings.endpoint.replace(/\/+$/, "");
}

function authHeaders(settings: ImgbedSettings): Record<string, string> {
  if (settings.authMode === "token" && settings.apiToken) {
    return { Authorization: `Bearer ${settings.apiToken}` };
  }
  return {};
}

/** 构造 /upload 请求 URL（含查询参数）。 */
export function buildUploadUrl(settings: ImgbedSettings, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams();
  params.set("returnFormat", settings.returnFormat === "full" ? "full" : "default");
  if (settings.uploadChannel) params.set("uploadChannel", settings.uploadChannel);
  if (settings.channelName) params.set("channelName", settings.channelName);
  if (settings.uploadNameType) params.set("uploadNameType", settings.uploadNameType);
  if (settings.uploadFolder) params.set("uploadFolder", settings.uploadFolder);
  // serverCompress 仅 Telegram 渠道有意义，避免对其他渠道造成干扰
  if (settings.serverCompress && (!settings.uploadChannel || settings.uploadChannel === "telegram")) {
    params.set("serverCompress", "true");
  }
  if (settings.authMode === "authCode" && settings.authCode) {
    params.set("authCode", settings.authCode);
  }
  for (const [k, v] of Object.entries(extra)) {
    if (v) params.set(k, v);
  }
  return `${base(settings)}/upload?${params.toString()}`;
}

async function safeText(res: NetworkResponse): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

/**
 * 上传单个文件到图床。
 * 注意：未实现分块上传，调用方应先做大小检查。
 */
export async function uploadFile(ctx: PluginContext, settings: ImgbedSettings, file: File): Promise<UploadResult> {
  const fd = new FormData();
  fd.append("file", file, file.name);

  let res: NetworkResponse;
  try {
    res = await ctx.network.fetch(buildUploadUrl(settings), {
      method: "POST",
      headers: authHeaders(settings),
      body: fd,
    });
  } catch (e) {
    throw new ImgbedError(`网络请求失败：${errMsg(e)}`);
  }

  const bodyText = await safeText(res);
  if (!res.ok) {
    throw new ImgbedError(`图床返回 HTTP ${res.status}${bodyText ? `：${truncate(bodyText, 200)}` : ""}`, res.status);
  }

  let data: unknown;
  try {
    data = JSON.parse(bodyText);
  } catch {
    throw new ImgbedError(`图床响应不是合法 JSON：${truncate(bodyText, 200)}`);
  }

  const first: Record<string, unknown> | null = Array.isArray(data)
    ? ((data[0] as Record<string, unknown>) ?? null)
    : data && typeof data === "object"
      ? (data as Record<string, unknown>)
      : null;

  const src = typeof first?.src === "string" ? first.src : "";
  const publicUrl = typeof first?.publicUrl === "string" ? first.publicUrl : "";
  if (!src && !publicUrl) {
    throw new ImgbedError(`图床响应中未找到文件链接：${truncate(bodyText, 200)}`);
  }

  // 优先使用图床配置的公开前缀（publicUrl），其次 src，最后拼接站点地址
  let url = "";
  if (isHttpUrl(publicUrl)) url = publicUrl;
  else if (isHttpUrl(src)) url = src;
  else if (src) url = joinUrl(settings.endpoint, src);
  else url = publicUrl;

  return { url, src: src || publicUrl, name: file.name, size: file.size };
}

/** 把上传返回的 src 转换为删除接口使用的文件 ID。 */
export function srcToFileId(src: string): string {
  let s = src.trim();
  if (isHttpUrl(s)) {
    try {
      const u = new URL(s);
      s = u.pathname;
    } catch {
      /* 保留原值 */
    }
  }
  s = s.replace(/^\/+/, "").replace(/^file\//, "");
  return s;
}

/** 删除图床中的单个文件（需要 delete 权限的 Token）。 */
export async function deleteFile(ctx: PluginContext, settings: ImgbedSettings, src: string): Promise<void> {
  const fileId = srcToFileId(src);
  if (!fileId) return;
  const url = `${base(settings)}/api/manage/delete/${encodeURI(fileId)}`;
  let res: NetworkResponse;
  try {
    res = await ctx.network.fetch(url, { method: "GET", headers: authHeaders(settings) });
  } catch (e) {
    throw new ImgbedError(`删除请求失败：${errMsg(e)}`);
  }
  if (!res.ok) {
    const bodyText = await safeText(res);
    throw new ImgbedError(`图床返回 HTTP ${res.status}${bodyText ? `：${truncate(bodyText, 200)}` : ""}`, res.status);
  }
}

/** 简单的连通性测试：GET 站点根路径，返回 HTTP 状态码。 */
export async function testConnection(
  ctx: PluginContext,
  settings: ImgbedSettings,
): Promise<{ ok: boolean; status: number; message: string }> {
  try {
    const res = await ctx.network.fetch(base(settings), { method: "GET" });
    const text = await safeText(res);
    return {
      ok: res.ok,
      status: res.status,
      message: res.ok
        ? `站点可达（HTTP ${res.status}）`
        : `站点返回 HTTP ${res.status}${text ? `：${truncate(text, 120)}` : ""}`,
    };
  } catch (e) {
    return { ok: false, status: 0, message: `连接失败：${errMsg(e)}` };
  }
}
