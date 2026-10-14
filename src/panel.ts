import { PluginContext, PluginNoteSummary, PluginResource } from "./types";
import { ImgbedSettings, loadSettings, validateSettings } from "./settings";
import { deleteFile, testConnection, uploadFile } from "./imgbed";
import { isImageResource, resId, resName, resType } from "./markdown";
import { docNoteId, getEditorDoc, listNoteResources, listNotes, readResourceFile, writeNoteMarkdown } from "./notes";
import { addRecord, listRecords, removeRecords, UploadRecord } from "./records";
import { BackupEntry, getBackupMarkdown, listBackups, removeBackup } from "./backup";
import { processNoteImages } from "./uploader";
import { errMsg, formatBytes, formatTime, shortId } from "./util";

/**
 * 图床迁移管理面板（宿主渲染容器内的原生 DOM）。
 * 分区：连接状态 / 本地文件直传 / 笔记图片 / 上传记录 / 替换备份。
 */

interface RecentUpload {
  name: string;
  url: string;
  md: string;
}

interface PanelState {
  settings: ImgbedSettings | null;
  settingsError: string | null;
  notes: PluginNoteSummary[];
  selectedNoteId: string;
  resources: PluginResource[];
  records: UploadRecord[];
  backups: BackupEntry[];
  recent: RecentUpload[];
  status: string;
  busy: boolean;
}

function h(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function btn(label: string, onClick: () => void | Promise<void>): HTMLButtonElement {
  const b = h("button", "ee-imgbed-btn", label) as HTMLButtonElement;
  b.type = "button";
  b.addEventListener("click", () => {
    void (async () => {
      b.disabled = true;
      try {
        await onClick();
      } catch (e) {
        // 由各操作自行更新 status；这里兜底防止未捕获异常
        console.error("[imgbed] 操作失败", e);
      } finally {
        b.disabled = false;
      }
    })();
  });
  return b;
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 降级：返回 false，由调用方提示手动复制 */
  }
  return false;
}

