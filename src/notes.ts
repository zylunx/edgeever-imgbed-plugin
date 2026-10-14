import { PluginContext, EditorDocument, PluginNoteSummary, PluginResource } from "./types";
import { resId, resName, resType } from "./markdown";

/**
 * 笔记 / 资源 / 编辑器的读写辅助。
 * 对文档未明确的结构（编辑器文档的 id 与 text 字段）采用防御性探测。
 */

export function docText(doc: EditorDocument | null | undefined): string {
  if (!doc) return "";
  return String(doc.text ?? doc.content ?? doc.markdown ?? doc.contentMarkdown ?? "");
}

export function docNoteId(doc: EditorDocument | null | undefined): string | null {
  if (!doc) return null;
  const id = doc.noteId ?? doc.id ?? doc.note?.id;
  return typeof id === "string" && id ? id : null;
}

export async function getEditorDoc(ctx: PluginContext): Promise<EditorDocument | null> {
  try {
    return await ctx.editor.getDocument();
  } catch {
    return null;
  }
}

/** 解析「当前笔记」：优先编辑器打开的笔记，回退到最近更新的笔记。 */
export async function resolveCurrentNoteId(ctx: PluginContext): Promise<string | null> {
  const doc = await getEditorDoc(ctx);
  const id = docNoteId(doc);
  if (id) return id;
  try {
    const res = await ctx.notes.query({ sort: "updated-desc", limit: 1 });
    const first = res?.notes?.[0];
    return first?.id ?? null;
  } catch {
    return null;
  }
}

export async function listNotes(ctx: PluginContext, limit = 100): Promise<PluginNoteSummary[]> {
  try {
    const res = await ctx.notes.query({ sort: "updated-desc", limit });
    return Array.isArray(res?.notes) ? res.notes : [];
  } catch {
    return [];
  }
}

export async function listNoteResources(ctx: PluginContext, noteId: string): Promise<PluginResource[]> {
  try {
    const list = await ctx.resources.list(noteId);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** 读取资源 Blob 并包装为 File（供 FormData 上传）。 */
export async function readResourceFile(ctx: PluginContext, resource: PluginResource): Promise<File | null> {
  const id = resId(resource);
  if (!id) return null;
  const blob = await ctx.resources.read(id);
  const name = resName(resource) || `${id}.bin`;
  const type = resType(resource) || blob.type || "application/octet-stream";
  return new File([blob], name, { type });
}

/**
 * 写回笔记 Markdown。
 * preferEditor 为 true 且编辑器仍打开同一笔记时走 editor.editMarkdown（整篇替换，保留未保存内容所在的实时缓冲区）；
 * 否则走 notes.update。
 */
export async function writeNoteMarkdown(
  ctx: PluginContext,
  noteId: string,
  newText: string,
  preferEditor: boolean,
): Promise<"editor" | "update"> {
  if (preferEditor) {
    const doc = await getEditorDoc(ctx);
    if (doc && docNoteId(doc) === noteId) {
      const cur = docText(doc);
      await ctx.editor.editMarkdown([{ from: 0, to: cur.length, insert: newText }]);
      return "editor";
    }
  }
  await ctx.notes.update(noteId, { contentMarkdown: newText });
  return "update";
}
