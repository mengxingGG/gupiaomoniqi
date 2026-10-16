import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AssistantProvider, AssistantSettings } from "@gupiaomoniqi/shared";
import { buildProviderRequest, createStreamAccumulator, parseProviderReply, reasoningOptions, reasoningParameters, type ProviderMessage, type ProviderTool } from "../src/assistant/ProviderCodec.js";
import { normalizeBaseUrl, providerRequest } from "../src/assistant/ProviderTransport.js";
import { parseExaMcp, readWeb, searchWeb } from "../src/assistant/WebSearch.js";

export const settings = (provider: AssistantProvider): AssistantSettings => ({ provider, baseUrl: "https://example.com/v1", model: "test-model", hasKey: true,
  contextTokens: 256000, reasoning: "auto", toolsEnabled: true, claudeThinkingMode: "adaptive", searchProvider: "exa-free", hasSearchKey: false });
const tools: ProviderTool[] = [{ type: "function", function: { name: "quote", description: "读取报价", parameters: { type: "object", properties: { id: { type: "string" } }, required: [] } } }];
const messages: ProviderMessage[] = [{ role: "system", content: "规则" }, { role: "user", content: "查询" }];
const call = { id: "c1", type: "function" as const, function: { name: "quote", arguments: '{"id":"abc"}' } };

describe("provider-specific requests and thinking", () => {
  it.each(["openai-chat", "openai-responses", "deepseek", "anthropic"] as const)("%s auto follows the provider, without an invented auto parameter", provider => {
    expect(reasoningParameters(settings(provider))).toEqual({});
  });
  it("uses distinct output budgets and native effort fields", () => {
    for (const [provider, endpoint, budgetKey] of [["openai-chat", "chat/completions", "max_completion_tokens"], ["deepseek", "chat/completions", "max_tokens"], ["openai-responses", "responses", "max_output_tokens"], ["anthropic", "messages", "max_tokens"]] as const) {
      const request = buildProviderRequest({ ...settings(provider), reasoning: "high" }, messages, tools);
      expect(request.url).toBe(`https://example.com/v1/${endpoint}`);
      expect(request.body).toHaveProperty(budgetKey, 8192);
      if (provider === "deepseek") expect(request.body).toMatchObject({ thinking: { type: "enabled" }, reasoning_effort: "high" });
      if (provider === "openai-responses") expect(request.body).toMatchObject({ reasoning: { effort: "high" }, store: false, tools: [{ type: "function", name: "quote", strict: false }] });
      if (provider === "anthropic") expect(request.body).toMatchObject({ thinking: { type: "adaptive" }, output_config: { effort: "high" }, system: "规则" });
    }
  });
  it("does not send unsupported cross-provider effort values", () => {
    expect(() => reasoningParameters({ ...settings("deepseek"), reasoning: "medium" })).toThrow("不支持");
    expect(reasoningOptions("deepseek")).toEqual(["auto", "none", "low", "high", "max"]);
    expect(reasoningParameters({ ...settings("deepseek"), reasoning: "none" })).toEqual({ thinking: { type: "disabled" } });
    expect(reasoningParameters({ ...settings("anthropic"), claudeThinkingMode: "budget", reasoning: "high" })).toEqual({ thinking: { type: "enabled", budget_tokens: 4096 } });
  });
  it("keeps Responses reasoning and tool call IDs on the next request", () => {
    const output = [{ type: "reasoning", id: "r1", summary: [], encrypted_content: "opaque" }, { type: "function_call", id: "fc1", call_id: "c1", name: "quote", arguments: "{}" }];
    const reply = parseProviderReply("openai-responses", { status: "completed", output });
    const next = buildProviderRequest(settings("openai-responses"), [...messages, reply.message, { role: "tool", tool_call_id: "c1", content: "{}" }], tools);
    expect(next.body).toMatchObject({ input: [{ role: "user", content: "查询" }, ...output, { type: "function_call_output", call_id: "c1", output: "{}" }] });
  });
  it("keeps Claude signed/redacted thinking and groups parallel tool results", () => {
    const content = [{ type: "thinking", thinking: "private", signature: "sig" }, { type: "redacted_thinking", data: "opaque" }, { type: "tool_use", id: "c1", name: "quote", input: {} }, { type: "tool_use", id: "c2", name: "quote", input: {} }];
    const reply = parseProviderReply("anthropic", { content, stop_reason: "tool_use" });
    const next = buildProviderRequest(settings("anthropic"), [...messages, reply.message, ...reply.calls.map(c => ({ role: "tool" as const, tool_call_id: c.id, content: "{}" }))], tools);
    expect(next.body).toMatchObject({ messages: [{ role: "user" }, { role: "assistant", content }, { role: "user", content: [{ type: "tool_result", tool_use_id: "c1" }, { type: "tool_result", tool_use_id: "c2" }] }] });
  });
  it("preserves DeepSeek reasoning during tool loops, without fabricating old reasoning", () => {
    const reply = parseProviderReply("deepseek", { choices: [{ message: { content: "", reasoning_content: "private", tool_calls: [call] } }] });
    const next = buildProviderRequest(settings("deepseek"), [...messages, { role: "assistant", content: "旧答复" }, reply.message], tools);
    expect((next.body as any).messages[2]).toMatchObject({ role: "user", content: expect.stringContaining("旧答复") });
    expect((next.body as any).messages[3].reasoning_content).toBe("private");
  });
  it("rejects truncated or duplicate tool calls before execution", () => {
    expect(() => parseProviderReply("openai-chat", { choices: [{ finish_reason: "length", message: { tool_calls: [call] } }] })).toThrow("截断");
    expect(() => parseProviderReply("deepseek", { choices: [{ message: { tool_calls: [call, call] } }] })).toThrow("格式");
  });
  it.each(["https://example.com", "https://example.com/v1/responses", "https://example.com/v1/messages/", "https://example.com/v1/chat/completions"])("normalizes %s", value => {
    expect(normalizeBaseUrl(value)).toBe("https://example.com/v1");
  });
  it("preserves custom gateway prefixes and rejects credential-bearing URLs", () => {
    expect(normalizeBaseUrl("https://example.com/proxy/v2/messages")).toBe("https://example.com/proxy/v2");
    expect(() => normalizeBaseUrl("https://key@example.com/v1")).toThrow();
    expect(() => normalizeBaseUrl("https://example.com/v1?api_key=secret")).toThrow();
  });
});

