/**
 * Mock 的 EdgeEver 插件宿主环境，用于在 Node 中冒烟测试 main.js。
 * 模拟 notes / resources / editor / ui / commands / settings / storage / network / events。
 */

export const DEFAULT_SETTINGS = {
  endpoint: "https://img.test.com",
  "auth-mode": "token",
  "api-token": "imgbed_test_token",
  "auth-code": "",
  "return-format": "full",
  "upload-channel": "",
  "channel-name": "",
  "upload-name-type": "default",
  "upload-folder": "edgeever",
  "server-compress": true,
  "auto-upload-on-save": false,
  "auto-upload-scope": "current",
  "delete-local-after-upload": false,
  "sync-delete-remote": false,
  "backup-before-replace": true,
  "local-ref-pattern": "",
  "markdown-template": "![{alt}]({url})",
  "max-file-size-mb": 20,
  "include-non-images": false,
};

export const DEFAULT_MARKDOWN = [
  "# 测试笔记",
  "",
  "![本地图](edgeever://res_abc123)",
  "",
  "![相册](img/photo%20test.png)",
  "",
  "![文档](res_ghi789)",
  "",
  "![外链](https://example.com/a.png)",
  "",
  "![数据](data:image/png;base64,AAAA)",
  "",
  "![孤儿](ghost.png)",
  "",
].join("\n");

export const DEFAULT_RESOURCES = [
  { id: "res_abc123", name: "sunrise.png", type: "image/png", size: 2048 },
  { id: "res_def456", name: "photo test.png", type: "image/png", size: 4096 },
  { id: "res_ghi789", name: "doc.pdf", type: "application/pdf", size: 100 },
];

function clone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

function makeResponse(status, obj) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof obj === "string" ? obj : JSON.stringify(obj)),
  };
}

/**
 * @param {object} [opts]
 * @param {object} [opts.settings] 覆盖默认设置
 * @param {object} [opts.note] 覆盖默认笔记
 * @param {object|null} [opts.editorDoc] 覆盖编辑器文档（null 表示无编辑器）
 * @param {Array} [opts.resources] 覆盖资源列表
 * @param {Function} [opts.fetchImpl] 自定义 network.fetch 实现
 */
