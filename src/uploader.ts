import { PluginContext, PluginNote, PluginResource } from "./types";
import { ImgbedSettings } from "./settings";
import { classifyRef, computeReplacements, parseImageRefs, resId, resName } from "./markdown";
import {
  getEditorDoc,
  docNoteId,
  docText,
  listNoteResources,
  readResourceFile,
  writeNoteMarkdown,
} from "./notes";
import { deleteFile, uploadFile, UploadResult } from "./imgbed";
import { addRecord, listRecords, removeRecords, UploadRecord } from "./records";
import { saveBackup } from "./backup";
import { errMsg, formatBytes } from "./util";

/** 单篇笔记的处理报告 */
export interface ProcessReport {
  noteId: string;
  noteTitle: string;
  /** 本轮新上传 */
  uploaded: Array<{ resourceId: string; fileName: string; url: string; size: number }>;
  /** 复用历史记录中的链接 */
  reused: string[];
  /** 实际替换的引用数量（按写回时的最新正文计算） */
  replaced: number;
  /** 疑似本地但无法匹配到资源的引用目标 */
  unmatched: string[];
  /** 匹配到但为非图片、被设置跳过的文件名 */
  nonImages: string[];
  /** 超过大小上限被跳过的文件 */
  skippedLarge: string[];
  failed: Array<{ name: string; error: string }>;
  deletedLocal: string[];
  deletedRemote: string[];
  backupKey: string | null;
  changed: boolean;
}

function emptyReport(noteId: string, noteTitle: string): ProcessReport {
  return {
    noteId,
    noteTitle,
    uploaded: [],
    reused: [],
    replaced: 0,
    unmatched: [],
    nonImages: [],
    skippedLarge: [],
    failed: [],
    deletedLocal: [],
    deletedRemote: [],
    backupKey: null,
    changed: false,
  };
}

/**
 * 处理一篇笔记：上传本地图片 → 替换为 Markdown 外链 → （可选）删除本地资源 / 同步删除远端。
 *
 * 流程刻意设计为两阶段：
 *   1. 分析 + 上传阶段：基于进入时的正文匹配资源并上传（网络耗时，期间用户可能继续编辑）；
 *   2. 写回阶段：重新读取最新正文，仅对仍然存在的引用应用替换，避免覆盖用户的并发编辑。
 */
