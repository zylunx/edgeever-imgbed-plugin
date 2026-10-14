/**
 * 冒烟测试：用 Mock 宿主环境验证 main.js 的核心行为。
 * 运行：node test/smoke.mjs
 */
import assert from "node:assert/strict";
import { createMockContext, DEFAULT_MARKDOWN } from "./mock.mjs";

const plugin = (await import("../main.js")).default;

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// ---------- 1. 手动上传 + 替换（编辑器路径） ----------
test("手动上传当前笔记图片并替换为 Markdown 外链", async () => {
  const { ctx, state } = createMockContext();
  const dispose = plugin.activate(ctx);
  try {
    await state.runCommand("imgbed-upload-current-note");

    assert.equal(state.fetchCalls.length, 2, "应发生 2 次上传请求（PDF 被跳过）");
    const first = state.fetchCalls[0];
    assert.ok(first.url.startsWith("https://img.test.com/upload?"), `上传 URL 不正确: ${first.url}`);
    assert.ok(first.url.includes("returnFormat=full"), "应使用完整链接返回格式");
    assert.ok(first.url.includes("uploadFolder=edgeever"), "应携带上传目录");
    assert.equal(first.options.method, "POST");
    assert.equal(first.options.headers.Authorization, "Bearer imgbed_test_token", "Token 鉴权头");
    const file = first.options.body.get("file");
    assert.ok(file, "FormData 应包含 file");
    assert.equal(file.name, "sunrise.png");

    assert.equal(state.editorEdits.length, 1, "应通过编辑器整篇替换");
    const text = state.editorDoc.text;
    assert.ok(text.includes("![本地图](https://img.test.com/file/sunrise.png)"), "本地图引用应被替换");
    assert.ok(text.includes("![相册](https://img.test.com/file/photo%20test.png)"), "相册引用应被替换");
    assert.ok(text.includes("![文档](res_ghi789)"), "非图片附件引用应保持不变");
    assert.ok(text.includes("![外链](https://example.com/a.png)"), "外链应保持不变");
    assert.ok(text.includes("![数据](data:image/png;base64,AAAA)"), "data URI 应保持不变");
    assert.ok(text.includes("![孤儿](ghost.png)"), "无法匹配的引用应保持不变");

    const index = state.storage.get("imgbed:backup:index");
    assert.equal(index?.length, 1, "应生成 1 条备份索引");
    const backupMd = state.storage.get("imgbed:backup:item:" + index[0].key);
    assert.ok(backupMd.includes("edgeever://res_abc123"), "备份内容应为替换前的原文");

    assert.ok(state.notices.some((n) => n.includes("替换 2 处引用")), `汇总通知应包含替换数量: ${state.notices}`);
  } finally {
    dispose();
  }
});

// ---------- 2. 自动上传开关：关闭时不动作 ----------
test("自动上传关闭时，note.updated 不触发任何处理", async () => {
  const { ctx, state } = createMockContext();
  const dispose = plugin.activate(ctx);
  try {
    await state.emit("note.updated", { note: { id: "note-1" } });
    assert.equal(state.fetchCalls.length, 0);
    assert.equal(state.editorEdits.length, 0);
  } finally {
    dispose();
  }
});

// ---------- 3. 自动上传开启：处理后不循环 ----------
test("自动上传开启时处理当前笔记，且替换后不重复上传", async () => {
  const { ctx, state } = createMockContext({ settings: { autoUploadOnSave: true } });
  const dispose = plugin.activate(ctx);
  try {
    await state.emit("note.updated", { note: { id: "note-1" } });
    assert.equal(state.fetchCalls.length, 2, "自动上传应处理 2 张图片");
    assert.equal(state.editorEdits.length, 1);
    assert.ok(state.editorDoc.text.includes("https://img.test.com/file/sunrise.png"));

    await state.emit("note.updated", { note: { id: "note-1" } });
    assert.equal(state.fetchCalls.length, 2, "替换后再次保存不应重复上传（防循环）");
  } finally {
    dispose();
  }
});

