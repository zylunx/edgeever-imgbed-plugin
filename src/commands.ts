import { PluginContext } from "./types";
import { loadSettings, validateSettings } from "./settings";
import { processNoteImages } from "./uploader";
import { resolveCurrentNoteId } from "./notes";
import { getBackupMarkdown, latestBackupForNote } from "./backup";
import { docNoteId, getEditorDoc, writeNoteMarkdown } from "./notes";
import { errMsg } from "./util";

/** 注册全局命令。返回统一的清理函数。 */
export function registerCommands(ctx: PluginContext): () => void {
  const disposers: Array<() => void> = [];

  disposers.push(
    ctx.commands.register({
      id: "imgbed-upload-current-note",
      title: "上传当前笔记图片到图床",
      listed: true,
      menu: true,
      run: async () => {
        const settings = await loadSettings(ctx);
        const err = validateSettings(settings);
        if (err) {
          ctx.ui.showNotice(err);
          return;
        }
        const noteId = await resolveCurrentNoteId(ctx);
        if (!noteId) {
          ctx.ui.showNotice("未找到当前笔记，请先打开一篇笔记");
          return;
        }
        await processNoteImages(ctx, settings, noteId);
      },
    }),
  );

  disposers.push(
    ctx.commands.register({
      id: "imgbed-open-panel",
      title: "打开图床迁移面板",
      listed: true,
      menu: true,
      run: async () => {
        try {
          await ctx.ui.panels.open("imgbed-manager");
        } catch (e) {
          ctx.ui.showNotice(`打开面板失败：${errMsg(e)}`);
        }
      },
    }),
  );

  disposers.push(
    ctx.commands.register({
      id: "imgbed-restore-backup",
      title: "恢复当前笔记替换前的内容",
      listed: true,
      menu: true,
      run: async () => {
        const noteId = await resolveCurrentNoteId(ctx);
        if (!noteId) {
          ctx.ui.showNotice("未找到当前笔记，请先打开一篇笔记");
          return;
        }
        const entry = await latestBackupForNote(ctx, noteId);
        if (!entry) {
          ctx.ui.showNotice("当前笔记没有替换备份");
          return;
        }
        const md = await getBackupMarkdown(ctx, entry.key);
        if (md == null) {
          ctx.ui.showNotice("备份内容不存在或已损坏");
          return;
        }
        try {
          const doc = await getEditorDoc(ctx);
          const preferEditor = docNoteId(doc) === noteId;
          await writeNoteMarkdown(ctx, noteId, md, preferEditor);
          ctx.ui.showNotice("已恢复替换前的内容");
        } catch (e) {
          ctx.ui.showNotice(`恢复失败：${errMsg(e)}`);
        }
      },
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
}
