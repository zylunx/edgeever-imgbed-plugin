// src/settings.ts
var SETTINGS_DEFAULTS = {
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
  includeNonImages: false
};
function asString(v, dflt) {
  if (typeof v === "string") return v;
  if (v == null) return dflt;
  return String(v);
}
function asBool(v, dflt) {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v === "true" || v === "1";
  if (typeof v === "number") return v !== 0;
  return dflt;
}
function asNumber(v, dflt) {
  const n = typeof v === "number" ? v : Number.parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : dflt;
}
function normalizeChannel(v) {
  return v && v !== "default" ? v : "";
}
async function loadSettings(ctx) {
  const get = async (key) => {
    try {
      return await ctx.settings.get(key);
    } catch {
      return void 0;
    }
  };
  const authModeRaw = asString(await get("auth-mode"), SETTINGS_DEFAULTS.authMode);
  const returnFormatRaw = asString(await get("return-format"), SETTINGS_DEFAULTS.returnFormat);
  const scopeRaw = asString(await get("auto-upload-scope"), SETTINGS_DEFAULTS.autoUploadScope);
  return {
    endpoint: asString(await get("endpoint"), "").trim().replace(/\/+$/, ""),
    authMode: authModeRaw === "authCode" || authModeRaw === "none" ? authModeRaw : "token",
    apiToken: asString(await get("api-token"), "").trim(),
    authCode: asString(await get("auth-code"), "").trim(),
    returnFormat: returnFormatRaw === "default" ? "default" : "full",
    uploadChannel: normalizeChannel(asString(await get("upload-channel"), "default").trim()),
    channelName: asString(await get("channel-name"), "").trim(),
    uploadNameType: asString(await get("upload-name-type"), SETTINGS_DEFAULTS.uploadNameType).trim(),
    uploadFolder: asString(await get("upload-folder"), SETTINGS_DEFAULTS.uploadFolder).trim(),
    serverCompress: asBool(await get("server-compress"), SETTINGS_DEFAULTS.serverCompress),
    autoUploadOnSave: asBool(await get("auto-upload-on-save"), SETTINGS_DEFAULTS.autoUploadOnSave),
    autoUploadScope: scopeRaw === "all" ? "all" : "current",
    deleteLocalAfterUpload: asBool(await get("delete-local-after-upload"), SETTINGS_DEFAULTS.deleteLocalAfterUpload),
    syncDeleteRemote: asBool(await get("sync-delete-remote"), SETTINGS_DEFAULTS.syncDeleteRemote),
    backupBeforeReplace: asBool(await get("backup-before-replace"), SETTINGS_DEFAULTS.backupBeforeReplace),
    localRefPattern: asString(await get("local-ref-pattern"), "").trim(),
    markdownTemplate: asString(await get("markdown-template"), SETTINGS_DEFAULTS.markdownTemplate),
    maxFileSizeMB: asNumber(await get("max-file-size-mb"), SETTINGS_DEFAULTS.maxFileSizeMB),
    includeNonImages: asBool(await get("include-non-images"), SETTINGS_DEFAULTS.includeNonImages)
  };
}
function validateSettings(s) {
  if (!s.endpoint) return "\u8BF7\u5148\u5728\u63D2\u4EF6\u8BBE\u7F6E\u4E2D\u914D\u7F6E\u300C\u56FE\u5E8A\u7AD9\u70B9\u5730\u5740\u300D";
  if (!/^https?:\/\//i.test(s.endpoint)) return "\u56FE\u5E8A\u7AD9\u70B9\u5730\u5740\u5FC5\u987B\u4EE5 http:// \u6216 https:// \u5F00\u5934";
  if (s.authMode === "token" && !s.apiToken) return "\u9274\u6743\u65B9\u5F0F\u4E3A API Token\uFF0C\u4F46\u672A\u586B\u5199 Token";
  if (s.authMode === "authCode" && !s.authCode) return "\u9274\u6743\u65B9\u5F0F\u4E3A\u4E0A\u4F20\u8BA4\u8BC1\u7801\uFF0C\u4F46\u672A\u586B\u5199\u8BA4\u8BC1\u7801";
  return null;
}

// src/markdown.ts
var INLINE_RE = /!\[([^\]]*)\]\(\s*(<[^<>]*>|[^()]+?)\s*(?:(?:"[^"]*"|'[^']*')\s*)?\)/g;
var WIKI_RE = /!\[\[([^\[\]]+)\]\]/g;
function parseImageRefs(markdown) {
  const refs = [];
  let m;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(markdown)) !== null) {
    const rawTarget = (m[2] ?? "").trim();
    const target = rawTarget.startsWith("<") && rawTarget.endsWith(">") ? rawTarget.slice(1, -1).trim() : rawTarget;
    refs.push({
      alt: m[1] ?? "",
      target,
      full: m[0],
      start: m.index,
      end: m.index + m[0].length
    });
  }
  WIKI_RE.lastIndex = 0;
  while ((m = WIKI_RE.exec(markdown)) !== null) {
    const target = (m[1] ?? "").trim();
    refs.push({ alt: target, target, full: m[0], start: m.index, end: m.index + m[0].length });
  }
  refs.sort((a, b) => a.start - b.start);
  return refs;
}
function isDataUri(t) {
  return /^data:/i.test(t.trim());
}
function isAbsoluteHttp(t) {
  return /^(https?:)?\/\//i.test(t.trim());
}
function safeDecodeURIComponent(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
function basename(p) {
  const s = p.replace(/[\\/]+$/, "");
  const idx = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
  return idx >= 0 ? s.slice(idx + 1) : s;
}
function resId(r) {
  if (!r) return "";
  return String(r.id ?? r.resourceId ?? "");
}
function resName(r) {
  if (!r) return "";
  return String(r.name ?? r.filename ?? r.fileName ?? "");
}
function resType(r) {
  if (!r) return "";
  return String(r.type ?? r.mimeType ?? r.fileType ?? "");
}
var IMAGE_EXTS = /* @__PURE__ */ new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "svg",
  "avif",
  "ico",
  "tif",
  "tiff",
  "heic",
  "heif"
]);
function isImageResource(r) {
  if (resType(r).toLowerCase().startsWith("image/")) return true;
  const ext = resName(r).split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTS.has(ext);
}
function matchResource(target, resources) {
  const t = target.trim();
  if (!t) return null;
  const decoded = safeDecodeURIComponent(t);
  const base2 = basename(decoded);
  for (const r of resources) {
    const id = resId(r);
    if (id.length >= 6 && (t.includes(id) || decoded.includes(id))) return r;
  }
  for (const r of resources) {
    const name = resName(r);
    if (!name) continue;
    if (decoded === name || base2 === name) return r;
    if (decoded.endsWith("/" + name) || decoded.endsWith("\\" + name)) return r;
  }
  const stripExt = (s) => s.replace(/\.[a-z0-9]+$/i, "");
  for (const r of resources) {
    const name = resName(r);
    if (!name || !base2) continue;
    if (stripExt(base2) === stripExt(name)) return r;
  }
  return null;
}
function classifyRef(ref, resources, opts) {
  const t = ref.target.trim();
  if (!t) return { kind: "remote", ref };
  const pattern = (opts.pattern ?? "").trim();
  if (pattern) {
    let re = null;
    try {
      re = new RegExp(pattern);
    } catch {
      re = null;
    }
    if (re && re.test(t)) {
      const r2 = matchResource(t, resources);
      if (!r2) return { kind: "unmatched", ref };
      return opts.includeNonImages || isImageResource(r2) ? { kind: "matched", ref, resource: r2 } : { kind: "nonimage", ref, resource: r2 };
    }
    return { kind: "remote", ref };
  }
  if (isDataUri(t)) return { kind: "inline", ref };
  const r = matchResource(t, resources);
  if (r) {
    return opts.includeNonImages || isImageResource(r) ? { kind: "matched", ref, resource: r } : { kind: "nonimage", ref, resource: r };
  }
  if (isAbsoluteHttp(t)) return { kind: "remote", ref };
  return { kind: "unmatched", ref };
}
function buildMarkdownLink(template, vars) {
  const tpl = template && template.includes("{url}") ? template : "![{alt}]({url})";
  return tpl.split("{alt}").join(vars.alt).split("{url}").join(vars.url).split("{name}").join(vars.name);
}
function applyEdits(text, edits) {
  if (!edits.length) return text;
  const sorted = [...edits].sort((a, b) => a.start - b.start);
  let out = "";
  let pos = 0;
  for (const e of sorted) {
    if (e.start < pos) continue;
    out += text.slice(pos, e.start) + e.text;
    pos = e.end;
  }
  out += text.slice(pos);
  return out;
}
function computeReplacements(text, resources, opts) {
  const refs = parseImageRefs(text);
  const edits = [];
  const unmatched = [];
  const nonImages = [];
  let replaced = 0;
  for (const ref of refs) {
    const c = classifyRef(ref, resources, {
      pattern: opts.localRefPattern,
      includeNonImages: opts.includeNonImages
    });
    if (c.kind === "matched") {
      const url = opts.urlFor(c.resource);
      if (url) {
        edits.push({
          start: ref.start,
          end: ref.end,
          text: buildMarkdownLink(opts.markdownTemplate, {
            alt: ref.alt,
            url,
            name: resName(c.resource)
          })
        });
        replaced++;
      }
    } else if (c.kind === "unmatched") {
      unmatched.push(ref.target);
    } else if (c.kind === "nonimage") {
      nonImages.push(resName(c.resource) || ref.target);
    }
  }
  return { newText: applyEdits(text, edits), replaced, unmatched, nonImages };
}