// ---------- 4. 自动上传范围：仅当前笔记 ----------
test("自动上传范围为「仅当前笔记」时，其他笔记的更新被忽略", async () => {
  const { ctx, state } = createMockContext({ settings: { autoUploadOnSave: true } });
  const dispose = plugin.activate(ctx);
  try {
    await state.emit("note.updated", { note: { id: "other-note" } });
    assert.equal(state.fetchCalls.length, 0, "非当前编辑的笔记不应触发");
  } finally {
    dispose();
  }
});

// ---------- 5. 自动上传范围：所有笔记（无编辑器时走 notes.update） ----------
test("自动上传范围为「所有笔记」时处理非当前编辑器笔记", async () => {
  const { ctx, state } = createMockContext({
    settings: { autoUploadOnSave: true, autoUploadScope: "all" },
    editorDoc: { noteId: "note-2", text: "# 其他笔记" },
  });
  const dispose = plugin.activate(ctx);
  try {
    await state.emit("note.updated", { note: { id: "note-1" } });
    assert.equal(state.fetchCalls.length, 2);
    assert.equal(state.editorEdits.length, 0, "编辑器打开的是其他笔记，不应走编辑器写入");
    assert.equal(state.noteUpdates.length, 1, "应走 notes.update");
    assert.ok(state.noteUpdates[0].patch.contentMarkdown.includes("https://img.test.com/file/sunrise.png"));
  } finally {
    dispose();
  }
});

// ---------- 6. 无编辑器时走 notes.update ----------
test("没有打开的编辑器时，通过 notes.update 写回", async () => {
  const { ctx, state } = createMockContext({ editorDoc: null });
  const dispose = plugin.activate(ctx);
  try {
    await state.runCommand("imgbed-upload-current-note");
    assert.equal(state.noteUpdates.length, 1);
    assert.equal(state.editorEdits.length, 0);
    assert.ok(state.noteUpdates[0].patch.contentMarkdown.includes("![本地图](https://img.test.com/file/sunrise.png)"));
  } finally {
    dispose();
  }
});

// ---------- 7. 删除本地资源 + 同步删除图床文件 ----------
test("开启后删除本地资源并同步删除图床文件，记录被清理", async () => {
  const { ctx, state } = createMockContext({
    settings: { deleteLocalAfterUpload: true, syncDeleteRemote: true },
  });
  const dispose = plugin.activate(ctx);
  try {
    await state.runCommand("imgbed-upload-current-note");
    assert.deepEqual(
      [...state.resourceDeletes].sort(),
      ["res_abc123", "res_def456"],
      "应删除两个本地资源",
    );
    const deleteCalls = state.fetchCalls.filter((c) => c.url.includes("/api/manage/delete/"));
    assert.equal(deleteCalls.length, 2, "应同步删除 2 个图床文件");
    assert.ok(deleteCalls.some((c) => c.url.includes("/api/manage/delete/sunrise.png")), "删除路径应正确（去掉 /file/ 前缀）");
    const records = state.storage.get("imgbed:records") ?? [];
    assert.equal(records.length, 0, "同步删除后上传记录应被清理");
  } finally {
    dispose();
  }
});

// ---------- 8. 大小上限 ----------
test("超过大小上限的文件被跳过且不上传", async () => {
  const { ctx, state } = createMockContext({ settings: { maxFileSizeMB: 0.001 } });
  const dispose = plugin.activate(ctx);
  try {
    await state.runCommand("imgbed-upload-current-note");
    assert.equal(state.fetchCalls.length, 0, "超过上限不应发起上传");
    assert.equal(state.editorEdits.length, 0);
    assert.ok(state.notices.some((n) => n.includes("超过大小上限")), "应提示超过大小上限");
  } finally {
    dispose();
  }
});