describe("HTTP streaming, authentication and failure handling", () => {
  let handler: (req: IncomingMessage, res: ServerResponse) => void;
  const server = createServer((req, res) => handler(req, res));
  let url = "", allowed: string | undefined;
  beforeAll(async () => {
    allowed = process.env.ASSISTANT_ALLOWED_HOSTS; process.env.ASSISTANT_ALLOWED_HOSTS = "127.0.0.1";
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as any).port}`;
  });
  afterAll(async () => {
    if (allowed === undefined) delete process.env.ASSISTANT_ALLOWED_HOSTS; else process.env.ASSISTANT_ALLOWED_HOSTS = allowed;
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  });
  const stream = (events: unknown[]) => { handler = (_req, res) => { res.setHeader("content-type", "text/event-stream"); res.end(events.map(e => `data: ${JSON.stringify(e)}\r\n\r\n`).join("")); }; };
  it("decodes split Chinese UTF-8 and keeps DeepSeek reasoning out of visible text", async () => {
    handler = (_req, res) => {
      res.setHeader("content-type", "text/event-stream");
      const raw = Buffer.from('data: {"choices":[{"delta":{"reasoning_content":"内部思考","content":"中文正文"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
      const cut = raw.indexOf(Buffer.from("中")) + 1;
      res.write(raw.subarray(0, cut)); setTimeout(() => res.end(raw.subarray(cut)), 5);
    };
    const visible: string[] = [];
    const raw = await providerRequest(url, { protocol: "deepseek", onText: text => visible.push(text), body: {} });
    const reply = parseProviderReply("deepseek", raw);
    expect(reply.content).toBe("中文正文"); expect(reply.message.reasoning_content).toBe("内部思考");
    expect(visible).toEqual(["中文正文"]);
  });
  it("assembles Chat tool argument fragments", async () => {
    stream([{ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "quote", arguments: '{"id":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"abc"}' } }] }, finish_reason: "tool_calls" }] }]);
    const reply = parseProviderReply("openai-chat", await providerRequest(url, { body: {} }));
    expect(reply.calls).toEqual([call]);
  });
  it("requires terminal Responses events and uses final authoritative output", async () => {
    stream([{ type: "response.output_text.delta", output_index: 1, content_index: 0, delta: "回复" }, { type: "response.completed", response: { status: "completed", output: [{ type: "reasoning", encrypted_content: "opaque", summary: [] }, { type: "message", content: [{ type: "output_text", text: "回复完成" }] }] } }]);
    const visible: string[] = [];
    const reply = parseProviderReply("openai-responses", await providerRequest(url, { protocol: "openai-responses", body: {}, onText: s => visible.push(s) }));
    expect(reply.content).toBe("回复完成"); expect(visible).toEqual(["回复"]);
    stream([{ type: "response.output_text.delta", output_index: 0, delta: "partial" }]);
    await expect(providerRequest(url, { protocol: "openai-responses", body: {} })).rejects.toThrow("提前中断");
  });
  it("assembles Claude signature and JSON deltas", async () => {
    stream([{ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "private" } },
      { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig" } },
      { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "c1", name: "quote", input: {} } },
      { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"id":' } },
      { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '"abc"}' } },
      { type: "message_delta", delta: { stop_reason: "tool_use" } }, { type: "message_stop" }]);
    const reply = parseProviderReply("anthropic", await providerRequest(url, { protocol: "anthropic", body: {} }));
    expect(reply.calls).toEqual([call]);
    expect(reply.message.anthropicContent?.[0]).toEqual({ type: "thinking", thinking: "private", signature: "sig" });
  });
  it("uses native Claude headers for both models and messages, without a Bearer leak", async () => {
    const headers: IncomingMessage["headers"][] = [];
    handler = (req, res) => { headers.push(req.headers); res.end('{"data":[]}'); };
    await providerRequest(`${url}/models`, { protocol: "anthropic", key: "claude-test-key" });
    await providerRequest(`${url}/messages`, { protocol: "anthropic", key: "claude-test-key", body: {} });
    for (const h of headers) { expect(h["x-api-key"]).toBe("claude-test-key"); expect(h["anthropic-version"]).toBe("2023-06-01"); expect(h.authorization).toBeUndefined(); }
  });
  it("honors errors, malformed streams, and cancellation", async () => {
    stream([{ type: "error", error: { message: "private provider details" } }]);
    await expect(providerRequest(url, { protocol: "anthropic", body: {} })).rejects.toThrow("流式返回错误");
    handler = (_req, res) => { res.statusCode = 429; res.end('key=never-show-me'); };
    await expect(providerRequest(url)).rejects.toThrow("额度");
    const controller = new AbortController(); controller.abort();
    await expect(providerRequest(url, { signal: controller.signal })).rejects.toThrow();
  });
  it("accepts MCP multi-line data frames and ignores notifications", async () => {
    handler = (_req, res) => { res.setHeader("content-type", "text/event-stream"); res.end('event: message\ndata: {"jsonrpc":"2.0",\ndata: "id":"test","result":{"content":[]}}\n\n'); };
    expect(await providerRequest(url, { protocol: "mcp", body: {} })).toMatchObject({ id: "test", result: { content: [] } });
    const stream = createStreamAccumulator("mcp"); stream.consume('{"jsonrpc":"2.0","method":"notification"}');
    expect(() => stream.finish()).toThrow("提前中断");
  });
  it("explains a provider context limit without echoing private error content", async () => {
    handler = (_req, res) => { res.statusCode = 400; res.end('{"error":{"code":"context_length_exceeded","message":"private model details"}}'); };
    await expect(providerRequest(url, { body: {} })).rejects.toThrow("调小上下文");
  });
});

describe("Exa free and API search", () => {
  it("free search uses only the keyless hosted tool and preserves paragraph content", async () => {
    const requests: any[] = [];
    const response = await searchWeb("test", { key: "must-not-send" }, async (url, options) => {
      requests.push({ url, options });
      return { jsonrpc: "2.0", id: (options?.body as any).id, result: { content: [{ type: "text", text: "Title: 官方资料\nURL: https://example.com/1\nHighlights: 第一段\n\n第二段\n\nTitle: 另一来源\nURL: https://example.com/2\nText: 内容" }] } };
    });
    expect(requests).toHaveLength(1); expect(requests[0].url).toBe("https://mcp.exa.ai/mcp");
    expect(requests[0].options.key).toBeUndefined(); expect(requests[0].options.headers).toBeUndefined();
    expect(response.sources).toHaveLength(2); expect(response.sources[0]?.snippet).toContain("第二段");
  });
  it("API search uses a separate x-api-key and bounded result content", async () => {
    const response = await searchWeb("test", { provider: "exa-api", key: "search-only" }, async (url, options) => {
      expect(url).toBe("https://api.exa.ai/search"); expect(options?.headers).toEqual({ "x-api-key": "search-only" }); expect(options?.key).toBeUndefined();
      expect(options?.body).toMatchObject({ numResults: 5, contents: { text: { maxCharacters: 2000 } } });
      return { results: [{ title: "source", url: "https://example.com", text: "a".repeat(4000) }, { title: "bad", url: "javascript:bad()" }] };
    });
    expect(response.sources).toHaveLength(1); expect(response.sources[0]?.snippet.length).toBe(2000);
  });
  it("does not silently switch a rate-limited free search to a paid API", async () => {
    let calls = 0;
    await expect(searchWeb("test", { provider: "exa-free", key: "paid" }, async (_url, options) => {
      calls++; return { jsonrpc: "2.0", id: (options?.body as any).id, result: { isError: true, content: [{ type: "text", text: "Rate limited" }] } };
    })).rejects.toThrow("限额");
    expect(calls).toBe(1);
    await expect(searchWeb("test", { provider: "exa-api" }, async () => { throw new Error("should not call"); })).rejects.toThrow("API Key");
  });
  it("rejects mismatched RPC IDs and unusable results", async () => {
    expect(() => parseExaMcp({ jsonrpc: "2.0", id: "wrong", result: { content: [] } }, "right")).toThrow("协议错误");
    await expect(searchWeb("test", { provider: "exa-api", key: "key" }, async () => ({ results: [] }))).rejects.toThrow("可用来源");
  });
  it.each(["exa-free", "exa-api"] as const)("%s supports real date/domain/category filters for multi-stage research", async provider => {
    const result = await searchWeb("Tencent Holdings 00700 annual report", { provider, key: "paid-only", filters: {
      startPublishedDate: "2025-10-16", endPublishedDate: "2026-10-16", includeDomains: ["tencent.com"], category: "financial report", numResults: 8,
    } }, async (url, options) => {
      const body = options?.body as any, filters = provider === "exa-api" ? body : body.params.arguments;
      expect(filters).toMatchObject({ startPublishedDate: "2025-10-16", endPublishedDate: "2026-10-16", includeDomains: ["tencent.com"], category: "financial report", numResults: 8 });
      const data = { results: [{ title: "财报", url: "https://tencent.com/report", publishedDate: "2026-03-01", text: "披露原文" }] };
      if (provider === "exa-api") return data;
      expect(url).toContain("tools="); expect(body.params.name).toBe("web_search_advanced_exa"); expect(options?.key).toBeUndefined(); expect(options?.headers).toBeUndefined();
      return { jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: JSON.stringify(data) }] } };
    });
    expect(result.sources[0]?.publishedAt).toBe("2026-03-01"); expect(result.sources[0]?.snippet).toBe("披露原文");
  });
  it("rejects invalid date windows before sending a search", async () => {
    let calls = 0;
    for (const filters of [{ startPublishedDate: "2026-02-31" }, { startPublishedDate: "2026-10-01", endPublishedDate: "2026-01-01" }])
      await expect(searchWeb("query", { filters }, async () => { calls++; return {}; })).rejects.toThrow();
    expect(calls).toBe(0);
  });
  it.each(["exa-free", "exa-api"] as const)("%s reads only searched sources and returns bounded original text", async provider => {
    const url = "https://example.com/report", text = "财报内容".repeat(1800);
    const result = await readWeb([url], [url], { provider, key: "api-only" }, async (endpoint, options) => {
      const body = options?.body as any;
      if (provider === "exa-api") { expect(endpoint).toBe("https://api.exa.ai/contents"); expect(body).toEqual({ urls: [url], text: { maxCharacters: 6000 } }); return { results: [{ url, title: "报告", text }] }; }
      expect(body.params).toEqual({ name: "web_fetch_exa", arguments: { urls: [url], maxCharacters: 6000 } }); expect(options?.headers).toBeUndefined();
      return { jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: `# 报告\nURL: ${url}\n\n${text}` }] } };
    });
    expect(result.sources[0]?.snippet.length).toBe(6000); expect(result.notice).toContain("可能不完整");
    await expect(readWeb(["https://not-searched.example"], [url], { provider }, async () => { throw new Error("must not fetch"); })).rejects.toThrow("请先搜索");
  });
});
