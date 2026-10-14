import { PluginContext } from "./types";

/**
 * 上传记录（映射表）：EdgeEver 资源 ↔ 图床文件。
 * 用途：1) 重复上传时直接复用已有链接；2) 面板展示历史；3) 笔记删除时清理远端。
 */

const RECORDS_KEY = "imgbed:records";
const MAX_RECORDS = 500;

export interface UploadRecord {
  id: string;
  noteId: string;
  noteTitle: string;
  /** EdgeEver 资源 ID；面板直传的本地文件为 local:<name>:<ts> */
  resourceId: string;
  fileName: string;
  /** 图床 src，如 /file/xxx */
  src: string;
  /** 绝对访问 URL */
  url: string;
  size: number;
  ts: number;
}

export async function listRecords(ctx: PluginContext): Promise<UploadRecord[]> {
  try {
    const v = await ctx.storage.get<UploadRecord[]>(RECORDS_KEY);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export async function addRecord(ctx: PluginContext, record: UploadRecord): Promise<void> {
  try {
    const list = (await listRecords(ctx)).filter((r) => r.id !== record.id);
    list.unshift(record);
    await ctx.storage.set(RECORDS_KEY, list.slice(0, MAX_RECORDS));
  } catch {
    /* 记录失败不影响主流程 */
  }
}

export async function removeRecords(ctx: PluginContext, ids: string[]): Promise<void> {
  if (!ids.length) return;
  try {
    const idSet = new Set(ids);
    const list = (await listRecords(ctx)).filter((r) => !idSet.has(r.id));
    await ctx.storage.set(RECORDS_KEY, list);
  } catch {
    /* 忽略 */
  }
}

export async function recordsForNote(ctx: PluginContext, noteId: string): Promise<UploadRecord[]> {
  return (await listRecords(ctx)).filter((r) => r.noteId === noteId);
}

export async function findRecord(
  ctx: PluginContext,
  noteId: string,
  resourceId: string,
): Promise<UploadRecord | null> {
  const list = await listRecords(ctx);
  return list.find((r) => r.noteId === noteId && r.resourceId === resourceId && r.url) ?? null;
}
