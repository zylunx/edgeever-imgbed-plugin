import { PluginContext } from "./types";
import { loadSettings } from "./settings";
import { registerCommands } from "./commands";
import { registerPanel } from "./panel";
import { processNoteImages } from "./uploader";
import { docNoteId, getEditorDoc } from "./notes";
import { deleteFile } from "./imgbed";
import { recordsForNote, removeRecords } from "./records";
import { errMsg } from "./util";

/**
 * EdgeEver 图床迁移插件入口。
 *
 * 已实现：
 *  - 手动上传当前笔记图片并替换为 Markdown 外链（命令 / 面板）
 *  - 保存后自动上传替换（note.updated 监听，可开关）
 *  - 本地文件直传图床（面板，不经过 EdgeEver）
 *  - 上传记录、替换备份与恢复
 *  - 删除本地资源时同步删除图床文件（需 delete 权限 Token）
 *
 * 未实现（受插件 API 能力限制，详见 未实现功能说明.md）：
 *  - 拦截图片插入/粘贴/拖拽，直接上传到图床而不经过 EdgeEver 服务器
 *  - 实时监听编辑器图片插入
 *  - 读取剪贴板图片
 *  - 大文件分块上传
 */
export default {
  activate(context: PluginContext): () => void {
    const ctx = context;
    const disposers: Array<() => void> = [];

    disposers.push(registerCommands(ctx));
    disposers.push(registerPanel(ctx));

    // ---- 保存后自动上传 ----
    // 注意：这是「事后处理」——图片已经先存入 EdgeEver，保存后才被替换为外链。
    // 插件 API 没有提供上传前拦截能力，无法做到「不经过中间服务器」。
    const processing = new Set<string>();
    disposers.push(
      ctx.events.on("note.updated", async (payload: unknown) => {
        let settings;
        try {
          settings = await loadSettings(ctx);
        } catch {
          return;
        }
        if (!settings.autoUploadOnSave) return;

        const p = payload as { note?: { id?: string }; noteId?: string; id?: string };
        const noteId = p?.note?.id ?? p?.noteId ?? p?.id;
        if (!noteId) return;

        if (settings.autoUploadScope === "current") {
          const doc = await getEditorDoc(ctx);
          if (docNoteId(doc) !== noteId) return;
        }
        if (processing.has(noteId)) return;

        processing.add(noteId);
        try {
          await processNoteImages(ctx, settings, noteId, { silent: true });
        } catch (e) {
          ctx.ui.showNotice(`自动上传失败：${errMsg(e)}`);
        } finally {
          processing.delete(noteId);
        }
      }),
    );

    // ---- 笔记删除后清理图床文件（需开启同步删除） ----
    disposers.push(
      ctx.events.on("note.deleted", async (payload: unknown) => {
        try {
          const p = payload as { note?: { id?: string }; noteId?: string; id?: string };
          const noteId = p?.note?.id ?? p?.noteId ?? p?.id;
          if (!noteId) return;

          const settings = await loadSettings(ctx);
          if (!settings.syncDeleteRemote) return;
          if (settings.authMode !== "token" || !settings.apiToken) return;

          const recs = await recordsForNote(ctx, noteId);
          if (!recs.length) return;

          const failed: string[] = [];
          const okIds: string[] = [];
          for (const r of recs) {
            try {
              await deleteFile(ctx, settings, r.src);
              okIds.push(r.id);
            } catch {
              failed.push(r.fileName);
            }
          }
          if (okIds.length) await removeRecords(ctx, okIds);
          if (failed.length) {
            ctx.ui.showNotice(`笔记已删除，但有 ${failed.length} 个图床文件删除失败`);
          }
        } catch {
          /* 静默失败，不打扰用户 */
        }
      }),
    );

    return () => {
      for (const d of disposers) {
        try {
          d();
        } catch {
          /* 忽略单个清理失败 */
        }
      }
    };
  },
};