// src/notes.ts
function docText(doc) {
  if (!doc) return "";
  return String(doc.text ?? doc.content ?? doc.markdown ?? doc.contentMarkdown ?? "");
}
function docNoteId(doc) {
  if (!doc) return null;
  const id = doc.noteId ?? doc.id ?? doc.note?.id;
  return typeof id === "string" && id ? id : null;
}
async function getEditorDoc(ctx) {
  try {
    return await ctx.editor.getDocument();
  } catch {
    return null;
  }
}
async function resolveCurrentNoteId(ctx) {
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
async function listNotes(ctx, limit = 100) {
  try {
    const res = await ctx.notes.query({ sort: "updated-desc", limit });
    return Array.isArray(res?.notes) ? res.notes : [];
  } catch {
    return [];
  }
}
async function listNoteResources(ctx, noteId) {
  try {
    const list = await ctx.resources.list(noteId);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
async function readResourceFile(ctx, resource) {
  const id = resId(resource);
  if (!id) return null;
  const blob = await ctx.resources.read(id);
  const name = resName(resource) || `${id}.bin`;
  const type = resType(resource) || blob.type || "application/octet-stream";
  return new File([blob], name, { type });
}
async function writeNoteMarkdown(ctx, noteId, newText, preferEditor) {
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

// src/util.ts
function errMsg(e) {
  if (e instanceof Error) return e.message || e.name;
  try {
    return String(e);
  } catch {
    return "\u672A\u77E5\u9519\u8BEF";
  }
}
function isHttpUrl(u) {
  return /^https?:\/\//i.test(u.trim());
}
function joinUrl(base2, path) {
  const b = base2.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : "/" + path;
  return b + p;
}
function truncate(s, n) {
  return s.length <= n ? s : s.slice(0, n) + "\u2026";
}
function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return "-";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
function formatTime(ts) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}
function shortId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

// src/imgbed.ts
var ImgbedError = class extends Error {
  status;
  constructor(message, status) {
    super(message);
    this.name = "ImgbedError";
    this.status = status;
  }
};
function base(settings) {
  return settings.endpoint.replace(/\/+$/, "");
}
function authHeaders(settings) {
  if (settings.authMode === "token" && settings.apiToken) {
    return { Authorization: `Bearer ${settings.apiToken}` };
  }
  return {};
}
function buildUploadUrl(settings, extra = {}) {
  const params = new URLSearchParams();
  params.set("returnFormat", settings.returnFormat === "full" ? "full" : "default");
  if (settings.uploadChannel) params.set("uploadChannel", settings.uploadChannel);
  if (settings.channelName) params.set("channelName", settings.channelName);
  if (settings.uploadNameType) params.set("uploadNameType", settings.uploadNameType);
  if (settings.uploadFolder) params.set("uploadFolder", settings.uploadFolder);
  if (settings.serverCompress && (!settings.uploadChannel || settings.uploadChannel === "telegram")) {
    params.set("serverCompress", "true");
  }
  if (settings.authMode === "authCode" && settings.authCode) {
    params.set("authCode", settings.authCode);
  }
  for (const [k, v] of Object.entries(extra)) {
    if (v) params.set(k, v);
  }
  return `${base(settings)}/upload?${params.toString()}`;
}
async function safeText(res) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
async function uploadFile(ctx, settings, file) {
  const fd = new FormData();
  fd.append("file", file, file.name);
  let res;
  try {
    res = await ctx.network.fetch(buildUploadUrl(settings), {
      method: "POST",
      headers: authHeaders(settings),
      body: fd
    });
  } catch (e) {
    throw new ImgbedError(`\u7F51\u7EDC\u8BF7\u6C42\u5931\u8D25\uFF1A${errMsg(e)}`);
  }
  const bodyText = await safeText(res);
  if (!res.ok) {
    throw new ImgbedError(`\u56FE\u5E8A\u8FD4\u56DE HTTP ${res.status}${bodyText ? `\uFF1A${truncate(bodyText, 200)}` : ""}`, res.status);
  }
  let data;
  try {
    data = JSON.parse(bodyText);
  } catch {
    throw new ImgbedError(`\u56FE\u5E8A\u54CD\u5E94\u4E0D\u662F\u5408\u6CD5 JSON\uFF1A${truncate(bodyText, 200)}`);
  }
  const first = Array.isArray(data) ? data[0] ?? null : data && typeof data === "object" ? data : null;
  const src = typeof first?.src === "string" ? first.src : "";
  const publicUrl = typeof first?.publicUrl === "string" ? first.publicUrl : "";
  if (!src && !publicUrl) {
    throw new ImgbedError(`\u56FE\u5E8A\u54CD\u5E94\u4E2D\u672A\u627E\u5230\u6587\u4EF6\u94FE\u63A5\uFF1A${truncate(bodyText, 200)}`);
  }
  let url = "";
  if (isHttpUrl(publicUrl)) url = publicUrl;
  else if (isHttpUrl(src)) url = src;
  else if (src) url = joinUrl(settings.endpoint, src);
  else url = publicUrl;
  return { url, src: src || publicUrl, name: file.name, size: file.size };
}
function srcToFileId(src) {
  let s = src.trim();
  if (isHttpUrl(s)) {
    try {
      const u = new URL(s);
      s = u.pathname;
    } catch {
    }
  }
  s = s.replace(/^\/+/, "").replace(/^file\//, "");
  return s;
}
async function deleteFile(ctx, settings, src) {
  const fileId = srcToFileId(src);
  if (!fileId) return;
  const url = `${base(settings)}/api/manage/delete/${encodeURI(fileId)}`;
  let res;
  try {
    res = await ctx.network.fetch(url, { method: "GET", headers: authHeaders(settings) });
  } catch (e) {
    throw new ImgbedError(`\u5220\u9664\u8BF7\u6C42\u5931\u8D25\uFF1A${errMsg(e)}`);
  }
  if (!res.ok) {
    const bodyText = await safeText(res);
    throw new ImgbedError(`\u56FE\u5E8A\u8FD4\u56DE HTTP ${res.status}${bodyText ? `\uFF1A${truncate(bodyText, 200)}` : ""}`, res.status);
  }
}
async function testConnection(ctx, settings) {
  try {
    const res = await ctx.network.fetch(base(settings), { method: "GET" });
    const text = await safeText(res);
    return {
      ok: res.ok,
      status: res.status,
      message: res.ok ? `\u7AD9\u70B9\u53EF\u8FBE\uFF08HTTP ${res.status}\uFF09` : `\u7AD9\u70B9\u8FD4\u56DE HTTP ${res.status}${text ? `\uFF1A${truncate(text, 120)}` : ""}`
    };
  } catch (e) {
    return { ok: false, status: 0, message: `\u8FDE\u63A5\u5931\u8D25\uFF1A${errMsg(e)}` };
  }
}

// src/records.ts
var RECORDS_KEY = "imgbed:records";
var MAX_RECORDS = 500;
async function listRecords(ctx) {
  try {
    const v = await ctx.storage.get(RECORDS_KEY);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
async function addRecord(ctx, record) {
  try {
    const list = (await listRecords(ctx)).filter((r) => r.id !== record.id);
    list.unshift(record);
    await ctx.storage.set(RECORDS_KEY, list.slice(0, MAX_RECORDS));
  } catch {
  }
}
async function removeRecords(ctx, ids) {
  if (!ids.length) return;
  try {
    const idSet = new Set(ids);
    const list = (await listRecords(ctx)).filter((r) => !idSet.has(r.id));
    await ctx.storage.set(RECORDS_KEY, list);
  } catch {
  }
}
async function recordsForNote(ctx, noteId) {
  return (await listRecords(ctx)).filter((r) => r.noteId === noteId);
}

// src/backup.ts
var INDEX_KEY = "imgbed:backup:index";
var ITEM_PREFIX = "imgbed:backup:item:";
var MAX_BACKUPS = 50;
async function saveBackup(ctx, noteId, noteTitle, markdown) {
  const key = `${noteId}_${shortId()}`;
  await ctx.storage.set(ITEM_PREFIX + key, markdown);
  const index = (await listBackups(ctx)).filter((e) => e.key !== key);
  index.unshift({ key, noteId, noteTitle, ts: Date.now() });
  await ctx.storage.set(INDEX_KEY, index.slice(0, MAX_BACKUPS));
  return key;
}
async function listBackups(ctx) {
  try {
    const v = await ctx.storage.get(INDEX_KEY);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
async function getBackupMarkdown(ctx, key) {
  try {
    const v = await ctx.storage.get(ITEM_PREFIX + key);
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}
async function removeBackup(ctx, key) {
  try {
    await ctx.storage.remove(ITEM_PREFIX + key);
    const index = (await listBackups(ctx)).filter((e) => e.key !== key);
    await ctx.storage.set(INDEX_KEY, index);
  } catch {
  }
}
async function latestBackupForNote(ctx, noteId) {
  const index = await listBackups(ctx);
  return index.find((e) => e.noteId === noteId) ?? null;
}

// src/uploader.ts
function emptyReport(noteId, noteTitle) {
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
    changed: false
  };
}
async function processNoteImages(ctx, settings, noteId, opts = {}) {
  const silent = !!opts.silent;
  const notice = (msg) => {
    if (!silent) ctx.ui.showNotice(msg);
  };
  let note;
  try {
    note = await ctx.notes.get(noteId);
  } catch (e) {
    notice(`\u8BFB\u53D6\u7B14\u8BB0\u5931\u8D25\uFF1A${errMsg(e)}`);
    return null;
  }
  const noteTitle = note.title ?? noteId;
  if (note.kind && note.kind !== "text") {
    notice(`\u300A${noteTitle}\u300B\u4E3A ${note.kind} \u7C7B\u578B\u7B14\u8BB0\uFF0C\u6682\u4E0D\u652F\u6301\u56FE\u7247\u5F15\u7528\u66FF\u6362`);
    return null;
  }
  const doc = await getEditorDoc(ctx);
  const useEditor = !!doc && docNoteId(doc) === noteId;
  const text = useEditor ? docText(doc) : String(note.contentMarkdown ?? "");
  if (!text.trim()) {
    notice(`\u300A${noteTitle}\u300B\u6CA1\u6709\u53EF\u5904\u7406\u7684\u6B63\u6587`);
    return null;
  }
  const report = emptyReport(noteId, noteTitle);
  const resources = await listNoteResources(ctx, noteId);
  const classes = parseImageRefs(text).map((ref) => ({
    ref,
    cls: classifyRef(ref, resources, {
      pattern: settings.localRefPattern,
      includeNonImages: settings.includeNonImages
    })
  }));
  const matchedResources = /* @__PURE__ */ new Map();
  for (const { cls } of classes) {
    if (cls.kind === "matched") matchedResources.set(resId(cls.resource), cls.resource);
  }
  if (!matchedResources.size) {
    report.unmatched = classes.filter((c) => c.cls.kind === "unmatched").map((c) => c.ref.target);
    report.nonImages = classes.filter((c) => c.cls.kind === "nonimage").map((c) => c.cls.kind === "nonimage" ? resName(c.cls.resource) || c.ref.target : "");
    notice(
      report.unmatched.length ? `\u672A\u53D1\u73B0\u53EF\u4E0A\u4F20\u7684\u56FE\u7247\uFF1A${report.unmatched.length} \u5904\u5F15\u7528\u65E0\u6CD5\u5339\u914D\u5230\u7B14\u8BB0\u8D44\u6E90` : `\u300A${noteTitle}\u300B\u6CA1\u6709\u9700\u8981\u4E0A\u4F20\u7684\u672C\u5730\u56FE\u7247`
    );
    return report;
  }
  const limit = settings.maxFileSizeMB > 0 ? settings.maxFileSizeMB * 1024 * 1024 : Number.POSITIVE_INFINITY;
  const cache = /* @__PURE__ */ new Map();
  let records = [];
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
    let file = null;
    try {
      file = await readResourceFile(ctx, resource);
    } catch (e) {
      report.failed.push({ name: resName(resource) || rid, error: `\u8BFB\u53D6\u8D44\u6E90\u5931\u8D25\uFF1A${errMsg(e)}` });
      continue;
    }
    if (!file) {
      report.failed.push({ name: resName(resource) || rid, error: "\u8D44\u6E90 ID \u7F3A\u5931\uFF0C\u65E0\u6CD5\u8BFB\u53D6" });
      continue;
    }
    if (file.size > limit) {
      report.skippedLarge.push(`${file.name}\uFF08${formatBytes(file.size)}\uFF09`);
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
          ts: Date.now()
        });
      } catch {
      }
    } catch (e) {
      report.failed.push({ name: file.name, error: errMsg(e) });
    }
  }
  if (!cache.size) {
    const parts = [];
    if (report.skippedLarge.length) parts.push(`${report.skippedLarge.length} \u4E2A\u6587\u4EF6\u8D85\u8FC7\u5927\u5C0F\u4E0A\u9650`);
    if (report.failed.length) parts.push(`${report.failed.length} \u4E2A\u6587\u4EF6\u4E0A\u4F20\u5931\u8D25`);
    notice(`\u6CA1\u6709\u6210\u529F\u4E0A\u4F20\u7684\u56FE\u7247${parts.length ? `\uFF08${parts.join("\uFF0C")}\uFF09` : ""}`);
    return report;
  }
  try {
    const freshDoc = useEditor ? await getEditorDoc(ctx) : null;
    const freshText = useEditor && freshDoc && docNoteId(freshDoc) === noteId ? docText(freshDoc) : String((await ctx.notes.get(noteId)).contentMarkdown ?? "");
    const freshResources = await listNoteResources(ctx, noteId);
    const result = computeReplacements(freshText, freshResources, {
      localRefPattern: settings.localRefPattern,
      markdownTemplate: settings.markdownTemplate,
      includeNonImages: settings.includeNonImages,
      urlFor: (r) => cache.get(resId(r))?.url ?? null
    });
    report.replaced = result.replaced;
    report.unmatched = result.unmatched;
    report.nonImages = result.nonImages;
    if (result.replaced > 0 && result.newText !== freshText) {
      if (settings.backupBeforeReplace) {
        try {
          report.backupKey = await saveBackup(ctx, noteId, noteTitle, freshText);
        } catch {
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
            report.failed.push({ name, error: `\u5220\u9664\u672C\u5730\u8D44\u6E90\u5931\u8D25\uFF1A${errMsg(e)}` });
            continue;
          }
          if (settings.syncDeleteRemote) {
            try {
              await deleteFile(ctx, settings, cache.get(rid).src);
              report.deletedRemote.push(cache.get(rid).url);
            } catch (e) {
              report.failed.push({ name, error: `\u5220\u9664\u56FE\u5E8A\u6587\u4EF6\u5931\u8D25\uFF1A${errMsg(e)}` });
            }
          }
        }
        if (settings.syncDeleteRemote && report.deletedRemote.length) {
          try {
            const current = await listRecords(ctx);
            const ids = current.filter((r) => r.noteId === noteId && cache.has(r.resourceId)).map((r) => r.id);
            if (ids.length) await removeRecords(ctx, ids);
          } catch {
          }
        }
      }
    }
  } catch (e) {
    notice(`\u66FF\u6362\u7B14\u8BB0\u5185\u5BB9\u5931\u8D25\uFF1A${errMsg(e)}`);
    return report;
  }
  const segs = [];
  if (report.uploaded.length) segs.push(`\u65B0\u4E0A\u4F20 ${report.uploaded.length} \u5F20`);
  if (report.reused.length) segs.push(`\u590D\u7528 ${report.reused.length} \u5F20`);
  if (report.replaced) segs.push(`\u66FF\u6362 ${report.replaced} \u5904\u5F15\u7528`);
  if (report.unmatched.length) segs.push(`${report.unmatched.length} \u5904\u65E0\u6CD5\u5339\u914D`);
  if (report.nonImages.length) segs.push(`${report.nonImages.length} \u4E2A\u975E\u56FE\u7247\u9644\u4EF6\u5DF2\u8DF3\u8FC7`);
  if (report.skippedLarge.length) segs.push(`${report.skippedLarge.length} \u4E2A\u8D85\u8FC7\u5927\u5C0F\u4E0A\u9650`);
  if (report.failed.length) segs.push(`${report.failed.length} \u4E2A\u5931\u8D25`);
  if (report.deletedLocal.length) segs.push(`\u5DF2\u5220\u672C\u5730\u8D44\u6E90 ${report.deletedLocal.length} \u4E2A`);
  if (report.deletedRemote.length) segs.push(`\u5DF2\u5220\u56FE\u5E8A\u6587\u4EF6 ${report.deletedRemote.length} \u4E2A`);
  notice(segs.length ? `\u300A${noteTitle}\u300B\uFF1A${segs.join("\uFF0C")}` : `\u300A${noteTitle}\u300B\u65E0\u9700\u5904\u7406`);
  return report;
}

// src/commands.ts
function registerCommands(ctx) {
  const disposers = [];
  disposers.push(
    ctx.commands.register({
      id: "imgbed-upload-current-note",
      title: "\u4E0A\u4F20\u5F53\u524D\u7B14\u8BB0\u56FE\u7247\u5230\u56FE\u5E8A",
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
          ctx.ui.showNotice("\u672A\u627E\u5230\u5F53\u524D\u7B14\u8BB0\uFF0C\u8BF7\u5148\u6253\u5F00\u4E00\u7BC7\u7B14\u8BB0");
          return;
        }
        await processNoteImages(ctx, settings, noteId);
      }
    })
  );
  disposers.push(
    ctx.commands.register({
      id: "imgbed-open-panel",
      title: "\u6253\u5F00\u56FE\u5E8A\u8FC1\u79FB\u9762\u677F",
      listed: true,
      menu: true,
      run: async () => {
        try {
          await ctx.ui.panels.open("imgbed-manager");
        } catch (e) {
          ctx.ui.showNotice(`\u6253\u5F00\u9762\u677F\u5931\u8D25\uFF1A${errMsg(e)}`);
        }
      }
    })
  );
  disposers.push(
    ctx.commands.register({
      id: "imgbed-restore-backup",
      title: "\u6062\u590D\u5F53\u524D\u7B14\u8BB0\u66FF\u6362\u524D\u7684\u5185\u5BB9",
      listed: true,
      menu: true,
      run: async () => {
        const noteId = await resolveCurrentNoteId(ctx);
        if (!noteId) {
          ctx.ui.showNotice("\u672A\u627E\u5230\u5F53\u524D\u7B14\u8BB0\uFF0C\u8BF7\u5148\u6253\u5F00\u4E00\u7BC7\u7B14\u8BB0");
          return;
        }
        const entry = await latestBackupForNote(ctx, noteId);
        if (!entry) {
          ctx.ui.showNotice("\u5F53\u524D\u7B14\u8BB0\u6CA1\u6709\u66FF\u6362\u5907\u4EFD");
          return;
        }
        const md = await getBackupMarkdown(ctx, entry.key);
        if (md == null) {
          ctx.ui.showNotice("\u5907\u4EFD\u5185\u5BB9\u4E0D\u5B58\u5728\u6216\u5DF2\u635F\u574F");
          return;
        }
        try {
          const doc = await getEditorDoc(ctx);
          const preferEditor = docNoteId(doc) === noteId;
          await writeNoteMarkdown(ctx, noteId, md, preferEditor);
          ctx.ui.showNotice("\u5DF2\u6062\u590D\u66FF\u6362\u524D\u7684\u5185\u5BB9");
        } catch (e) {
          ctx.ui.showNotice(`\u6062\u590D\u5931\u8D25\uFF1A${errMsg(e)}`);
        }
      }
    })
  );
  return () => {
    for (const d of disposers) {
      try {
        d();
      } catch {
      }
    }
  };
}

// src/panel.ts
function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function btn(label, onClick) {
  const b = h("button", "ee-imgbed-btn", label);
  b.type = "button";
  b.addEventListener("click", () => {
    void (async () => {
      b.disabled = true;
      try {
        await onClick();
      } catch (e) {
        console.error("[imgbed] \u64CD\u4F5C\u5931\u8D25", e);
      } finally {
        b.disabled = false;
      }
    })();
  });
  return b;
}
async function copyText(text) {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
  }
  return false;
}
function registerPanel(ctx) {
  return ctx.ui.panels.register({
    id: "imgbed-manager",
    title: "\u56FE\u5E8A\u8FC1\u79FB",
    purpose: "workflow",
    presentation: "dialog",
    mount(container, api) {
      const root = h("div", "ee-imgbed-root");
      const state = {
        settings: null,
        settingsError: null,
        notes: [],
        selectedNoteId: "",
        resources: [],
        records: [],
        backups: [],
        recent: [],
        status: "",
        busy: false
      };
      const setStatus = (msg) => {
        state.status = msg;
      };
      async function refreshAll() {
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
      async function reloadRecords() {
        state.records = await listRecords(ctx);
        state.backups = await listBackups(ctx);
      }
      function renderStatusCard() {
        const card = h("div", "ee-imgbed-card");
        card.append(h("div", "ee-imgbed-card-title", "\u8FDE\u63A5\u4E0E\u914D\u7F6E"));
        const s = state.settings;
        const lines = [];
        if (s) {
          lines.push(`\u7AD9\u70B9\uFF1A${s.endpoint || "\uFF08\u672A\u914D\u7F6E\uFF09"}`);
          lines.push(
            `\u9274\u6743\uFF1A${s.authMode === "token" ? "API Token" : s.authMode === "authCode" ? "\u4E0A\u4F20\u8BA4\u8BC1\u7801" : "\u65E0"}`
          );
          lines.push(
            `\u81EA\u52A8\u4E0A\u4F20\uFF1A${s.autoUploadOnSave ? `\u5F00\uFF08${s.autoUploadScope === "all" ? "\u6240\u6709\u7B14\u8BB0" : "\u4EC5\u5F53\u524D\u7B14\u8BB0"}\uFF09` : "\u5173"}`
          );
          lines.push(`\u66FF\u6362\u540E\u5220\u9664\u672C\u5730\u8D44\u6E90\uFF1A${s.deleteLocalAfterUpload ? "\u5F00" : "\u5173"}`);
          lines.push(`\u540C\u6B65\u5220\u9664\u56FE\u5E8A\u6587\u4EF6\uFF1A${s.syncDeleteRemote ? "\u5F00" : "\u5173"}`);
        }
        for (const line of lines) card.append(h("div", "ee-imgbed-muted", line));
        if (state.settingsError) {
          card.append(h("p", "ee-imgbed-status", `\u914D\u7F6E\u4E0D\u53EF\u7528\uFF1A${state.settingsError}`));
        }
        const row = h("div", "ee-imgbed-row");
        row.append(
          btn("\u6D4B\u8BD5\u8FDE\u63A5", async () => {
            if (!state.settings) return;
            setStatus("\u6B63\u5728\u6D4B\u8BD5\u8FDE\u63A5\u2026");
            const r = await testConnection(ctx, state.settings);
            setStatus(r.message);
            render();
          })
        );
        row.append(
          btn("\u5237\u65B0", async () => {
            await refreshAll();
            setStatus("\u5DF2\u5237\u65B0");
            render();
          })
        );
        card.append(row);
        return card;
      }
      function renderLocalCard() {
        const card = h("div", "ee-imgbed-card");
        card.append(h("div", "ee-imgbed-card-title", "\u4E0A\u4F20\u672C\u5730\u6587\u4EF6\uFF08\u4E0D\u7ECF\u8FC7 EdgeEver\uFF0C\u76F4\u63A5\u4F20\u5230\u56FE\u5E8A\uFF09"));
        const input = h("input", "ee-imgbed-input");
        input.type = "file";
        input.multiple = true;
        const row = h("div", "ee-imgbed-row");
        row.append(input);
        row.append(
          btn("\u4E0A\u4F20\u5E76\u751F\u6210\u94FE\u63A5", async () => {
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
              setStatus("\u8BF7\u5148\u9009\u62E9\u6587\u4EF6");
              render();
              return;
            }
            const limit = s.maxFileSizeMB > 0 ? s.maxFileSizeMB * 1024 * 1024 : Number.POSITIVE_INFINITY;
            for (const f of files) {
              if (f.size > limit) {
                setStatus(`\u300C${f.name}\u300D\u8D85\u8FC7\u5927\u5C0F\u4E0A\u9650\uFF08${formatBytes(f.size)}\uFF09\uFF0C\u5DF2\u8DF3\u8FC7\uFF08\u672A\u5B9E\u73B0\u5206\u5757\u4E0A\u4F20\uFF09`);
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
                    noteTitle: "\u672C\u5730\u6587\u4EF6",
                    resourceId: `local:${f.name}:${Date.now().toString(36)}`,
                    fileName: f.name,
                    src: up.src,
                    url: up.url,
                    size: f.size,
                    ts: Date.now()
                  });
                } catch {
                }
                setStatus(`\u5DF2\u4E0A\u4F20\uFF1A${f.name}`);
              } catch (e) {
                setStatus(`\u300C${f.name}\u300D\u4E0A\u4F20\u5931\u8D25\uFF1A${errMsg(e)}`);
              }
            }
            input.value = "";
            await reloadRecords();
            render();
          })
        );
        card.append(row);
        if (state.recent.length) {
          const list = h("div");
          for (const r of state.recent.slice(0, 20)) {
            const line = h("div", "ee-imgbed-row");
            line.append(h("span", "ee-imgbed-url", r.url));
            line.append(
              btn("\u590D\u5236\u94FE\u63A5", async () => {
                const ok = await copyText(r.url);
                setStatus(ok ? "\u5DF2\u590D\u5236\u94FE\u63A5" : "\u590D\u5236\u5931\u8D25\uFF0C\u8BF7\u624B\u52A8\u590D\u5236\u4E0A\u65B9\u94FE\u63A5");
                render();
              })
            );
            line.append(
              btn("\u590D\u5236 Markdown", async () => {
                const ok = await copyText(r.md);
                setStatus(ok ? "\u5DF2\u590D\u5236 Markdown" : "\u590D\u5236\u5931\u8D25\uFF0C\u8BF7\u624B\u52A8\u590D\u5236");
                render();
              })
            );
            line.append(
              btn("\u63D2\u5165\u5230\u5149\u6807", async () => {
                try {
                  await ctx.editor.insertAtCursor(r.md);
                  setStatus("\u5DF2\u63D2\u5165\u5230\u5149\u6807");
                } catch (e) {
                  setStatus(`\u63D2\u5165\u5931\u8D25\uFF1A${errMsg(e)}`);
                }
                render();
              })
            );
            list.append(line);
          }
          card.append(list);
        }
        return card;
      }
      function renderNotesCard() {
        const card = h("div", "ee-imgbed-card");
        card.append(h("div", "ee-imgbed-card-title", "\u7B14\u8BB0\u56FE\u7247"));
        const row = h("div", "ee-imgbed-row");
        const select = h("select", "ee-imgbed-select");
        for (const n of state.notes) {
          const opt = h("option", void 0, `${n.title ?? n.id}${n.kind && n.kind !== "text" ? `\uFF08${n.kind}\uFF09` : ""}`);
          opt.value = n.id;
          if (n.id === state.selectedNoteId) opt.selected = true;
          select.append(opt);
        }
        row.append(select);
        row.append(
          btn("\u52A0\u8F7D\u8D44\u6E90", async () => {
            state.selectedNoteId = select.value;
            state.resources = state.selectedNoteId ? await listNoteResources(ctx, state.selectedNoteId) : [];
            setStatus(state.resources.length ? `\u5171 ${state.resources.length} \u4E2A\u8D44\u6E90` : "\u8BE5\u7B14\u8BB0\u6CA1\u6709\u8D44\u6E90");
            render();
          })
        );
        row.append(
          btn("\u4E0A\u4F20\u5E76\u66FF\u6362\u5168\u90E8", async () => {
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
              setStatus("\u8BF7\u5148\u9009\u62E9\u7B14\u8BB0");
              render();
              return;
            }
            setStatus("\u6B63\u5728\u5904\u7406\uFF0C\u8BF7\u7A0D\u5019\u2026");
            render();
            await processNoteImages(ctx, s, state.selectedNoteId);
            state.resources = await listNoteResources(ctx, state.selectedNoteId);
            await reloadRecords();
            setStatus("\u5904\u7406\u5B8C\u6210");
            render();
          })
        );
        card.append(row);
        if (state.resources.length) {
          const table = h("table", "ee-imgbed-table");
          const thead = h("thead");
          const trh = h("tr");
          for (const t of ["\u6587\u4EF6", "\u7C7B\u578B", "\u5927\u5C0F", "\u56FE\u7247", "\u64CD\u4F5C"]) trh.append(h("th", void 0, t));
          thead.append(trh);
          table.append(thead);
          const tbody = h("tbody");
          for (const r of state.resources) {
            const tr = h("tr");
            tr.append(h("td", void 0, resName(r) || resId(r)));
            tr.append(h("td", void 0, resType(r) || "-"));
            tr.append(h("td", void 0, formatBytes(r.size ?? 0)));
            tr.append(h("td", void 0, isImageResource(r) ? "\u662F" : "\u5426"));
            const td = h("td");
            td.append(
              btn("\u4E0A\u4F20", async () => {
                const s = state.settings;
                if (!s) return;
                const err = validateSettings(s);
                if (err) {
                  setStatus(err);
                  render();
                  return;
                }
                setStatus(`\u6B63\u5728\u4E0A\u4F20 ${resName(r)}\u2026`);
                try {
                  const file = await readResourceFile(ctx, r);
                  if (!file) throw new Error("\u8D44\u6E90 ID \u7F3A\u5931");
                  if (file.size > (s.maxFileSizeMB > 0 ? s.maxFileSizeMB * 1024 * 1024 : Number.POSITIVE_INFINITY)) {
                    setStatus(`\u300C${file.name}\u300D\u8D85\u8FC7\u5927\u5C0F\u4E0A\u9650\uFF0C\u5DF2\u8DF3\u8FC7`);
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
                      ts: Date.now()
                    });
                  } catch {
                  }
                  await reloadRecords();
                  setStatus(`\u5DF2\u4E0A\u4F20\uFF1A${file.name}`);
                } catch (e) {
                  setStatus(`\u4E0A\u4F20\u5931\u8D25\uFF1A${errMsg(e)}`);
                }
                render();
              })
            );
            tr.append(td);
            tbody.append(tr);
          }
          table.append(tbody);
          card.append(table);
        } else if (state.selectedNoteId) {
          card.append(h("p", "ee-imgbed-status", "\u8BE5\u7B14\u8BB0\u6CA1\u6709\u8D44\u6E90\uFF0C\u6216\u70B9\u51FB\u300C\u52A0\u8F7D\u8D44\u6E90\u300D\u5237\u65B0\u3002"));
        }
        return card;
      }
      function renderRecordsCard() {
        const card = h("div", "ee-imgbed-card");
        card.append(h("div", "ee-imgbed-card-title", `\u4E0A\u4F20\u8BB0\u5F55\uFF08${state.records.length}\uFF09`));
        if (!state.records.length) {
          card.append(h("p", "ee-imgbed-status", "\u6682\u65E0\u4E0A\u4F20\u8BB0\u5F55\u3002"));
          return card;
        }
        const table = h("table", "ee-imgbed-table");
        const thead = h("thead");
        const trh = h("tr");
        for (const t of ["\u65F6\u95F4", "\u6765\u6E90", "\u6587\u4EF6", "\u94FE\u63A5", "\u64CD\u4F5C"]) trh.append(h("th", void 0, t));
        thead.append(trh);
        table.append(thead);
        const tbody = h("tbody");
        for (const rec of state.records.slice(0, 100)) {
          const tr = h("tr");
          tr.append(h("td", void 0, formatTime(rec.ts)));
          tr.append(h("td", void 0, rec.noteTitle || "-"));
          tr.append(h("td", void 0, rec.fileName));
          tr.append(h("td", "ee-imgbed-url", rec.url));
          const td = h("td");
          td.append(
            btn("\u590D\u5236", async () => {
              const ok = await copyText(rec.url);
              setStatus(ok ? "\u5DF2\u590D\u5236\u94FE\u63A5" : "\u590D\u5236\u5931\u8D25\uFF0C\u8BF7\u624B\u52A8\u590D\u5236");
              render();
            })
          );
          td.append(
            btn("\u5220\u9664\u8FDC\u7AEF", async () => {
              const s = state.settings;
              if (!s) return;
              if (s.authMode !== "token" || !s.apiToken) {
                setStatus("\u5220\u9664\u56FE\u5E8A\u6587\u4EF6\u9700\u8981\u914D\u7F6E\u5177\u6709 delete \u6743\u9650\u7684 API Token");
                render();
                return;
              }
              try {
                await deleteFile(ctx, s, rec.src);
                await removeRecords(ctx, [rec.id]);
                await reloadRecords();
                setStatus(`\u5DF2\u5220\u9664\u56FE\u5E8A\u6587\u4EF6\uFF1A${rec.fileName}`);
              } catch (e) {
                setStatus(`\u5220\u9664\u5931\u8D25\uFF1A${errMsg(e)}`);
              }
              render();
            })
          );
          tr.append(td);
          tbody.append(tr);
        }
        table.append(tbody);
        card.append(table);
        return card;
      }
      function renderBackupsCard() {
        const card = h("div", "ee-imgbed-card");
        card.append(h("div", "ee-imgbed-card-title", `\u66FF\u6362\u5907\u4EFD\uFF08${state.backups.length}\uFF09`));
        if (!state.backups.length) {
          card.append(h("p", "ee-imgbed-status", "\u6682\u65E0\u5907\u4EFD\u3002\u5F00\u542F\u8BBE\u7F6E\u4E2D\u7684\u300C\u66FF\u6362\u524D\u81EA\u52A8\u5907\u4EFD\u7B14\u8BB0\u539F\u6587\u300D\u540E\uFF0C\u6BCF\u6B21\u66FF\u6362\u90FD\u4F1A\u7559\u5B58\u539F\u6587\u3002"));
          return card;
        }
        const table = h("table", "ee-imgbed-table");
        const thead = h("thead");
        const trh = h("tr");
        for (const t of ["\u65F6\u95F4", "\u7B14\u8BB0", "\u64CD\u4F5C"]) trh.append(h("th", void 0, t));
        thead.append(trh);
        table.append(thead);
        const tbody = h("tbody");
        for (const b of state.backups.slice(0, 50)) {
          const tr = h("tr");
          tr.append(h("td", void 0, formatTime(b.ts)));
          tr.append(h("td", void 0, b.noteTitle || b.noteId));
          const td = h("td");
          td.append(
            btn("\u6062\u590D", async () => {
              const md = await getBackupMarkdown(ctx, b.key);
              if (md == null) {
                setStatus("\u5907\u4EFD\u5185\u5BB9\u4E0D\u5B58\u5728\u6216\u5DF2\u635F\u574F");
                render();
                return;
              }
              try {
                const doc = await getEditorDoc(ctx);
                const preferEditor = docNoteId(doc) === b.noteId;
                await writeNoteMarkdown(ctx, b.noteId, md, preferEditor);
                setStatus(`\u5DF2\u6062\u590D\u300A${b.noteTitle}\u300B\u7684\u5907\u4EFD\u5185\u5BB9`);
              } catch (e) {
                setStatus(`\u6062\u590D\u5931\u8D25\uFF1A${errMsg(e)}`);
              }
              render();
            })
          );
          td.append(
            btn("\u5220\u9664", async () => {
              await removeBackup(ctx, b.key);
              await reloadRecords();
              setStatus("\u5DF2\u5220\u9664\u5907\u4EFD");
              render();
            })
          );
          tr.append(td);
          tbody.append(tr);
        }
        table.append(tbody);
        card.append(table);
        return card;
      }
      function render() {
        root.replaceChildren();
        root.append(h("p", "ee-imgbed-status", state.status || "\u5C31\u7EEA"));
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
            title: "\u56FE\u5E8A\u8FC1\u79FB",
            description: "\u4E0A\u4F20 / \u66FF\u6362 / \u8BB0\u5F55 / \u5907\u4EFD",
            actions: [{ id: "refresh", label: "\u5237\u65B0" }]
          },
          onAction(actionId) {
            if (actionId === "refresh") {
              void (async () => {
                await refreshAll();
                setStatus("\u5DF2\u5237\u65B0");
                render();
              })();
            }
          }
        });
      } catch {
      }
      void (async () => {
        try {
          await refreshAll();
          render();
        } catch (e) {
          setStatus(`\u521D\u59CB\u5316\u5931\u8D25\uFF1A${errMsg(e)}`);
          render();
        }
      })();
      return () => {
        root.remove();
      };
    }
  });
}

