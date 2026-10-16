import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { AssistantProvider, AssistantSession } from "@gupiaomoniqi/shared";
import { AssistantService } from "../src/assistant/AssistantService.js";
import { buildContext, contextMessages } from "../src/assistant/ContextManager.js";
import { AssistantStore } from "../src/assistant/AssistantStore.js";
import type { ProviderRequestOptions } from "../src/assistant/ProviderTransport.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
function directory() {
  const dir = mkdtempSync(join(tmpdir(), "gupiaomoniqi-assistant-"));
  cleanups.push(async () => { rmSync(dir, { recursive: true, force: true }); });
  return dir;
}
async function harness(dir: string, transport: (url: string, options?: ProviderRequestOptions) => Promise<unknown>, read = async () => ({ value: 42 })) {
  const service = new AssistantService(dir, { read }, transport);
  const app = Fastify(); service.register(app, req => req.headers.authorization === "Bearer account-test" ? "account" : undefined);
  await app.ready(); cleanups.push(async () => { await service.close(); await app.close(); });
  const request = async (method: "GET" | "POST" | "PATCH" | "DELETE", path: string, payload?: unknown) => {
    const response = await app.inject({ method, url: `/api/assistant${path}`, headers: { authorization: "Bearer account-test" }, ...(payload === undefined ? {} : { payload: JSON.stringify(payload), headers: { authorization: "Bearer account-test", "content-type": "application/json" } }) });
    return { status: response.statusCode, data: response.json().data, raw: response.json() };
  };
  return { app, service, request };
}
async function waitDone(service: AssistantService, id: string) {
  for (let i = 0; i < 100; i++) {
    const session = service.session("account", id);
    if (session.task?.status !== "running") return session;
    await new Promise(r => setTimeout(r, 5));
  }
  throw new Error("assistant job did not finish");
}
function response(provider: AssistantProvider, tool: boolean, text = "最终答复") {
  if (provider === "openai-responses") return { status: "completed", output: [{ type: "reasoning", id: `reason-${tool}`, summary: [], encrypted_content: "opaque-reasoning" },
    tool ? { type: "function_call", id: "fc1", call_id: "c1", name: "market_quote", arguments: "{}" } : { type: "message", role: "assistant", content: [{ type: "output_text", text }] }] };
  if (provider === "anthropic") return { stop_reason: tool ? "tool_use" : "end_turn", content: [{ type: "thinking", thinking: "private-reasoning", signature: "signature" },
    tool ? { type: "tool_use", id: "c1", name: "market_quote", input: {} } : { type: "text", text }] };
  return { choices: [{ finish_reason: tool ? "tool_calls" : "stop", message: { content: tool ? "" : text, reasoning_content: "private-reasoning",
    ...(tool ? { tool_calls: [{ id: "c1", type: "function", function: { name: "market_quote", arguments: "{}" } }] } : {}) } }] };
}

