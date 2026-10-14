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
 * 从宿主读取插件设置。任何读取失败都回退到默认值，保证插件不会因为设置问题而崩溃。
 */
export async function loadSettings(ctx: PluginContext): Promise<ImgbedSettings> {
  const get = async (key: string): Promise<unknown> => {
    try {
      return await ctx.settings.get(key);
    } catch {
      return undefined;
    }
  };

  const authModeRaw = asString(await get("authMode"), SETTINGS_DEFAULTS.authMode);
  const returnFormatRaw = asString(await get("returnFormat"), SETTINGS_DEFAULTS.returnFormat);
  const scopeRaw = asString(await get("autoUploadScope"), SETTINGS_DEFAULTS.autoUploadScope);

  return {
    endpoint: asString(await get("endpoint"), "").trim().replace(/\/+$/, ""),
    authMode: authModeRaw === "authCode" || authModeRaw === "none" ? authModeRaw : "token",
    apiToken: asString(await get("apiToken"), "").trim(),
    authCode: asString(await get("authCode"), "").trim(),
    returnFormat: returnFormatRaw === "default" ? "default" : "full",
    uploadChannel: asString(await get("uploadChannel"), "").trim(),
    channelName: asString(await get("channelName"), "").trim(),
    uploadNameType: asString(await get("uploadNameType"), SETTINGS_DEFAULTS.uploadNameType).trim(),
    uploadFolder: asString(await get("uploadFolder"), SETTINGS_DEFAULTS.uploadFolder).trim(),
    serverCompress: asBool(await get("serverCompress"), SETTINGS_DEFAULTS.serverCompress),
    autoUploadOnSave: asBool(await get("autoUploadOnSave"), SETTINGS_DEFAULTS.autoUploadOnSave),
    autoUploadScope: scopeRaw === "all" ? "all" : "current",
    deleteLocalAfterUpload: asBool(await get("deleteLocalAfterUpload"), SETTINGS_DEFAULTS.deleteLocalAfterUpload),
    syncDeleteRemote: asBool(await get("syncDeleteRemote"), SETTINGS_DEFAULTS.syncDeleteRemote),
    backupBeforeReplace: asBool(await get("backupBeforeReplace"), SETTINGS_DEFAULTS.backupBeforeReplace),
    localRefPattern: asString(await get("localRefPattern"), "").trim(),
    markdownTemplate: asString(await get("markdownTemplate"), SETTINGS_DEFAULTS.markdownTemplate),
    maxFileSizeMB: asNumber(await get("maxFileSizeMB"), SETTINGS_DEFAULTS.maxFileSizeMB),
    includeNonImages: asBool(await get("includeNonImages"), SETTINGS_DEFAULTS.includeNonImages),
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