// src/index.ts
var src_default = {
  activate(context) {
    const ctx = context;
    const disposers = [];
    disposers.push(registerCommands(ctx));
    disposers.push(registerPanel(ctx));
    const processing = /* @__PURE__ */ new Set();
    disposers.push(
      ctx.events.on("note.updated", async (payload) => {
        let settings;
        try {
          settings = await loadSettings(ctx);
        } catch {
          return;
        }
        if (!settings.autoUploadOnSave) return;
        const p = payload;
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
          ctx.ui.showNotice(`\u81EA\u52A8\u4E0A\u4F20\u5931\u8D25\uFF1A${errMsg(e)}`);
        } finally {
          processing.delete(noteId);
        }
      })
    );
    disposers.push(
      ctx.events.on("note.deleted", async (payload) => {
        try {
          const p = payload;
          const noteId = p?.note?.id ?? p?.noteId ?? p?.id;
          if (!noteId) return;
          const settings = await loadSettings(ctx);
          if (!settings.syncDeleteRemote) return;
          if (settings.authMode !== "token" || !settings.apiToken) return;
          const recs = await recordsForNote(ctx, noteId);
          if (!recs.length) return;
          const failed = [];
          const okIds = [];
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
            ctx.ui.showNotice(`\u7B14\u8BB0\u5DF2\u5220\u9664\uFF0C\u4F46\u6709 ${failed.length} \u4E2A\u56FE\u5E8A\u6587\u4EF6\u5220\u9664\u5931\u8D25`);
          }
        } catch {
        }
      })
    );
    return () => {
      for (const d of disposers) {
        try {
          d();
        } catch {
        }
      }
    };
  }
};
export {
  src_default as default
};