describe("assistant protocols, persistence and permission defaults", () => {
  it("respects market permission and keeps local snapshot hints as bounded lookup data", async () => {
    const requests: any[] = [];
    const h = await harness(directory(), async (_url, options) => { requests.push(options?.body); return response("openai-chat", false); });
    h.service.store.change("account", s => { s.settings.model = "test"; });
    for (const enabled of [true, false]) {
      const id = (await h.request("POST", "/sessions", { mode: "REAL", market: enabled, watchlist: false })).data.id;
      await h.request("POST", `/sessions/${id}/messages`, { content: "查看苹果", requestId: randomUUID(), snapshotHints: { mode: "REAL", ids: ["us-aapl"], syncedAt: "2026-10-16T00:00:00Z" } });
      await waitDone(h.service, id);
      const body = requests.at(-1), names = body.tools.map((t: any) => t.function.name);
      expect(names.includes("market_scan")).toBe(enabled); expect(names.includes("market_detail")).toBe(enabled);
      expect(names).not.toContain("watchlist"); expect(names).not.toContain("approve");
      expect(JSON.stringify(body.messages).includes("App近7天本地快照索引")).toBe(enabled);
    }
  });
  it("deletes with explicit JSON and keeps the deletion after restart", async () => {
    const dir = directory(), h = await harness(dir, async () => ({}));
    const id = (await h.request("POST", "/sessions", { mode: "REAL" })).data.id;
    const malformed = await h.app.inject({ method: "DELETE", url: `/api/assistant/sessions/${id}`,
      headers: { authorization: "Bearer account-test", "content-type": "application/x-www-form-urlencoded" }, payload: "" });
    expect(malformed.statusCode).toBe(415); expect(h.service.session("account", id)).toBeDefined();
    expect((await h.request("DELETE", `/sessions/${id}`, {})).data).toEqual({ deleted: true });
    const restarted = await harness(dir, async () => ({}));
    expect((await restarted.request("GET", "")).data.sessions).toEqual([]);
  });
  it.each(["openai-chat", "openai-responses", "deepseek", "anthropic"] as const)("%s tool round trip and restart preserve protocol continuity privately", async provider => {
    const dir = directory(), requests: any[] = [];
    let count = 0, reads = 0;
    const transport = async (_url: string, options?: ProviderRequestOptions) => { requests.push(options); return response(provider, count++ === 0); };
    const first = await harness(dir, transport, async () => { reads++; return { value: 42 }; });
    first.service.store.change("account", state => { state.settings = { ...state.settings, provider, model: "test-model" }; });
    const created = await first.request("POST", "/sessions", { mode: "REAL" });
    const id = created.data.id;
    expect(created.data.scope).toMatchObject({ portfolio: true, transactions: true, watchlist: true, web: true });
    expect((await first.request("POST", `/sessions/${id}/messages`, { content: "报价", requestId: randomUUID() })).status).toBe(200);
    expect((await waitDone(first.service, id)).task?.status).toBe("complete"); expect(reads).toBe(1);
    expect(JSON.stringify((await first.request("GET", "")).data)).not.toMatch(/private-reasoning|opaque-reasoning|signature|continuations/);
    const state = first.service.store.read("account");
    expect(Object.values(state.continuations)).toHaveLength(1);
    expect(JSON.stringify(state.continuations)).not.toMatch(/private-reasoning|opaque-reasoning/);
    await first.service.close();
    const second = await harness(dir, transport);
    await second.request("POST", `/sessions/${id}/messages`, { content: "继续", requestId: randomUUID() });
    expect((await waitDone(second.service, id)).task?.status).toBe("complete");
    const continued = requests[2].body;
    if (provider === "deepseek") {
      expect(continued.messages.filter((m: any) => m.role === "assistant").every((m: any) => m.reasoning_content === "private-reasoning")).toBe(true);
      expect(continued.messages.some((m: any) => m.role === "tool" && m.tool_call_id === "c1")).toBe(true);
    }
    if (provider === "openai-responses") expect(continued.input).toEqual(expect.arrayContaining([expect.objectContaining({ encrypted_content: "opaque-reasoning" }), expect.objectContaining({ type: "function_call_output", call_id: "c1" })]));
    if (provider === "anthropic") expect(JSON.stringify(continued.messages)).toContain('"signature":"signature"');
    await second.request("DELETE", `/sessions/${id}`);
    expect(second.service.store.read("account").continuations).toEqual({});
  });
  it("normalizes protocol-specific efforts on switches and keeps search/model keys separate", async () => {
    const requests: any[] = [];
    const h = await harness(directory(), async (url, options) => { requests.push({ url, options }); return { data: [] }; });
    const initial = (await h.request("GET", "")).data.settings;
    const saved = await h.request("PATCH", "/settings", { ...initial, baseUrl: "https://api.deepseek.com", provider: "deepseek", model: "test", reasoning: "medium", apiKey: "model-secret" });
    expect(saved.data.provider).toBe("deepseek"); expect(saved.data.reasoning).toBe("auto"); expect(saved.data.baseUrl).toBe("https://api.deepseek.com/v1");
    expect((await h.request("PATCH", "/settings", { ...saved.data, reasoning: "minimal" })).status).toBe(400);
    await h.request("PATCH", "/search-settings", { provider: "exa-api", apiKey: "search-secret" });
    await h.request("POST", "/models", {});
    expect(requests[0].options.key).toBe("model-secret");
    expect(JSON.stringify((await h.request("GET", "")).data)).not.toMatch(/model-secret|search-secret/);
    const state = h.service.store.read("account");
    expect(h.service.store.decrypt(state.searchSecret)).toBe("search-secret");
    // 旧版客户端不携带新增字段时，不把现有接口和搜索选择改回默认。
    const { provider: _p, claudeThinkingMode: _m, searchProvider: _s, hasSearchKey: _k, ...old } = state.settings;
    expect((await h.request("PATCH", "/settings", old)).data.provider).toBe("deepseek");
    await h.request("PATCH", "/settings", { ...state.settings, baseUrl: "https://another.example/v1" });
    expect(h.service.store.read("account").secret).toBe("");
    expect(h.service.store.decrypt(h.service.store.read("account").searchSecret)).toBe("search-secret");
  });
  it("explicit disabled permissions remain disabled despite permissive defaults", async () => {
    let reads = 0, count = 0;
    const h = await harness(directory(), async (_url, options) => {
      const body = options?.body as any;
      expect(body.tools.some((t: any) => ["portfolio", "transactions", "watchlist", "web_search", "web_read"].includes(t.function.name))).toBe(false);
      if (count++ === 0) return { choices: [{ message: { tool_calls: [{ id: "c1", type: "function", function: { name: "portfolio", arguments: "{}" } }] } }] };
      expect(body.messages.at(-1).content).toContain("未获授权"); return response("openai-chat", false);
    }, async () => { reads++; return {}; });
    h.service.store.change("account", s => { s.settings.model = "test"; });
    const id = (await h.request("POST", "/sessions", { mode: "VIRTUAL", portfolio: false, transactions: false, watchlist: false, web: false })).data.id;
    await h.request("POST", `/sessions/${id}/messages`, { content: "读取持仓", requestId: randomUUID() });
    expect((await waitDone(h.service, id)).task?.status).toBe("complete"); expect(reads).toBe(0);
    expect((await h.app.inject({ method: "GET", url: "/api/assistant" })).statusCode).toBe(401);
  });
  it("default web tool calls the selected Exa route and exposes only real returned sources", async () => {
    let modelCount = 0;
    const h = await harness(directory(), async (url, options) => {
      if (url === "https://mcp.exa.ai/mcp") return { jsonrpc: "2.0", id: (options?.body as any).id, result: { content: [{ type: "text", text: "Title: 来源\nURL: https://example.com/news\nText: 实际检索结果" }] } };
      if (modelCount++ === 0) return { choices: [{ message: { tool_calls: [{ id: "web1", type: "function", function: { name: "web_search", arguments: '{"query":"test"}' } }] } }] };
      expect((options?.body as any).messages.at(-1).content).toContain("实际检索结果"); return response("openai-chat", false);
    });
    h.service.store.change("account", s => { s.settings.model = "test"; });
    const id = (await h.request("POST", "/sessions", { mode: "VIRTUAL" })).data.id;
    await h.request("POST", `/sessions/${id}/messages`, { content: "搜索", requestId: randomUUID() });
    const session = await waitDone(h.service, id);
    expect(session.task?.status).toBe("complete"); expect(session.messages.at(-1)?.sources).toEqual([{ title: "来源", url: "https://example.com/news" }]);
  });
  it("migrates old state and removes the obsolete model capacity without silently trimming history", () => {
    const dir = directory(), store = new AssistantStore(dir);
    store.change("account", s => { s.settings.model = "test"; });
    const folder = readdirSync(dir).find(name => name !== "master.key")!;
    const path = join(dir, folder, "state.json"), saved = JSON.parse(readFileSync(path, "utf8"));
    delete saved.settings.provider; delete saved.settings.searchProvider; delete saved.continuations; delete saved.searchSecret;
    saved.settings.modelContextTokens = 32000;
    writeFileSync(path, JSON.stringify(saved));
    expect(store.read("account").settings).toMatchObject({ provider: "openai-chat", searchProvider: "exa-free", reasoning: "auto" });
    expect(store.read("account").settings).not.toHaveProperty("modelContextTokens");
    const session: AssistantSession = { id: "session", title: "", pinned: false, scope: { mode: "REAL", portfolio: false, transactions: false, watchlist: false, web: false }, updatedAt: "",
      messages: [{ id: "old-user", role: "user", content: "old", createdAt: "" }, { id: "old-assistant", role: "assistant", content: "old answer", createdAt: "" }, { id: "new", role: "user", content: "new", createdAt: "" }] };
    const context = buildContext("rules", "", session, store.read("account").settings, { "old-assistant": [{ role: "assistant", content: "x".repeat(35000) }, { role: "tool", tool_call_id: "old", content: "result" }] });
    expect(context.window).toBe(256000); expect(context.compacted).toBe(false);
    expect(contextMessages(context).at(-1)?.content).toBe("new");
    expect(contextMessages(context).some(m => m.role === "tool")).toBe(true);
  });
  it.each(["openai-chat", "openai-responses", "deepseek", "anthropic"] as const)("%s automatically summarizes within the same session and persists a private checkpoint", async provider => {
    const dir = directory(); let summaries = 0;
    const transport = async (_url: string, options?: ProviderRequestOptions) => {
      const body = options?.body as any;
      if (JSON.stringify(body).includes("你负责压缩会话上下文")) {
        summaries++; expect(body.tools).toBeUndefined(); return response(provider, false, "保留目标：比较腾讯，尚待最新报价。");
      }
      expect(JSON.stringify(body)).toContain("保留目标：比较腾讯");
      expect(JSON.stringify(body)).not.toContain("old-data-old-data-old-data");
      return response(provider, false);
    };
    const h = await harness(dir, transport);
    h.service.store.change("account", s => { s.settings = { ...s.settings, provider, model: "test", contextTokens: 32000 }; });
    const id = (await h.request("POST", "/sessions", { mode: "REAL" })).data.id;
    h.service.store.change("account", s => { s.sessions[0].messages = [{ id: "old-u", role: "user", content: "比较腾讯", createdAt: "" },
      { id: "old-a", role: "assistant", content: "old-data-".repeat(3000), createdAt: "" }]; });
    await h.request("POST", `/sessions/${id}/messages`, { content: "继续分析", requestId: randomUUID() });
    const done = await waitDone(h.service, id);
    expect(done.task).toMatchObject({ status: "complete", effectiveWindow: 32000, compacted: true });
    expect(done.messages).toHaveLength(4); expect(done.messages[1].content).toContain("old-data-");
    expect(summaries).toBeGreaterThan(0);
    const state = h.service.store.read("account");
    expect(state.contextSummaries[id].throughMessageId).toBe("old-a");
    expect(state.contextSummaries[id].payload).not.toContain("保留目标");
    expect(JSON.stringify((await h.request("GET", "")).data)).not.toContain("contextSummaries");
    const prior = summaries;
    const restarted = await harness(dir, transport);
    await restarted.request("POST", `/sessions/${id}/messages`, { content: "再继续", requestId: randomUUID() });
    expect((await waitDone(restarted.service, id)).task?.status).toBe("complete"); expect(summaries).toBe(prior);
    await restarted.request("DELETE", `/sessions/${id}`);
    expect(restarted.service.store.read("account").contextSummaries).toEqual({});
  });
  it("the selected context is the only effective window, including legacy client payloads", async () => {
    const h = await harness(directory(), async () => response("openai-chat", false));
    const settings = (await h.request("GET", "")).data.settings;
    for (const contextTokens of [32000, 64000, 128000, 256000, 512000, 1000000]) {
      const saved = await h.request("PATCH", "/settings", { ...settings, model: "test", contextTokens, modelContextTokens: 32000 });
      expect(saved.data.contextTokens).toBe(contextTokens); expect(saved.data).not.toHaveProperty("modelContextTokens");
      const id = (await h.request("POST", "/sessions", { mode: "REAL" })).data.id;
      await h.request("POST", `/sessions/${id}/messages`, { content: "继续", requestId: randomUUID() });
      expect((await waitDone(h.service, id)).task?.effectiveWindow).toBe(contextTokens);
    }
  });
});