export function createMockContext(opts = {}) {
  const state = {
    notices: [],
    fetchCalls: [],
    editorEdits: [],
    insertCalls: [],
    resourceDeletes: [],
    noteUpdates: [],
    commands: new Map(),
    panels: new Map(),
    events: new Map(),
    storage: new Map(),
    settings: { ...DEFAULT_SETTINGS, ...(opts.settings ?? {}) },
    note: {
      id: "note-1",
      title: "测试笔记",
      kind: "text",
      revision: 3,
      contentHash: "hash-3",
      contentMarkdown: DEFAULT_MARKDOWN,
      ...(opts.note ?? {}),
    },
    editorDoc:
      opts.editorDoc === undefined
        ? { noteId: "note-1", text: DEFAULT_MARKDOWN }
        : opts.editorDoc
          ? { ...opts.editorDoc }
          : null,
    resources: (opts.resources ?? DEFAULT_RESOURCES).map((r) => ({ ...r })),
    fetchImpl: opts.fetchImpl,
  };

  const ctx = {
    notes: {
      async query(q = {}) {
        const notes = [
          { id: state.note.id, title: state.note.title, kind: state.note.kind },
        ];
        if (q.sort === "updated-desc" || !q.sort) return { notes, totalCount: 1, nextOffset: null };
        return { notes, totalCount: 1, nextOffset: null };
      },
      async queryContent() {
        return { notes: [clone(state.note)] };
      },
      async get() {
        return clone(state.note);
      },
      async update(id, patch) {
        state.noteUpdates.push({ id, patch });
        if (typeof patch.contentMarkdown === "string") {
          state.note.contentMarkdown = patch.contentMarkdown;
        }
        return {};
      },
      async editMarkdown() {
        throw new Error("notes.editMarkdown 未在测试中使用");
      },
    },

    resources: {
      async list() {
        return state.resources.map((r) => ({ ...r }));
      },
      async read(resourceId) {
        const r = state.resources.find((x) => x.id === resourceId);
        if (!r) throw new Error(`资源不存在: ${resourceId}`);
        return new Blob([new Uint8Array(r.size ?? 8)], { type: r.type });
      },
      async upload() {
        throw new Error("resources.upload 未在测试中使用");
      },
      async update() {
        throw new Error("resources.update 未在测试中使用");
      },
      async rename() {
        throw new Error("resources.rename 未在测试中使用");
      },
      async delete(resourceId) {
        state.resourceDeletes.push(resourceId);
        state.resources = state.resources.filter((r) => r.id !== resourceId);
        return {};
      },
    },

    editor: {
      async getSelection() {
        return null;
      },
      async replaceSelection() {},
      async insertAtCursor(text) {
        state.insertCalls.push(text);
      },
      async getDocument() {
        return state.editorDoc ? { ...state.editorDoc } : null;
      },
      async editMarkdown(edits) {
        state.editorEdits.push(edits);
        const doc = state.editorDoc;
        if (!doc) throw new Error("没有打开的编辑器");
        let text = doc.text;
        const sorted = [...edits].sort((a, b) => b.from - a.from);
        for (const e of sorted) {
          text = text.slice(0, e.from) + e.insert + text.slice(e.to);
        }
        doc.text = text;
        return {};
      },
      async insertEmbed() {},
    },

    ui: {
      showNotice(msg) {
        state.notices.push(String(msg));
      },
      async openNote() {},
      panels: {
        register(def) {
          state.panels.set(def.id, def);
          return () => state.panels.delete(def.id);
        },
        async open(id) {
          if (!state.panels.has(id)) throw new Error(`面板不存在: ${id}`);
          return {};
        },
      },
    },

    commands: {
      register(def) {
        state.commands.set(def.id, def);
        return () => state.commands.delete(def.id);
      },
    },

    settings: {
      async get(key) {
        return state.settings[key];
      },
      async set(key, value) {
        state.settings[key] = value;
      },
      async remove(key) {
        delete state.settings[key];
      },
    },

    storage: {
      async get(key) {
        return state.storage.has(key) ? clone(state.storage.get(key)) : undefined;
      },
      async set(key, value) {
        state.storage.set(key, clone(value));
      },
      async remove(key) {
        state.storage.delete(key);
      },
    },

    secrets: {
      async get() {
        return undefined;
      },
      async set() {},
      async remove() {},
    },

    network: {
      async fetch(url, options = {}) {
        state.fetchCalls.push({ url, options });
        if (state.fetchImpl) return state.fetchImpl(url, options);

        const u = new URL(url);
        if (u.pathname.endsWith("/api/manage/delete/") || u.pathname.startsWith("/api/manage/delete")) {
          return makeResponse(200, { success: true, fileId: u.pathname });
        }
        if (u.pathname.endsWith("/upload")) {
          const file = options.body?.get?.("file");
          const name = file?.name ?? "file.bin";
          return makeResponse(200, [{ src: `/file/${encodeURIComponent(name)}`, publicUrl: "" }]);
        }
        // 测试连接等
        return makeResponse(200, "OK");
      },
    },

    events: {
      on(event, handler) {
        if (!state.events.has(event)) state.events.set(event, []);
        state.events.get(event).push(handler);
        return () => {
          const arr = state.events.get(event) ?? [];
          const idx = arr.indexOf(handler);
          if (idx >= 0) arr.splice(idx, 1);
        };
      },
    },
  };

  state.emit = async (event, payload) => {
    const handlers = state.events.get(event) ?? [];
    for (const fn of handlers) await fn(payload);
  };

  state.runCommand = async (id) => {
    const def = state.commands.get(id);
    if (!def) throw new Error(`命令未注册: ${id}`);
    await def.run();
  };

  return { ctx, state };
}
