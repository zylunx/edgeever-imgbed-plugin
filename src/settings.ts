import { PluginContext } from "./types";

export interface ImgbedSettings {
  /** 图床站点地址，如 https://img.example.com（不含末尾斜杠） */
  endpoint: string;
  authMode: "token" | "authCode" | "none";
  apiToken: string;
  authCode: string;
  returnFormat: "full" | "default";
  uploadChannel: string;
  channelName: string;
  uploadNameType: string;
  uploadFolder: string;
  serverCompress: boolean;
  autoUploadOnSave: boolean;
  autoUploadScope: "current" | "all";
  deleteLocalAfterUpload: boolean;
  syncDeleteRemote: boolean;
  backupBeforeReplace: boolean;
  localRefPattern: string;
  markdownTemplate: string;
  /** 单文件大小上限（MB），<= 0 表示不限制 */
  maxFileSizeMB: number;
  includeNonImages: boolean;
}

export const SETTINGS_DEFAULTS: ImgbedSettings = {
  endpoint: "",
  authMode: "token",
  apiToken: "",
  authCode: "",
  returnFormat: "full",
  uploadChannel: "",
  channelName: "",
  uploadNameType: "default",
  uploadFolder: "edgeever",
  serverCompress: true,
  autoUploadOnSave: false,
  autoUploadScope: "current",
  deleteLocalAfterUpload: false,
  syncDeleteRemote: false,
  backupBeforeReplace: true,
  localRefPattern: "",
  markdownTemplate: "![{alt}]({url})",
  maxFileSizeMB: 20,
  includeNonImages: false,
};

function asString(v: unknown, dflt: string): string {
  if (typeof v === "string") return v;
  if (v == null) return dflt;
  return String(v);
}

function asBool(v: unknown, dflt: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v === "true" || v === "1";
  if (typeof v === "number") return v !== 0;
  return dflt;
}

function asNumber(v: unknown, dflt: number): number {
  const n = typeof v === "number" ? v : Number.parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : dflt;
}

/**
 * 把 manifest 中的上传渠道选项归一化：图床默认渠道在 UI 上以 "default" 表示，
 * 实际请求时不发送 uploadChannel 参数（=图床默认的 telegram）。
 */
function normalizeChannel(v: string): string {
  return v && v !== "default" ? v : "";
}

/**
 * 从宿主读取插件设置。任何读取失败都回退到默认值，保证插件不会因为设置问题而崩溃。
 * 注意：manifest 中的设置 key 使用 kebab-case（如 auth-mode），这里读取时须保持一致。
 */
export async function loadSettings(ctx: PluginContext): Promise<ImgbedSettings> {
  const get = async (key: string): Promise<unknown> => {
    try {
      return await ctx.settings.get(key);
    } catch {
      return undefined;
    }
  };

  const authModeRaw = asString(await get("auth-mode"), SETTINGS_DEFAULTS.authMode);
  const returnFormatRaw = asString(await get("return-format"), SETTINGS_DEFAULTS.returnFormat);
  const scopeRaw = asString(await get("auto-upload-scope"), SETTINGS_DEFAULTS.autoUploadScope);

  return {
    endpoint: asString(await get("endpoint"), "").trim().replace(/\/+$/, ""),
    authMode: authModeRaw === "authCode" || authModeRaw === "none" ? authModeRaw : "token",
    apiToken: asString(await get("api-token"), "").trim(),
    authCode: asString(await get("auth-code"), "").trim(),
    returnFormat: returnFormatRaw === "default" ? "default" : "full",
    uploadChannel: normalizeChannel(asString(await get("upload-channel"), "default").trim()),
    channelName: asString(await get("channel-name"), "").trim(),
    uploadNameType: asString(await get("upload-name-type"), SETTINGS_DEFAULTS.uploadNameType).trim(),
    uploadFolder: asString(await get("upload-folder"), SETTINGS_DEFAULTS.uploadFolder).trim(),
    serverCompress: asBool(await get("server-compress"), SETTINGS_DEFAULTS.serverCompress),
    autoUploadOnSave: asBool(await get("auto-upload-on-save"), SETTINGS_DEFAULTS.autoUploadOnSave),
    autoUploadScope: scopeRaw === "all" ? "all" : "current",
    deleteLocalAfterUpload: asBool(await get("delete-local-after-upload"), SETTINGS_DEFAULTS.deleteLocalAfterUpload),
    syncDeleteRemote: asBool(await get("sync-delete-remote"), SETTINGS_DEFAULTS.syncDeleteRemote),
    backupBeforeReplace: asBool(await get("backup-before-replace"), SETTINGS_DEFAULTS.backupBeforeReplace),
    localRefPattern: asString(await get("local-ref-pattern"), "").trim(),
    markdownTemplate: asString(await get("markdown-template"), SETTINGS_DEFAULTS.markdownTemplate),
    maxFileSizeMB: asNumber(await get("max-file-size-mb"), SETTINGS_DEFAULTS.maxFileSizeMB),
    includeNonImages: asBool(await get("include-non-images"), SETTINGS_DEFAULTS.includeNonImages),
  };
}

/** 返回错误信息；null 表示配置可用。 */
export function validateSettings(s: ImgbedSettings): string | null {
  if (!s.endpoint) return "请先在插件设置中配置「图床站点地址」";
  if (!/^https?:\/\//i.test(s.endpoint)) return "图床站点地址必须以 http:// 或 https:// 开头";
  if (s.authMode === "token" && !s.apiToken) return "鉴权方式为 API Token，但未填写 Token";
  if (s.authMode === "authCode" && !s.authCode) return "鉴权方式为上传认证码，但未填写认证码";
  return null;
}
