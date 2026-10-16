import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AssistantMemory, AssistantSession, AssistantSettings } from "@gupiaomoniqi/shared";

interface AccountState {
  settings: AssistantSettings;
  secret: string;
  searchSecret: string;
  // 协议续接信息加密保存，不随公开会话接口返回。
  continuations: Record<string, { fingerprint: string; payload: string }>;
  contextSummaries: Record<string, { throughMessageId: string; payload: string }>;
  memoryEnabled: boolean;
  memoryEpoch: number;
  sessions: AssistantSession[];
}
const defaults: AssistantSettings = { provider: "openai-chat", baseUrl: "https://api.openai.com/v1", model: "", hasKey: false,
  contextTokens: 256000, reasoning: "auto", toolsEnabled: true,
  claudeThinkingMode: "adaptive", searchProvider: "exa-free", hasSearchKey: false };

export class AssistantError extends Error {
  constructor(message: string, readonly statusCode = 400) { super(message); }
}

/** 所有读改写都在同一进程同步完成；网络请求不得夹在存储事务内。 */
export class AssistantStore {
  private readonly key: Buffer;
  constructor(readonly directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const keyPath = join(directory, "master.key");
    if (!existsSync(keyPath)) {
      try { writeFileSync(keyPath, randomBytes(32), { flag: "wx", mode: 0o600 }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    }
    this.key = readFileSync(keyPath);
    if (this.key.length !== 32) throw new Error("助手存储密钥格式不正确");
  }
  private folder(accountId: string) {
    const folder = join(this.directory, createHash("sha256").update(accountId).digest("hex"));
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    return folder;
  }
  private atomic(path: string, text: string) {
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, text, { mode: 0o600 });
    renameSync(tmp, path);
  }
  read(id: string): AccountState {
    const file = join(this.folder(id), "state.json");
    if (!existsSync(file)) return { settings: { ...defaults }, secret: "", searchSecret: "", continuations: {}, contextSummaries: {}, memoryEnabled: true, memoryEpoch: 0, sessions: [] };
    const state = JSON.parse(readFileSync(file, "utf8")) as AccountState;
    // 旧版的容量上限不再生效，用户选择的窗口是唯一预算。
    const { modelContextTokens: _legacyCapacity, ...settings } = state.settings as AssistantSettings & { modelContextTokens?: number };
    return { ...state, settings: { ...defaults, ...settings }, searchSecret: state.searchSecret ?? "", continuations: state.continuations ?? {}, contextSummaries: state.contextSummaries ?? {} };
  }
  change<T>(id: string, fn: (state: AccountState) => T): T {
    const state = this.read(id);
    const result = fn(state);
    const retained = new Set(state.sessions.flatMap(s => s.messages.map(m => m.id)));
    for (const id of Object.keys(state.continuations)) if (!retained.has(id)) delete state.continuations[id];
    const sessions = new Set(state.sessions.map(s => s.id));
    for (const id of Object.keys(state.contextSummaries)) if (!sessions.has(id)) delete state.contextSummaries[id];
    this.atomic(join(this.folder(id), "state.json"), JSON.stringify(state));
    return result;
  }
  encrypt(secret: string) {
    if (!secret) return "";
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const value = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), value]).toString("base64");
  }
  decrypt(secret: string) {
    if (!secret) return "";
    const data = Buffer.from(secret, "base64");
    const decipher = createDecipheriv("aes-256-gcm", this.key, data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8");
  }
  memory(id: string): AssistantMemory {
    const path = join(this.folder(id), "memory.md");
    const text = existsSync(path) ? readFileSync(path, "utf8") : "";
    const state = this.read(id);
    return { text, enabled: state.memoryEnabled,
      revision: createHash("sha256").update(`${state.memoryEpoch}:${text}`).digest("hex"),
      canUndo: existsSync(join(this.folder(id), "memory.previous.md")) && readFileSync(join(this.folder(id), "memory.previous.md"), "utf8") !== "" };
  }
  updateMemory(id: string, text: string, revision: string, enabled?: boolean, undo = false) {
    const current = this.memory(id);
    if (revision !== current.revision) throw new AssistantError("记忆已被更新，请刷新后再保存", 409);
    const previous = join(this.folder(id), "memory.previous.md");
    const next = (undo && existsSync(previous) ? readFileSync(previous, "utf8") : text).replace(/\r\n?/g, "\n");
    if ([...next].length > 3000) throw new AssistantError("记忆最多 3000 个字符，请精简后保存");
    // 清空同时清除撤销副本，防止已忘记的内容被恢复。
    this.atomic(previous, next ? current.text : "");
    this.atomic(join(this.folder(id), "memory.md"), next);
    this.change(id, s => { s.memoryEpoch++; if (enabled !== undefined) s.memoryEnabled = enabled; });
    return this.memory(id);
  }
}
