import { PluginResource } from "./types";

/**
 * Markdown 图片引用的扫描、分类与替换。
 *
 * 背景：EdgeEver 插件开发指南未公开笔记 Markdown 中本地图片的具体引用语法
 * （可能是自定义协议、相对路径，或指向自身服务器的绝对 URL）。
 * 因此这里采用「通用扫描 + 资源匹配」策略：
 *   1. 扫描所有图片引用（行内 ![alt](target) 与 wiki ![[target]]）；
 *   2. 尝试把引用匹配到笔记资源（按资源 ID 包含、文件名精确/路径后缀、无扩展名相等）；
 *   3. 匹配到资源 → 本地图片（上传后用模板替换）；
 *      匹配不到且是 http(s) 绝对地址 → 远程图片（跳过）；
 *      匹配不到且是 data: → 内联数据（跳过）；
 *      匹配不到的其他形式 → 视为无法识别的本地引用（报告给用户，不改动）。
 * 用户也可以在设置中提供 localRefPattern 正则，精确指定哪些引用算本地图片。
 */

export interface ImageRef {
  alt: string;
  /** 引用目标（已去除尖括号包裹与首尾空白） */
  target: string;
  /** 完整匹配文本 */
  full: string;
  start: number;
  end: number;
}

/** 行内图片：![alt](target "optional title")，target 允许空格但排除括号 */
const INLINE_RE = /!\[([^\]]*)\]\(\s*(<[^<>]*>|[^()]+?)\s*(?:(?:"[^"]*"|'[^']*')\s*)?\)/g;
/** wiki 风格图片：![[target]] */
const WIKI_RE = /!\[\[([^\[\]]+)\]\]/g;

export function parseImageRefs(markdown: string): ImageRef[] {
  const refs: ImageRef[] = [];
  let m: RegExpExecArray | null;

  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(markdown)) !== null) {
    const rawTarget = (m[2] ?? "").trim();
    const target = rawTarget.startsWith("<") && rawTarget.endsWith(">") ? rawTarget.slice(1, -1).trim() : rawTarget;
    refs.push({
      alt: m[1] ?? "",
      target,
      full: m[0],
      start: m.index,
      end: m.index + m[0].length,
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

export function isDataUri(t: string): boolean {
  return /^data:/i.test(t.trim());
}

export function isAbsoluteHttp(t: string): boolean {
  return /^(https?:)?\/\//i.test(t.trim());
}

export function safeDecodeURIComponent(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function basename(p: string): string {
  const s = p.replace(/[\\/]+$/, "");
  const idx = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
  return idx >= 0 ? s.slice(idx + 1) : s;
}

/** 资源 ID（文档未统一字段名，逐个探测） */
export function resId(r: PluginResource | null | undefined): string {
  if (!r) return "";
  return String(r.id ?? r.resourceId ?? "");
}

/** 资源文件名 */
export function resName(r: PluginResource | null | undefined): string {
  if (!r) return "";
  return String(r.name ?? r.filename ?? r.fileName ?? "");
}

/** 资源 MIME 类型 */
export function resType(r: PluginResource | null | undefined): string {
  if (!r) return "";
  return String(r.type ?? r.mimeType ?? r.fileType ?? "");
}

const IMAGE_EXTS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif", "ico", "tif", "tiff", "heic", "heif",
]);

export function isImageResource(r: PluginResource): boolean {
  if (resType(r).toLowerCase().startsWith("image/")) return true;
  const ext = resName(r).split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTS.has(ext);
}

/**
 * 把一个引用目标匹配到笔记资源。匹配强度从强到弱，避免误配：
 *   1. 资源 ID 出现在引用中（要求 ID 长度 >= 6，防止误命中）；
 *   2. 文件名精确相等或路径后缀相等；
 *   3. 去掉扩展名后相等。
 */
export function matchResource(target: string, resources: PluginResource[]): PluginResource | null {
  const t = target.trim();
  if (!t) return null;
  const decoded = safeDecodeURIComponent(t);
  const base = basename(decoded);

  for (const r of resources) {
    const id = resId(r);
    if (id.length >= 6 && (t.includes(id) || decoded.includes(id))) return r;
  }

  for (const r of resources) {
    const name = resName(r);
    if (!name) continue;
    if (decoded === name || base === name) return r;
    if (decoded.endsWith("/" + name) || decoded.endsWith("\\" + name)) return r;
  }

  const stripExt = (s: string): string => s.replace(/\.[a-z0-9]+$/i, "");
  for (const r of resources) {
    const name = resName(r);
    if (!name || !base) continue;
    if (stripExt(base) === stripExt(name)) return r;
  }

  return null;
}

export type RefClass =
  | { kind: "matched"; ref: ImageRef; resource: PluginResource }
  | { kind: "unmatched"; ref: ImageRef }
  | { kind: "remote"; ref: ImageRef }
  | { kind: "inline"; ref: ImageRef }
  | { kind: "nonimage"; ref: ImageRef; resource: PluginResource };

export function classifyRef(
  ref: ImageRef,
  resources: PluginResource[],
  opts: { pattern?: string; includeNonImages?: boolean },
): RefClass {
  const t = ref.target.trim();
  if (!t) return { kind: "remote", ref };

  const pattern = (opts.pattern ?? "").trim();
  if (pattern) {
    let re: RegExp | null = null;
    try {
      re = new RegExp(pattern);
    } catch {
      re = null;
    }
    if (re && re.test(t)) {
      const r = matchResource(t, resources);
      if (!r) return { kind: "unmatched", ref };
      return opts.includeNonImages || isImageResource(r)
        ? { kind: "matched", ref, resource: r }
        : { kind: "nonimage", ref, resource: r };
    }
    // 用户提供了识别规则但当前引用不匹配 → 按非本地引用处理（跳过）
    return { kind: "remote", ref };
  }

  if (isDataUri(t)) return { kind: "inline", ref };

  const r = matchResource(t, resources);
  if (r) {
    return opts.includeNonImages || isImageResource(r)
      ? { kind: "matched", ref, resource: r }
      : { kind: "nonimage", ref, resource: r };
  }

  if (isAbsoluteHttp(t)) return { kind: "remote", ref };
  return { kind: "unmatched", ref };
}

/** 用模板生成 Markdown 链接。模板必须包含 {url}，否则回退默认模板。 */
export function buildMarkdownLink(template: string, vars: { alt: string; url: string; name: string }): string {
  const tpl = template && template.includes("{url}") ? template : "![{alt}]({url})";
  return tpl.split("{alt}").join(vars.alt).split("{url}").join(vars.url).split("{name}").join(vars.name);
}

/**
 * 由图片模板派生附件（非图片）模板：附件应渲染为可点击的超链接而非图片，
 * 否则 ![alt](xxx.pdf) 会显示成裂图。做法是去掉图片模板开头的 "!"，
 * 例如 ![{alt}]({url}) → [{alt}]({url})。
 */
export function toLinkTemplate(imageTemplate: string): string {
  const tpl = imageTemplate && imageTemplate.includes("{url}") ? imageTemplate : "![{alt}]({url})";
  return tpl.startsWith("!") ? tpl.slice(1) : tpl;
}

export interface Replacement {
  start: number;
  end: number;
  text: string;
}

/** 按偏移量应用替换（自动排序，跳过重叠区间）。 */
export function applyEdits(text: string, edits: Replacement[]): string {
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

export interface ComputeResult {
  newText: string;
  replaced: number;
  unmatched: string[];
  nonImages: string[];
}

/**
 * 在给定文本上计算替换结果。urlFor 返回 null 表示该资源本轮没有可用链接（上传失败/超限），引用保持原样。
 */
export function computeReplacements(
  text: string,
  resources: PluginResource[],
  opts: {
    localRefPattern: string;
    markdownTemplate: string;
    includeNonImages: boolean;
    urlFor: (resource: PluginResource) => string | null;
  },
): ComputeResult {
  const refs = parseImageRefs(text);
  const edits: Replacement[] = [];
  const unmatched: string[] = [];
  const nonImages: string[] = [];
  let replaced = 0;

  for (const ref of refs) {
    const c = classifyRef(ref, resources, {
      pattern: opts.localRefPattern,
      includeNonImages: opts.includeNonImages,
    });
    if (c.kind === "matched") {
      const url = opts.urlFor(c.resource);
      if (url) {
        // 图片用图片模板（嵌入显示）；非图片附件用链接模板（可点击下载，避免裂图）
        const template = isImageResource(c.resource)
          ? opts.markdownTemplate
          : toLinkTemplate(opts.markdownTemplate);
        edits.push({
          start: ref.start,
          end: ref.end,
          text: buildMarkdownLink(template, {
            alt: ref.alt,
            url,
            name: resName(c.resource),
          }),
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