export function registerPanel(ctx: PluginContext): () => void {
  return ctx.ui.panels.register({
    id: "imgbed-manager",
    title: "图床迁移",
    purpose: "workflow",
    presentation: "dialog",
    mount(container: HTMLElement, api: { shell: { set(c: Record<string, unknown>): void }; requestClose(): void }) {
      const root = h("div", "ee-imgbed-root");
      const state: PanelState = {
        settings: null,
        settingsError: null,
        notes: [],
        selectedNoteId: "",
        resources: [],
        records: [],
        backups: [],
        recent: [],
        status: "",
        busy: false,
      };

      const setStatus = (msg: string): void => {
        state.status = msg;
      };

      async function refreshAll(): Promise<void> {
        state.settings = await loadSettings(ctx);
        state.settingsError = validateSettings(state.settings);
        state.notes = await listNotes(ctx, 100);
        state.records = await listRecords(ctx);
        state.backups = await listBackups(ctx);
        if (!state.selectedNoteId && state.notes.length) {
          state.selectedNoteId = state.notes[0].id ?? "";
        }
        if (state.selectedNoteId) {
          state.resources = await listNoteResources(ctx, state.selectedNoteId);
        }
      }

      async function reloadRecords(): Promise<void> {
        state.records = await listRecords(ctx);
        state.backups = await listBackups(ctx);
      }

      // ---------- 分区 1：连接状态 ----------
      function renderStatusCard(): HTMLElement {
        const card = h("div", "ee-imgbed-card");
        card.append(h("div", "ee-imgbed-card-title", "连接与配置"));
        const s = state.settings;
        const lines: string[] = [];
        if (s) {
          lines.push(`站点：${s.endpoint || "（未配置）"}`);
          lines.push(
            `鉴权：${s.authMode === "token" ? "API Token" : s.authMode === "authCode" ? "上传认证码" : "无"}`,
          );
          lines.push(
            `自动上传：${s.autoUploadOnSave ? `开（${s.autoUploadScope === "all" ? "所有笔记" : "仅当前笔记"}）` : "关"}`,
          );
          lines.push(`替换后删除本地资源：${s.deleteLocalAfterUpload ? "开" : "关"}`);
          lines.push(`同步删除图床文件：${s.syncDeleteRemote ? "开" : "关"}`);
        }
        for (const line of lines) card.append(h("div", "ee-imgbed-muted", line));
        if (state.settingsError) {
          card.append(h("p", "ee-imgbed-status", `配置不可用：${state.settingsError}`));
        }
        const row = h("div", "ee-imgbed-row");
        row.append(
          btn("测试连接", async () => {
            if (!state.settings) return;
            setStatus("正在测试连接…");
            const r = await testConnection(ctx, state.settings);
            setStatus(r.message);
            render();
          }),
        );
        row.append(
          btn("刷新", async () => {
            await refreshAll();
            setStatus("已刷新");
            render();
          }),
        );
        card.append(row);
        return card;
      }

      // ---------- 分区 2：本地文件直传 ----------
      function renderLocalCard(): HTMLElement {
        const card = h("div", "ee-imgbed-card");
        card.append(h("div", "ee-imgbed-card-title", "上传本地文件（不经过 EdgeEver，直接传到图床）"));
        const input = h("input", "ee-imgbed-input") as HTMLInputElement;
        input.type = "file";
        input.multiple = true;
        const row = h("div", "ee-imgbed-row");
        row.append(input);
        row.append(
          btn("上传并生成链接", async () => {
            const s = state.settings;
            if (!s) return;
            const err = validateSettings(s);
            if (err) {
              setStatus(err);
              render();
              return;
            }
            const files = input.files ? Array.from(input.files) : [];
            if (!files.length) {
              setStatus("请先选择文件");
              render();
              return;
            }
            const limit = s.maxFileSizeMB > 0 ? s.maxFileSizeMB * 1024 * 1024 : Number.POSITIVE_INFINITY;
            for (const f of files) {
              if (f.size > limit) {
                setStatus(`「${f.name}」超过大小上限（${formatBytes(f.size)}），已跳过（未实现分块上传）`);
                continue;
              }
              try {
                const up = await uploadFile(ctx, s, f);
                const md = `![${f.name}](${up.url})`;
                state.recent.unshift({ name: f.name, url: up.url, md });
                try {
                  await addRecord(ctx, {
                    id: `local_${shortId()}`,
                    noteId: "",
                    noteTitle: "本地文件",
                    resourceId: `local:${f.name}:${Date.now().toString(36)}`,
                    fileName: f.name,
                    src: up.src,
                    url: up.url,
                    size: f.size,
                    ts: Date.now(),
                  });
                } catch {
                  /* 忽略 */
                }
                setStatus(`已上传：${f.name}`);
              } catch (e) {
                setStatus(`「${f.name}」上传失败：${errMsg(e)}`);
              }
            }
            input.value = "";
            await reloadRecords();
            render();
          }),
        );
        card.append(row);

        if (state.recent.length) {
          const list = h("div");
          for (const r of state.recent.slice(0, 20)) {
            const line = h("div", "ee-imgbed-row");
            line.append(h("span", "ee-imgbed-url", r.url));
            line.append(
              btn("复制链接", async () => {
                const ok = await copyText(r.url);
                setStatus(ok ? "已复制链接" : "复制失败，请手动复制上方链接");
                render();
              }),
            );
            line.append(
              btn("复制 Markdown", async () => {
                const ok = await copyText(r.md);
                setStatus(ok ? "已复制 Markdown" : "复制失败，请手动复制");
                render();
              }),
            );
            line.append(
              btn("插入到光标", async () => {
                try {
                  await ctx.editor.insertAtCursor(r.md);
                  setStatus("已插入到光标");
                } catch (e) {
                  setStatus(`插入失败：${errMsg(e)}`);
                }
                render();
              }),
            );
            list.append(line);
          }
          card.append(list);
        }
        return card;
      }

      // ---------- 分区 3：笔记图片 ----------
      function renderNotesCard(): HTMLElement {
        const card = h("div", "ee-imgbed-card");
        card.append(h("div", "ee-imgbed-card-title", "笔记图片"));
        const row = h("div", "ee-imgbed-row");
        const select = h("select", "ee-imgbed-select") as HTMLSelectElement;
        for (const n of state.notes) {
          const opt = h("option", undefined, `${n.title ?? n.id}${n.kind && n.kind !== "text" ? `（${n.kind}）` : ""}`) as HTMLOptionElement;
          opt.value = n.id;
          if (n.id === state.selectedNoteId) opt.selected = true;
          select.append(opt);
        }
        row.append(select);
        row.append(
          btn("加载资源", async () => {
            state.selectedNoteId = select.value;
            state.resources = state.selectedNoteId ? await listNoteResources(ctx, state.selectedNoteId) : [];
            setStatus(state.resources.length ? `共 ${state.resources.length} 个资源` : "该笔记没有资源");
            render();
          }),
        );
        row.append(
          btn("上传并替换全部", async () => {
            const s = state.settings;
            if (!s) return;
            const err = validateSettings(s);
            if (err) {
              setStatus(err);
              render();
              return;
            }
            state.selectedNoteId = select.value;
            if (!state.selectedNoteId) {
              setStatus("请先选择笔记");
              render();
              return;
            }
            setStatus("正在处理，请稍候…");
            render();
            await processNoteImages(ctx, s, state.selectedNoteId);
            state.resources = await listNoteResources(ctx, state.selectedNoteId);
            await reloadRecords();
            setStatus("处理完成");
            render();
          }),
        );
        card.append(row);

        if (state.resources.length) {
          const table = h("table", "ee-imgbed-table");
          const thead = h("thead");
          const trh = h("tr");
          for (const t of ["文件", "类型", "大小", "图片", "操作"]) trh.append(h("th", undefined, t));
          thead.append(trh);
          table.append(thead);
          const tbody = h("tbody");
          for (const r of state.resources) {
            const tr = h("tr");
            tr.append(h("td", undefined, resName(r) || resId(r)));
            tr.append(h("td", undefined, resType(r) || "-"));
            tr.append(h("td", undefined, formatBytes(r.size ?? 0)));
            tr.append(h("td", undefined, isImageResource(r) ? "是" : "否"));
            const td = h("td");
            td.append(
              btn("上传", async () => {
                const s = state.settings;
                if (!s) return;
                const err = validateSettings(s);
                if (err) {
                  setStatus(err);
                  render();
                  return;
                }
                setStatus(`正在上传 ${resName(r)}…`);
                try {
                  const file = await readResourceFile(ctx, r);
                  if (!file) throw new Error("资源 ID 缺失");
                  if (file.size > (s.maxFileSizeMB > 0 ? s.maxFileSizeMB * 1024 * 1024 : Number.POSITIVE_INFINITY)) {
                    setStatus(`「${file.name}」超过大小上限，已跳过`);
                    render();
                    return;
                  }
                  const up = await uploadFile(ctx, s, file);
                  state.recent.unshift({ name: file.name, url: up.url, md: `![${file.name}](${up.url})` });
                  try {
                    await addRecord(ctx, {
                      id: `${state.selectedNoteId}_${resId(r)}_${Date.now().toString(36)}`,
                      noteId: state.selectedNoteId,
                      noteTitle: state.notes.find((n) => n.id === state.selectedNoteId)?.title ?? state.selectedNoteId,
                      resourceId: resId(r),
                      fileName: file.name,
                      src: up.src,
                      url: up.url,
                      size: file.size,
                      ts: Date.now(),
                    });
                  } catch {
                    /* 忽略 */
                  }
                  await reloadRecords();
                  setStatus(`已上传：${file.name}`);
                } catch (e) {
                  setStatus(`上传失败：${errMsg(e)}`);
                }
                render();
              }),
            );
            tr.append(td);
            tbody.append(tr);
          }
          table.append(tbody);
          card.append(table);
        } else if (state.selectedNoteId) {
          card.append(h("p", "ee-imgbed-status", "该笔记没有资源，或点击「加载资源」刷新。"));
        }
        return card;
      }

      // ---------- 分区 4：上传记录 ----------
      function renderRecordsCard(): HTMLElement {
        const card = h("div", "ee-imgbed-card");
        card.append(h("div", "ee-imgbed-card-title", `上传记录（${state.records.length}）`));
        if (!state.records.length) {
          card.append(h("p", "ee-imgbed-status", "暂无上传记录。"));
          return card;
        }
        const table = h("table", "ee-imgbed-table");
        const thead = h("thead");
        const trh = h("tr");
        for (const t of ["时间", "来源", "文件", "链接", "操作"]) trh.append(h("th", undefined, t));
        thead.append(trh);
        table.append(thead);
        const tbody = h("tbody");
        for (const rec of state.records.slice(0, 100)) {
          const tr = h("tr");
          tr.append(h("td", undefined, formatTime(rec.ts)));
          tr.append(h("td", undefined, rec.noteTitle || "-"));
          tr.append(h("td", undefined, rec.fileName));
          tr.append(h("td", "ee-imgbed-url", rec.url));
          const td = h("td");
          td.append(
            btn("复制", async () => {
              const ok = await copyText(rec.url);
              setStatus(ok ? "已复制链接" : "复制失败，请手动复制");
              render();
            }),
          );
          td.append(
            btn("删除远端", async () => {
              const s = state.settings;
              if (!s) return;
              if (s.authMode !== "token" || !s.apiToken) {
                setStatus("删除图床文件需要配置具有 delete 权限的 API Token");
                render();
                return;
              }
              try {
                await deleteFile(ctx, s, rec.src);
                await removeRecords(ctx, [rec.id]);
                await reloadRecords();
                setStatus(`已删除图床文件：${rec.fileName}`);
              } catch (e) {
                setStatus(`删除失败：${errMsg(e)}`);
              }
              render();
            }),
          );
          tr.append(td);
          tbody.append(tr);
        }
        table.append(tbody);
        card.append(table);
        return card;
      }

      // ---------- 分区 5：替换备份 ----------
      function renderBackupsCard(): HTMLElement {
        const card = h("div", "ee-imgbed-card");
        card.append(h("div", "ee-imgbed-card-title", `替换备份（${state.backups.length}）`));
        if (!state.backups.length) {
          card.append(h("p", "ee-imgbed-status", "暂无备份。开启设置中的「替换前自动备份笔记原文」后，每次替换都会留存原文。"));
          return card;
        }
        const table = h("table", "ee-imgbed-table");
        const thead = h("thead");
        const trh = h("tr");
        for (const t of ["时间", "笔记", "操作"]) trh.append(h("th", undefined, t));
        thead.append(trh);
        table.append(thead);
        const tbody = h("tbody");
        for (const b of state.backups.slice(0, 50)) {
          const tr = h("tr");
          tr.append(h("td", undefined, formatTime(b.ts)));
          tr.append(h("td", undefined, b.noteTitle || b.noteId));
          const td = h("td");
          td.append(
            btn("恢复", async () => {
              const md = await getBackupMarkdown(ctx, b.key);
              if (md == null) {
                setStatus("备份内容不存在或已损坏");
                render();
                return;
              }
              try {
                const doc = await getEditorDoc(ctx);
                const preferEditor = docNoteId(doc) === b.noteId;
                await writeNoteMarkdown(ctx, b.noteId, md, preferEditor);
                setStatus(`已恢复《${b.noteTitle}》的备份内容`);
              } catch (e) {
                setStatus(`恢复失败：${errMsg(e)}`);
              }
              render();
            }),
          );
          td.append(
            btn("删除", async () => {
              await removeBackup(ctx, b.key);
              await reloadRecords();
              setStatus("已删除备份");
              render();
            }),
          );
          tr.append(td);
          tbody.append(tr);
        }
        table.append(tbody);
        card.append(table);
        return card;
      }

      // ---------- 渲染 ----------
      function render(): void {
        root.replaceChildren();
        root.append(h("p", "ee-imgbed-status", state.status || "就绪"));
        root.append(renderStatusCard());
        root.append(renderLocalCard());
        root.append(renderNotesCard());
        root.append(renderRecordsCard());
        root.append(renderBackupsCard());
      }

      container.append(root);
      try {
        api.shell.set({
          header: {
            title: "图床迁移",
            description: "上传 / 替换 / 记录 / 备份",
            actions: [{ id: "refresh", label: "刷新" }],
          },
          onAction(actionId: string) {
            if (actionId === "refresh") {
              void (async () => {
                await refreshAll();
                setStatus("已刷新");
                render();
              })();
            }
          },
        });
      } catch {
        /* 宿主 shell 结构变化时忽略，面板内容仍可正常渲染 */
      }

      void (async () => {
        try {
          await refreshAll();
          render();
        } catch (e) {
          setStatus(`初始化失败：${errMsg(e)}`);
          render();
        }
      })();

      return () => {
        root.remove();
      };
    },
  });
}
