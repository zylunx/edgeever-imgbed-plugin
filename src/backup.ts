import { PluginContext } from "./types";
import { shortId } from "./util";

/** 替换前的笔记原文备份（context.storage，按插件与工作区隔离，仅本机）。 */

const INDEX_KEY = "imgbed:backup:index";
const ITEM_PREFIX = "imgbed:backup:item:";
const MAX_BACKUPS = 50;

export interface BackupEntry {
  key: string;
  noteId: string;
  noteTitle: string;
  ts: number;
}

export async function saveBackup(
  ctx: PluginContext,
  noteId: string,
  noteTitle: string,
  markdown: string,
): Promise<string> {
  const key = `${noteId}_${shortId()}`;
  await ctx.storage.set(ITEM_PREFIX + key, markdown);
  const index = (await listBackups(ctx)).filter((e) => e.key !== key);
  index.unshift({ key, noteId, noteTitle, ts: Date.now() });
  await ctx.storage.set(INDEX_KEY, index.slice(0, MAX_BACKUPS));
  return key;
}

export async function listBackups(ctx: PluginContext): Promise<BackupEntry[]> {
  try {
    const v = await ctx.storage.get<BackupEntry[]>(INDEX_KEY);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export async function getBackupMarkdown(ctx: PluginContext, key: string): Promise<string | null> {
  try {
    const v = await ctx.storage.get<string>(ITEM_PREFIX + key);
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

export async function removeBackup(ctx: PluginContext, key: string): Promise<void> {
  try {
    await ctx.storage.remove(ITEM_PREFIX + key);
    const index = (await listBackups(ctx)).filter((e) => e.key !== key);
    await ctx.storage.set(INDEX_KEY, index);
  } catch {
    /* 忽略 */
  }
}

export async function latestBackupForNote(ctx: PluginContext, noteId: string): Promise<BackupEntry | null> {
  const index = await listBackups(ctx);
  return index.find((e) => e.noteId === noteId) ?? null;
}