export async function processNoteImages(
  ctx: PluginContext,
  settings: ImgbedSettings,
  noteId: string,
  opts: { silent?: boolean } = {},
): Promise<ProcessReport | null> {
  const silent = !!opts.silent;
  const notice = (msg: string): void => {
    if (!silent) ctx.ui.showNotice(msg);
  };

  let note: PluginNote;
  try {
    note = await ctx.notes.get(noteId);
  } catch (e) {
    notice(`读取笔记失败：${errMsg(e)}`);
    return null;
  }
  const noteTitle = note.title ?? noteId;

  // 特殊笔记（图表/表格/海报等）的正文是结构化载荷，不做 Markdown 替换
  if (note.kind && note.kind !== "text") {
    notice(`《${noteTitle}》为 ${note.kind} 类型笔记，暂不支持图片引用替换`);
    return null;
  }

  const doc = await getEditorDoc(ctx);
  const useEditor = !!doc && docNoteId(doc) === noteId;
  const text = useEditor ? docText(doc) : String(note.contentMarkdown ?? "");
  if (!text.trim()) {
    notice(`《${noteTitle}》没有可处理的正文`);
    return null;
  }

  const report = emptyReport(noteId, noteTitle);
  const resources = await listNoteResources(ctx, noteId);
  const classes = parseImageRefs(text).map((ref) => ({
    ref,
    cls: classifyRef(ref, resources, {
      pattern: settings.localRefPattern,
      includeNonImages: settings.includeNonImages,
    }),
  }));

  const matchedResources = new Map<string, PluginResource>();
  for (const { cls } of classes) {
    if (cls.kind === "matched") matchedResources.set(resId(cls.resource), cls.resource);
  }

  if (!matchedResources.size) {
    report.unmatched = classes.filter((c) => c.cls.kind === "unmatched").map((c) => c.ref.target);
    report.nonImages = classes
      .filter((c) => c.cls.kind === "nonimage")
      .map((c) => (c.cls.kind === "nonimage" ? resName(c.cls.resource) || c.ref.target : ""));
    notice(
      report.unmatched.length
        ? `未发现可上传的图片：${report.unmatched.length} 处引用无法匹配到笔记资源`
        : `《${noteTitle}》没有需要上传的本地图片`,
    );
    return report;
  }

  // ---- 上传阶段 ----
  const limit = settings.maxFileSizeMB > 0 ? settings.maxFileSizeMB * 1024 * 1024 : Number.POSITIVE_INFINITY;
  const cache = new Map<string, UploadResult>();
  let records: UploadRecord[] = [];
  try {
    records = await listRecords(ctx);
  } catch {
    records = [];
  }

  for (const [rid, resource] of matchedResources) {
    const existing = records.find((r) => r.noteId === noteId && r.resourceId === rid && r.url);
    if (existing) {
      cache.set(rid, { url: existing.url, src: existing.src, name: existing.fileName, size: existing.size });
      report.reused.push(resName(resource) || rid);
      continue;
    }

    let file: File | null = null;
    try {
      file = await readResourceFile(ctx, resource);
    } catch (e) {
      report.failed.push({ name: resName(resource) || rid, error: `读取资源失败：${errMsg(e)}` });
      continue;
    }
    if (!file) {
      report.failed.push({ name: resName(resource) || rid, error: "资源 ID 缺失，无法读取" });
      continue;
    }
    if (file.size > limit) {
      report.skippedLarge.push(`${file.name}（${formatBytes(file.size)}）`);
      continue;
    }

    try {
      const up = await uploadFile(ctx, settings, file);
      cache.set(rid, up);
      report.uploaded.push({ resourceId: rid, fileName: file.name, url: up.url, size: file.size });
      try {
        await addRecord(ctx, {
          id: `${noteId}_${rid}_${Date.now().toString(36)}`,
          noteId,
          noteTitle,
          resourceId: rid,
          fileName: file.name,
          src: up.src,
          url: up.url,
          size: file.size,
          ts: Date.now(),
        });
      } catch {
        /* 记录失败不影响主流程 */
      }
    } catch (e) {
      report.failed.push({ name: file.name, error: errMsg(e) });
    }
  }

  if (!cache.size) {
    const parts: string[] = [];
    if (report.skippedLarge.length) parts.push(`${report.skippedLarge.length} 个文件超过大小上限`);
    if (report.failed.length) parts.push(`${report.failed.length} 个文件上传失败`);
    notice(`没有成功上传的图片${parts.length ? `（${parts.join("，")}）` : ""}`);
    return report;
  }

  // ---- 写回阶段（基于最新正文，避免覆盖并发编辑） ----
  try {
    const freshDoc = useEditor ? await getEditorDoc(ctx) : null;
    const freshText =
      useEditor && freshDoc && docNoteId(freshDoc) === noteId
        ? docText(freshDoc)
        : String((await ctx.notes.get(noteId)).contentMarkdown ?? "");

    const freshResources = await listNoteResources(ctx, noteId);
    const result = computeReplacements(freshText, freshResources, {
      localRefPattern: settings.localRefPattern,
      markdownTemplate: settings.markdownTemplate,
      includeNonImages: settings.includeNonImages,
      urlFor: (r) => cache.get(resId(r))?.url ?? null,
    });
    report.replaced = result.replaced;
    report.unmatched = result.unmatched;
    report.nonImages = result.nonImages;

    if (result.replaced > 0 && result.newText !== freshText) {
      if (settings.backupBeforeReplace) {
        try {
          report.backupKey = await saveBackup(ctx, noteId, noteTitle, freshText);
        } catch {
          /* 备份失败不阻断替换 */
        }
      }
      await writeNoteMarkdown(ctx, noteId, result.newText, useEditor);
      report.changed = true;

      if (settings.deleteLocalAfterUpload) {
        for (const [rid, resource] of matchedResources) {
          if (!cache.has(rid)) continue;
          const name = resName(resource) || rid;
          try {
            await ctx.resources.delete(rid);
            report.deletedLocal.push(name);
          } catch (e) {
            report.failed.push({ name, error: `删除本地资源失败：${errMsg(e)}` });
            continue;
          }
          if (settings.syncDeleteRemote) {
            try {
              await deleteFile(ctx, settings, cache.get(rid)!.src);
              report.deletedRemote.push(cache.get(rid)!.url);
            } catch (e) {
              report.failed.push({ name, error: `删除图床文件失败：${errMsg(e)}` });
            }
          }
        }
        // 远端已删除的记录不再有效，重新加载最新记录后清理
        if (settings.syncDeleteRemote && report.deletedRemote.length) {
          try {
            const current = await listRecords(ctx);
            const ids = current.filter((r) => r.noteId === noteId && cache.has(r.resourceId)).map((r) => r.id);
            if (ids.length) await removeRecords(ctx, ids);
          } catch {
            /* 忽略 */
          }
        }
      }
    }
  } catch (e) {
    notice(`替换笔记内容失败：${errMsg(e)}`);
    return report;
  }

  // ---- 汇总 ----
  const segs: string[] = [];
  if (report.uploaded.length) segs.push(`新上传 ${report.uploaded.length} 张`);
  if (report.reused.length) segs.push(`复用 ${report.reused.length} 张`);
  if (report.replaced) segs.push(`替换 ${report.replaced} 处引用`);
  if (report.unmatched.length) segs.push(`${report.unmatched.length} 处无法匹配`);
  if (report.nonImages.length) segs.push(`${report.nonImages.length} 个非图片附件已跳过`);
  if (report.skippedLarge.length) segs.push(`${report.skippedLarge.length} 个超过大小上限`);
  if (report.failed.length) segs.push(`${report.failed.length} 个失败`);
  if (report.deletedLocal.length) segs.push(`已删本地资源 ${report.deletedLocal.length} 个`);
  if (report.deletedRemote.length) segs.push(`已删图床文件 ${report.deletedRemote.length} 个`);
  notice(segs.length ? `《${noteTitle}》：${segs.join("，")}` : `《${noteTitle}》无需处理`);

  return report;
}