// ---------- 9. 自定义 Markdown 模板 ----------
test("自定义 Markdown 链接模板生效", async () => {
  const { ctx, state } = createMockContext({
    settings: { markdownTemplate: '![{alt}]({url} "edgeever")' },
  });
  const dispose = plugin.activate(ctx);
  try {
    await state.runCommand("imgbed-upload-current-note");
    assert.ok(
      state.editorDoc.text.includes('![本地图](https://img.test.com/file/sunrise.png "edgeever")'),
      "应使用自定义模板",
    );
  } finally {
    dispose();
  }
});

// ---------- 10. 认证码鉴权 ----------
test("认证码鉴权时使用 authCode 查询参数且不带 Token 头", async () => {
  const { ctx, state } = createMockContext({
    settings: { authMode: "authCode", authCode: "my_code_123" },
  });
  const dispose = plugin.activate(ctx);
  try {
    await state.runCommand("imgbed-upload-current-note");
    const first = state.fetchCalls[0];
    assert.ok(first.url.includes("authCode=my_code_123"), "URL 应包含认证码");
    assert.ok(!first.options.headers.Authorization, "不应携带 Token 头");
  } finally {
    dispose();
  }
});

// ---------- 11. 上传失败 ----------
test("上传失败时不替换正文并提示失败", async () => {
  const { ctx, state } = createMockContext({
    fetchImpl: async () =>
      ({ ok: false, status: 401, text: async () => JSON.stringify({ error: "Unauthorized" }) }),
  });
  const dispose = plugin.activate(ctx);
  try {
    await state.runCommand("imgbed-upload-current-note");
    assert.equal(state.editorEdits.length, 0, "上传失败不应替换正文");
    assert.ok(state.notices.some((n) => n.includes("失败")), `应提示失败: ${state.notices}`);
  } finally {
    dispose();
  }
});

// ---------- 12. publicUrl 优先 ----------
test("图床返回 publicUrl 时优先使用", async () => {
  const { ctx, state } = createMockContext({
    fetchImpl: async (url, options) => {
      const u = new URL(url);
      if (u.pathname.endsWith("/upload")) {
        const file = options.body?.get?.("file");
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify([{ src: "/file/whatever.png", publicUrl: `https://cdn.test.com/${file.name}` }]),
        };
      }
      return { ok: true, status: 200, text: async () => "OK" };
    },
  });
  const dispose = plugin.activate(ctx);
  try {
    await state.runCommand("imgbed-upload-current-note");
    assert.ok(state.editorDoc.text.includes("![本地图](https://cdn.test.com/sunrise.png)"), "应使用 publicUrl");
  } finally {
    dispose();
  }
});

// ---------- 13. 恢复备份 ----------
test("恢复命令还原替换前的内容", async () => {
  const { ctx, state } = createMockContext();
  const dispose = plugin.activate(ctx);
  try {
    await state.runCommand("imgbed-upload-current-note");
    assert.equal(state.editorEdits.length, 1);
    await state.runCommand("imgbed-restore-backup");
    assert.equal(state.editorEdits.length, 2, "恢复应再次写回编辑器");
    assert.ok(state.editorDoc.text.includes("edgeever://res_abc123"), "恢复后应包含原始引用");
    assert.ok(!state.editorDoc.text.includes("img.test.com"), "恢复后不应再包含图床链接");
  } finally {
    dispose();
  }
});

// ---------- 14. 配置校验 ----------
test("未配置图床地址时给出提示且不发起请求", async () => {
  const { ctx, state } = createMockContext({ settings: { endpoint: "" } });
  const dispose = plugin.activate(ctx);
  try {
    await state.runCommand("imgbed-upload-current-note");
    assert.equal(state.fetchCalls.length, 0);
    assert.ok(state.notices.some((n) => n.includes("图床站点地址")));
  } finally {
    dispose();
  }
});

// ---------- 15. 自定义本地引用识别规则 ----------
test("自定义 localRefPattern 后仅匹配的引用被处理", async () => {
  const { ctx, state } = createMockContext({ settings: { localRefPattern: "^edgeever://" } });
  const dispose = plugin.activate(ctx);
  try {
    await state.runCommand("imgbed-upload-current-note");
    assert.equal(state.fetchCalls.length, 1, "仅匹配正则的引用应被上传");
    const text = state.editorDoc.text;
    assert.ok(text.includes("![本地图](https://img.test.com/file/sunrise.png)"), "匹配的引用应被替换");
    assert.ok(text.includes("![相册](img/photo%20test.png)"), "不匹配正则的引用应保持原样");
  } finally {
    dispose();
  }
});

