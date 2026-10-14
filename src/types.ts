/**
 * EdgeEver 插件 API 的最小 TypeScript 声明。
 * 仅覆盖本插件实际使用到的接口，字段名以《EdgeEver 插件开发指南》为准；
 * 对文档未明确的结构（如资源对象、编辑器文档）采用宽松可选字段 + 运行时防御性读取。
 */

export interface PluginNoteSummary {
  id: string;
  title?: string;
  kind?: string;
  revision?: number;
  contentHash?: string;
  updatedAt?: string;
}

export interface PluginNote extends PluginNoteSummary {
  contentMarkdown?: string;
}

/** 文档未给出精确结构，这里列出所有可能的字段名，运行时逐个探测。 */
export interface PluginResource {
  id?: string;
  resourceId?: string;
  name?: string;
  filename?: string;
  fileName?: string;
  type?: string;
  mimeType?: string;
  fileType?: string;
  size?: number;
  url?: string;
  contentHash?: string;
}

/** 文档未给出精确结构，运行时探测 id / text。 */
export interface EditorDocument {
  id?: string;
  noteId?: string;
  note?: { id?: string };
  text?: string;
  content?: string;
  markdown?: string;
  contentMarkdown?: string;
}

/** 只使用 text() 单次读取，避免 Response  body 重复读取问题。 */
export interface NetworkResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export interface NotesApi {
  query(opts?: Record<string, unknown>): Promise<{ notes?: PluginNoteSummary[]; totalCount?: number }>;
  queryContent(opts?: Record<string, unknown>): Promise<{ notes?: PluginNote[] }>;
  get(noteId: string): Promise<PluginNote>;
  update(noteId: string, patch: Record<string, unknown>): Promise<unknown>;
  editMarkdown(noteId: string, opts: Record<string, unknown>): Promise<unknown>;
}

export interface ResourcesApi {
  list(noteId: string): Promise<PluginResource[]>;
  read(resourceId: string): Promise<Blob>;
  upload(noteId: string, file: File | Blob): Promise<unknown>;
  update(resourceId: string, patch: Record<string, unknown>): Promise<unknown>;
  rename(resourceId: string, name: string): Promise<unknown>;
  delete(resourceId: string): Promise<unknown>;
}

export interface EditorApi {
  getSelection(): Promise<unknown>;
  replaceSelection(text: string): Promise<unknown>;
  insertAtCursor(text: string): Promise<unknown>;
  getDocument(): Promise<EditorDocument | null>;
  editMarkdown(edits: Array<{ from: number; to: number; insert: string }>): Promise<unknown>;
  insertEmbed(embed: Record<string, unknown>): Promise<unknown>;
}

export interface PanelsApi {
  register(def: PanelDefinition): () => void;
  open(id: string, opts?: Record<string, unknown>): Promise<unknown>;
}

export interface PanelDefinition {
  id: string;
  title: string;
  purpose?: string;
  presentation?: string;
  mount(container: HTMLElement, api: PanelMountApi): (() => void) | void;
  beforeClose?: () => boolean | Record<string, unknown>;
}

export interface PanelMountApi {
  shell: {
    set(config: Record<string, unknown>): void;
  };
  requestClose(): void;
  state?: Record<string, unknown>;
}

export interface UiApi {
  showNotice(message: string): void;
  openNote(noteId: string, opts?: Record<string, unknown>): Promise<unknown>;
  panels: PanelsApi;
}

export interface CommandsApi {
  register(def: CommandDefinition): () => void;
}

export interface CommandDefinition {
  id: string;
  title: string;
  listed?: boolean;
  menu?: boolean;
  run(): void | Promise<void>;
}

export interface PluginContext {
  notes: NotesApi;
  resources: ResourcesApi;
  editor: EditorApi;
  ui: UiApi;
  commands: CommandsApi;
  settings: {
    get<T = unknown>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
    remove(key: string): Promise<void>;
  };
  storage: {
    get<T = unknown>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
    remove(key: string): Promise<void>;
  };
  secrets: {
    get(key: string): Promise<string | undefined>;
    set(key: string, value: string): Promise<void>;
    remove(key: string): Promise<void>;
  };
  network: {
    fetch(url: string, options?: Record<string, unknown>): Promise<NetworkResponse>;
  };
  events: {
    on(event: string, handler: (payload: unknown) => void): () => void;
  };
}