// ---------- 16. 上传记录复用 ----------
test("已有上传记录的资源复用链接，不重复上传", async () => {
  const { ctx, state } = createMockContext();
  const dispose = plugin.activate(ctx);
  try {
    await state.runCommand("imgbed-upload-current-note");
    assert.equal(state.fetchCalls.length, 2);
    // 模拟用户恢复原文后再次处理
    state.editorDoc.text = DEFAULT_MARKDOWN;
    state.note.contentMarkdown = DEFAULT_MARKDOWN;
    await state.runCommand("imgbed-upload-current-note");
    assert.equal(state.fetchCalls.length, 2, "已有记录的图片应复用链接，不重复上传");
    assert.ok(state.notices.some((n) => n.includes("复用 2")), `应提示复用: ${state.notices}`);
  } finally {
    dispose();
  }
});

// ---------- 17. 非图片附件开关 ----------
test("开启 includeNonImages 后上传 PDF 附件", async () => {
  const { ctx, state } = createMockContext({ settings: { includeNonImages: true } });
  const dispose = plugin.activate(ctx);
  try {
    await state.runCommand("imgbed-upload-current-note");
    assert.equal(state.fetchCalls.length, 3, "开启后应上传 PDF 附件");
    assert.ok(state.editorDoc.text.includes("![文档](https://img.test.com/file/doc.pdf)"));
  } finally {
    dispose();
  }
});

// ---------- 18. 清理函数 ----------
test("activate 返回的清理函数能注销命令与面板", async () => {
  const { ctx, state } = createMockContext();
  const dispose = plugin.activate(ctx);
  assert.equal(state.commands.size, 3, "应注册 3 个命令");
  assert.equal(state.panels.size, 1, "应注册 1 个面板");
  dispose();
  assert.equal(state.commands.size, 0);
  assert.equal(state.panels.size, 0);
});

// ---------- 19. 面板可打开 ----------
test("面板命令可以打开已注册的面板", async () => {
  const { ctx, state } = createMockContext();
  const dispose = plugin.activate(ctx);
  try {
    await state.runCommand("imgbed-open-panel");
    assert.ok(true, "打开面板不应抛错");
  } finally {
    dispose();
  }
});

// ---------- 20. 笔记删除事件 + 同步删除 ----------
test("笔记删除后在开启同步删除时清理远端文件", async () => {
  const { ctx, state } = createMockContext();
  const dispose = plugin.activate(ctx);
  try {
    await state.runCommand("imgbed-upload-current-note");
    const before = state.fetchCalls.length;
    await state.emit("note.deleted", { noteId: "note-1" });
    // 默认 syncDeleteRemote=false，不应删除
    assert.equal(state.fetchCalls.length, before, "默认关闭时笔记删除不触发远端删除");

    // 开启后再来一次
    state.settings.syncDeleteRemote = true;
    await state.emit("note.deleted", { noteId: "note-1" });
    const deleteCalls = state.fetchCalls.filter((c) => c.url.includes("/api/manage/delete/"));
    assert.equal(deleteCalls.length, 2, "开启后应删除该笔记上传过的 2 个图床文件");
  } finally {
    dispose();
  }
});

// ---------- 运行 ----------
let passed = 0;
let failed = 0;
for (const t of tests) {
  try {
    await t.fn();
    passed++;
    console.log(`  ok  ${t.name}`);
  } catch (e) {
    failed++;
    console.error(`FAIL  ${t.name}`);
    console.error(`      ${e?.message ?? e}`);
  }
}
console.log(`\n${passed} passed, ${failed} failed, ${tests.length} total`);
if (failed > 0) process.exit(1);
