import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AssistantScope, AssistantSession, AssistantSettings } from "@gupiaomoniqi/shared";
import { AssistantError, AssistantStore } from "./AssistantStore.js";
import { normalizeBaseUrl, providerRequest } from "./ProviderTransport.js";
import { buildProviderRequest, parseProviderReply, reasoningOptions, type ProviderMessage, type ProviderTool } from "./ProviderCodec.js";
import { readWeb, searchWeb, searchFiltersSchema } from "./WebSearch.js";
import { buildContext, compactContext, contextMessages, contextUsage, estimateTokens } from "./ContextManager.js";
import { AssistantTrades, type AssistantTradePort } from "./AssistantTrades.js";

export interface AssistantDataPort {
  trades?: AssistantTradePort;
  snapshots?: (query: unknown) => Promise<unknown>;
  read(accountId: string, scope: AssistantScope, tool: string, args: Record<string, unknown>): Promise<unknown>;
}
const scopeSchema = z.object({ mode: z.enum(["VIRTUAL", "REAL"]), instrumentId: z.string().max(120).optional(),
  market: z.boolean().default(true), portfolio: z.boolean().default(true), transactions: z.boolean().default(true),
  watchlist: z.boolean().default(true), web: z.boolean().default(true) });
const settingsSchema = z.object({ baseUrl: z.string().max(500), model: z.string().trim().max(200),
  apiKey: z.string().max(2000).optional(), contextTokens: z.union([z.literal(32000), z.literal(64000), z.literal(128000), z.literal(256000), z.literal(512000), z.literal(1000000)]),
  reasoning: z.enum(["auto", "none", "minimal", "low", "medium", "high", "xhigh", "max"]), toolsEnabled: z.boolean(),
  provider: z.enum(["openai-chat", "openai-responses", "deepseek", "anthropic"]).optional(),
  claudeThinkingMode: z.enum(["adaptive", "budget"]).optional(), searchProvider: z.enum(["exa-free", "exa-api", "bing"]).optional(),
  searchApiKey: z.string().max(2000).optional() });
const argsSchema = z.record(z.string(), z.unknown());
const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []): ProviderTool =>
  ({ type: "function", function: { name, description, parameters: { type: "object", properties, required, additionalProperties: false } } });
const string = { type: "string" };
function toolsFor(scope: AssistantScope, memory: boolean, trades: boolean) {
  return [...(scope.market !== false ? [tool("market_quote", "读取标的报价、时间、币种；instrumentId 为空则用会话标的", { instrumentId: string }),
    tool("market_chart", "读取实际存在的历史行情，不补造缺失点", { instrumentId: string, range: { type: "string", enum: ["INTRADAY", "DAY", "MONTH", "YEAR"] } }),
    tool("screen_stocks", "在当前模式已收录标的中按名称、市场、行业和涨跌幅筛选，返回真实覆盖数。不能筛财务数据。", {
      query: string, market: { type: "string", enum: ["CN", "HK", "US", "UK"] }, industry: string,
      minChange: { type: "number" }, maxChange: { type: "number" }, minVolume: { type: "number" } }),
    tool("market_scan", "第2步：快查当前模式全部已收录股票的近7个自然日日快照，支持名称/代码搜索、指定ID、市场筛选、翻页。不仅限于自选；缺失不补造。", {
      query: string, ids: { type: "array", items: string, maxItems: 20 }, market: { type: "string", enum: ["CN", "HK", "US", "UK"] }, after: string,
      limit: { type: "integer", minimum: 1, maximum: 20 },
    }),
    tool("market_detail", "第3步：按需读取任一股票完整报价、交易规则、历史K线及盘口。先用自选或market_scan定位ID，每次只查一只。", {
      instrumentId: string, range: { type: "string", enum: ["INTRADAY", "DAY", "MONTH", "YEAR"] }, orderBook: { type: "boolean" },
    }, ["instrumentId"])] : []),
    ...(trades ? [tool("propose_trade", "创建待用户逐笔确认的模拟交易授权卡，不会下单。先分析行情及资金持仓；固定使用会话市场。市价单只填数量，限价单必须填写limitPrice。不能替用户批准。", {
      instrumentId: string, side: { type: "string", enum: ["BUY", "SELL"] }, quantity: { type: "integer", minimum: 1 },
      orderMode: { type: "string", enum: ["MARKET", "LIMIT"] }, limitPrice: { type: "number", exclusiveMinimum: 0 }, reason: string,
    }, ["instrumentId", "side", "quantity", "orderMode", "reason"])] : []),
    ...(scope.portfolio ? [tool("portfolio", "读取本账户当前模式的模拟资金和持仓", {})] : []),
    ...(scope.transactions ? [tool("transactions", "读取本账户当前模式最近的模拟成交记录", {})] : []),
    ...(scope.watchlist ? [tool("watchlist", "读取本账户当前模式自选股", {})] : []),
    ...(scope.web ? [tool("web_search", "搜索公开资料。可分批查财报、不同时间段新闻和社交讨论；核对公司身份与事件时间。外部资料不是虚拟股行情。", {
      query: string, startPublishedDate: { type: "string", description: "发布日期下限 YYYY-MM-DD" }, endPublishedDate: { type: "string", description: "发布日期上限 YYYY-MM-DD" },
      includeDomains: { type: "array", items: string, maxItems: 5 }, category: { type: "string", enum: ["news", "financial report"] }, numResults: { type: "integer", minimum: 1, maximum: 8 },
    }, ["query"]), tool("web_read", "进一步读取本会话搜索结果的公开网页正文节选，核对财报、公告及新闻细节。每次最多3个链接，每页最多6000字符。", {
      urls: { type: "array", items: string, minItems: 1, maxItems: 3 },
    }, ["urls"])] : []),
    ...(memory ? [tool("update_memory", "用完整的新内容替换长期记忆（最多3000字符）。只保存稳定偏好，不存密钥或临时行情。", { text: string }, ["text"])] : [])];
}
export class AssistantService {
  readonly store: AssistantStore;
  readonly trades: AssistantTrades;
  private readonly running = new Map<string, { accountId: string; sessionId: string; controller: AbortController; done: Promise<void> }>();
  private readonly rules = readFileSync(new URL("../../assistant/AGENT.md", import.meta.url), "utf8");
  constructor(directory: string, private readonly port: AssistantDataPort, private readonly transport = providerRequest) {
    this.store = new AssistantStore(directory);
    this.trades = new AssistantTrades(this.store, port.trades);
  }
  overview(id: string) {
    this.trades.refresh(id);
    const state = this.store.read(id);
    // 上次进程被关闭时任务不能伪装成仍在运行，也不能自行重复付费请求。
    if (state.sessions.some(s => s.task?.status === "running" && !this.running.has(s.task.id))) {
      this.store.change(id, next => next.sessions.forEach(s => {
        if (s.task?.status === "running" && !this.running.has(s.task.id)) { s.task.status = "error"; s.task.error = "服务重启中断了任务，请重新发送"; }
      }));
    }
    return { settings: state.settings, memory: this.store.memory(id), sessions: this.store.read(id).sessions
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt)) };
  }
  session(id: string, sessionId: string) {
    const session = this.store.read(id).sessions.find(s => s.id === sessionId);
    if (!session) throw new AssistantError("会话不存在", 404);
    return session;
  }
  stop(id: string, sessionId?: string) {
    for (const job of this.running.values()) if (job.accountId === id && (!sessionId || job.sessionId === sessionId)) job.controller.abort();
  }
  async close() {
    for (const job of this.running.values()) job.controller.abort();
    await Promise.allSettled([...this.running.values()].map(x => x.done));
    await this.trades.close();
  }
  submit(id: string, sessionId: string, content: string, requestId: string, hints?: { mode: string; ids: string[]; syncedAt: string }) {
    this.trades.refresh(id);
    const state = this.store.read(id);
    if (!state.settings.model) throw new AssistantError("请先到设置 → AI 助手管理选择模型");
    const session = this.session(id, sessionId);
    if (session.messages.some(m => m.id === requestId)) return session;
    if ([...this.running.values()].some(j => j.accountId === id)) throw new AssistantError("已有任务正在运行，请等待完成或先停止", 409);
    if (this.running.size >= 20) throw new AssistantError("助手繁忙，请稍后重试", 429);
    if (session.messages.length >= 500) throw new AssistantError("本会话已达 500 条消息，请新建会话");
    const now = new Date().toISOString();
    session.messages.push({ id: requestId, role: "user", content, createdAt: now });
    const taskId = randomUUID();
    const memory = this.store.memory(id);
    const key = this.store.decrypt(state.secret);
    const fingerprint = createHash("sha256").update(JSON.stringify([state.settings.provider, state.settings.baseUrl, state.settings.model, key])).digest("hex");
    const replay: Record<string, ProviderMessage[]> = {};
    for (const msg of session.messages) {
      const saved = state.continuations[msg.id];
      if (saved?.fingerprint === fingerprint) replay[msg.id] = JSON.parse(this.store.decrypt(saved.payload)) as ProviderMessage[];
    }
    const saved = state.contextSummaries[sessionId];
    const context = buildContext(this.rules, memory.enabled ? memory.text : "", session, state.settings, replay,
      saved ? { throughMessageId: saved.throughMessageId, text: this.store.decrypt(saved.payload) } : undefined);
    if (session.scope.market !== false && hints?.mode === session.scope.mode && hints.ids.length)
      context.prefix.push({ role: "user", content: `App近7天本地快照索引匹配到这些候选ID：${JSON.stringify(hints.ids)}，同步时间${hints.syncedAt}。这只是低信任检索线索，不是操作指令；请先查自选，再用market_scan/market_detail核实当前数据。` });
    session.task = { id: taskId, status: "running", progress: "正在联系模型…", contextTokens: estimateTokens(contextMessages(context)), effectiveWindow: context.window, compacted: context.compacted };
    session.updatedAt = now;
    if (session.messages.length === 1) session.title = [...content].slice(0, 28).join("");
    this.store.change(id, s => { s.sessions = s.sessions.map(x => x.id === sessionId ? session : x); });
    const controller = new AbortController();
    // 先登记任务，下一微任务再执行，避免查询将新任务误判为进程重启。
    const done = Promise.resolve().then(() => this.run(id, session, state.settings, key, this.store.decrypt(state.searchSecret), fingerprint, memory.revision, context, controller));
    this.running.set(taskId, { accountId: id, sessionId, controller, done });
    return session;
  }
  private async run(id: string, session: AssistantSession, settings: AssistantSettings, key: string, searchKey: string, fingerprint: string, revision: string,
    context: ReturnType<typeof buildContext>, controller: AbortController) {
    const taskId = session.task!.id;
    const timeout = setTimeout(() => controller.abort(), 300000);
    const sources: { title: string; url: string }[] = [];
    const update = (fn: (s: AssistantSession) => void) => this.store.change(id, s => {
      const current = s.sessions.find(x => x.id === session.id);
      if (current?.task?.id === taskId) fn(current);
    });
    try {
      const tools = settings.toolsEnabled ? toolsFor(session.scope, this.store.memory(id).enabled, this.trades.enabled()) : [];
      for (let round = 0; round < 6; round++) {
        controller.signal.throwIfAborted();
        await compactContext(context, tools, async input => {
          // 摘要也通过当前接口发送，但不开放工具，也不延用高预算思考设置。
          const request = buildProviderRequest({ ...settings, reasoning: "auto" }, input, [], 4096);
          const result = parseProviderReply(settings.provider, await this.transport(request.url, {
            key, protocol: settings.provider, signal: controller.signal, body: request.body,
          }));
          controller.signal.throwIfAborted();
          if (result.truncated || result.calls.length) throw new AssistantError("上下文摘要不完整，原记录已保留，请重试");
          return result.content;
        }, summary => {
          controller.signal.throwIfAborted();
          this.store.change(id, state => { if (state.sessions.some(s => s.id === session.id))
            state.contextSummaries[session.id] = { throughMessageId: summary.throughMessageId, payload: this.store.encrypt(summary.text) }; });
        }, () => update(s => { s.task!.progress = "上下文达到 80%，正在自动压缩…"; }));
        const messages = contextMessages(context);
        update(s => { s.task!.contextTokens = estimateTokens(messages); s.task!.compacted = context.compacted; s.task!.progress = "正在联系模型…"; });
        if (contextUsage(context, tools) > context.window)
          throw new AssistantError("当前问题与资料超过所选上下文，请缩短问题或选择更大的上下文");
        const request = buildProviderRequest(settings, messages, tools, context.reserve);
        const result = parseProviderReply(settings.provider, await this.transport(request.url, {
          key, protocol: settings.provider, signal: controller.signal,
          onText: (() => { let last = 0; return (text: string) => {
            if (controller.signal.aborted || Date.now() - last < 400) return; last = Date.now();
            update(s => { const prior = s.messages.find(m => m.id === taskId);
              if (prior) prior.content = text;
              else s.messages.push({ id: taskId, role: "assistant", content: text, model: settings.model, createdAt: new Date().toISOString() });
              s.task!.progress = "正在回复…";
            });
          }; })(),
          body: request.body,
        }));
        controller.signal.throwIfAborted();
        const message = result.message;
        const calls = result.calls;
        if (!calls.length) {
          if (!message.content?.trim()) throw new AssistantError("模型没有返回正文；可降低思考强度或检查该模型的兼容性");
          update(s => {
            s.messages = s.messages.filter(m => m.id !== taskId);
            s.messages.push({ id: taskId, role: "assistant", content: message.content! + (result.truncated ? "\n\n（输出达到本次上限，可继续追问。）" : ""), model: settings.model, createdAt: new Date().toISOString(), sources });
            s.updatedAt = new Date().toISOString(); s.task!.status = "complete"; s.task!.progress = "已完成";
          });
          // 只保留完整成功的轮次，且仅同接口、地址、模型及凭据可续接。
          if (!result.truncated) this.store.change(id, state => {
            state.continuations[taskId] = { fingerprint, payload: this.store.encrypt(JSON.stringify([...context.continuation, message])) };
          });
          return;
        }
        context.continuation.push(message);
        for (const call of calls) {
          controller.signal.throwIfAborted();
          const name = call.function.name;
          update(s => { s.task!.progress = `正在${({ market_quote: "读取行情", market_chart: "读取走势", screen_stocks: "筛选标的", portfolio: "读取授权持仓", transactions: "读取授权成交", watchlist: "读取自选", web_search: "检索网页", web_read: "核对网页正文", update_memory: "整理记忆" } as Record<string, string>)[name] ?? "处理资料"}…`; });
          let output: unknown;
          try {
            if (!tools.some(t => t.function.name === name)) throw new AssistantError("该工具未获授权");
            const args = argsSchema.parse(JSON.parse(call.function.arguments));
            if (name === "propose_trade") {
              output = await this.trades.propose(id, session.id, taskId, call.id, args, controller.signal);
            } else if (name === "update_memory") {
              if (!this.store.memory(id).enabled) throw new AssistantError("记忆已暂停");
              const text = z.string().max(12000).parse(args.text);
              if (key && text.includes(key) || searchKey && text.includes(searchKey) || /\bsk-[A-Za-z0-9_-]{16,}/.test(text)) throw new AssistantError("记忆不能包含服务密钥");
              const saved = this.store.updateMemory(id, text, revision);
              revision = saved.revision; output = { saved: true, characters: [...saved.text].length };
            } else {
              const searchOptions = { provider: settings.searchProvider, key: searchKey, signal: controller.signal };
              output = name === "web_search" ? await searchWeb(z.string().parse(args.query), { ...searchOptions, filters: searchFiltersSchema.parse(args) }, this.transport) :
                name === "web_read" ? await readWeb(z.array(z.string()).parse(args.urls), [...sources.map(s => s.url), ...session.messages.flatMap(m => m.sources?.map(s => s.url) ?? [])], searchOptions, this.transport) :
                await this.port.read(id, session.scope, name, args);
              controller.signal.throwIfAborted();
              if ((name === "web_search" || name === "web_read") && typeof output === "object" && output && "sources" in output) {
                const parsed = z.array(z.object({ title: z.string(), url: z.string().url() })).safeParse(output.sources);
                if (parsed.success) sources.push(...parsed.data.filter(s => !sources.some(existing => existing.url === s.url)));
              }
            }
          } catch (error) {
            controller.signal.throwIfAborted();
            output = { error: error instanceof AssistantError ? error.message : "工具暂不可用或参数不正确，请调整查询" };
          }
          const serialized = JSON.stringify(output);
          context.continuation.push({ role: "tool", tool_call_id: call.id, content: serialized.length > 24000 ? JSON.stringify({ notice: "资料过多，请缩小查询范围", excerpt: serialized.slice(0, 18000) }) : serialized });
        }
        update(s => { s.task!.progress = "正在整理分析…"; s.task!.contextTokens = estimateTokens(contextMessages(context)); });
      }
      throw new AssistantError("本次工具调用已达上限，请缩小问题范围后继续");
    } catch (error) {
      update(s => { s.task!.status = controller.signal.aborted ? "stopped" : "error";
        s.task!.error = controller.signal.aborted ? "任务已停止（手动停止或超过 5 分钟）" : error instanceof AssistantError ? error.message : "模型请求失败，请检查地址、网络和兼容设置";
        s.task!.progress = ""; });
    } finally { clearTimeout(timeout); this.running.delete(taskId); }
  }
  register(app: FastifyInstance, authenticate: (request: FastifyRequest) => string | undefined) {
    const route = (method: "GET" | "POST" | "PATCH" | "DELETE", path: string, handler: (id: string, req: FastifyRequest) => unknown) => {
      app.route({ method, url: `/api/assistant${path}`, bodyLimit: 100000, handler: async (req, reply) => {
        const id = authenticate(req);
        if (!id) return reply.code(401).send({ code: "UNAUTHORIZED", message: "请登录后使用 AI 助手" });
        try { return { data: await handler(id, req) }; }
        catch (e) { return reply.code(e instanceof AssistantError ? e.statusCode : e instanceof z.ZodError ? 400 : 502).send({ code: "ASSISTANT_ERROR", message: e instanceof AssistantError ? e.message : e instanceof z.ZodError ? "参数不正确，请检查输入" : "服务暂不可用，请稍后重试" }); }
      } });
    };
    const sid = (req: FastifyRequest) => z.object({ id: z.string().uuid() }).parse(req.params).id;
    route("GET", "", id => this.overview(id));
    route("GET", "/market-snapshots", (_id, req) => {
      if (!this.port.snapshots) throw new AssistantError("当前服务器不支持行情快照同步", 404);
      return this.port.snapshots(req.query);
    });
    route("PATCH", "/settings", (id, req) => {
      const value = settingsSchema.parse(req.body); const baseUrl = normalizeBaseUrl(value.baseUrl);
      return this.store.change(id, state => {
        const { apiKey, searchApiKey, ...settings } = value;
        // 更换服务地址必须清除旧密钥，避免把旧服务凭据发送给新站点。
        if (state.settings.baseUrl !== baseUrl) state.secret = "";
        if (apiKey !== undefined) state.secret = this.store.encrypt(apiKey);
        if (searchApiKey !== undefined) state.searchSecret = this.store.encrypt(searchApiKey);
        const next = { ...state.settings, ...settings, baseUrl, hasKey: Boolean(state.secret), hasSearchKey: Boolean(state.searchSecret) };
        if (!reasoningOptions(next.provider, next.claudeThinkingMode).includes(next.reasoning)) {
          if (next.provider !== state.settings.provider || next.claudeThinkingMode !== state.settings.claudeThinkingMode) next.reasoning = "auto";
          else throw new AssistantError("此接口不支持所选思考强度，请选择自动或该接口提供的选项");
        }
        state.settings = next;
        return state.settings;
      });
    });
    route("POST", "/models", async id => {
      const state = this.store.read(id);
      const value = await this.transport(`${state.settings.baseUrl}/models`, { protocol: state.settings.provider, key: this.store.decrypt(state.secret), signal: AbortSignal.timeout(20000) });
      return z.object({ data: z.array(z.object({ id: z.string() })) }).parse(value);
    });
    route("POST", "/test", async id => {
      const state = this.store.read(id);
      if (!state.settings.model) throw new AssistantError("请先填写模型 ID");
      const tools = state.settings.toolsEnabled ? [tool("connection_test", "回复测试结果前调用此工具", {})] : [];
      const messages: ProviderMessage[] = [{ role: "user", content: tools.length ? "Call connection_test once with no arguments, then reply OK using its result." : "Reply OK." }];
      const signal = AbortSignal.timeout(60000);
      const complete = async () => {
        const request = buildProviderRequest(state.settings, messages, tools);
        return parseProviderReply(state.settings.provider, await this.transport(request.url, {
          protocol: state.settings.provider, key: this.store.decrypt(state.secret), signal, body: request.body,
        }));
      };
      const first = await complete();
      if (!tools.length) return { message: first.content ? "模型对话测试通过" : "模型响应无正文，请检查思考设置" };
      if (!first.calls.length || first.calls.some(c => c.function.name !== "connection_test"))
        return { message: "模型可响应，但未完成测试工具调用。请调整设置或关闭工具。" };
      messages.push(first.message, ...first.calls.map(c => ({ role: "tool" as const, tool_call_id: c.id, content: '{"ok":true}' })));
      const second = await complete();
      return { message: second.content && !second.calls.length ? "模型、流式响应与工具续接测试通过" : "工具已调用，但续接未完成正文，请检查模型与思考设置" };
    });
    route("PATCH", "/search-settings", (id, req) => {
      const value = z.object({ provider: z.enum(["exa-free", "exa-api", "bing"]), apiKey: z.string().max(2000).optional() }).parse(req.body);
      return this.store.change(id, state => {
        if (value.apiKey !== undefined) state.searchSecret = this.store.encrypt(value.apiKey);
        state.settings.searchProvider = value.provider; state.settings.hasSearchKey = Boolean(state.searchSecret);
        return { provider: value.provider, hasKey: state.settings.hasSearchKey };
      });
    });
    route("POST", "/search-test", async id => {
      const state = this.store.read(id);
      const result = await searchWeb("Exa search documentation", { provider: state.settings.searchProvider, key: this.store.decrypt(state.searchSecret) }, this.transport);
      return { message: `搜索连接成功，返回 ${result.sources.length} 条来源`, sources: result.sources.map(s => ({ title: s.title, url: s.url })) };
    });
    route("POST", "/sessions", (id, req) => this.store.change(id, state => {
      if (state.sessions.length >= 100) throw new AssistantError("最多保存 100 个会话，请先删除不需要的会话");
      const scope = scopeSchema.parse(req.body);
      const session: AssistantSession = { id: randomUUID(), title: "新对话", pinned: false, scope, messages: [], updatedAt: new Date().toISOString() };
      state.sessions.push(session); return session;
    }));
    route("PATCH", "/sessions/:id", (id, req) => {
      const sessionId = sid(req); this.session(id, sessionId);
      const value = z.object({ title: z.string().trim().min(1).max(80).optional(), pinned: z.boolean().optional() }).parse(req.body);
      return this.store.change(id, s => { const session = s.sessions.find(x => x.id === sessionId)!; Object.assign(session, value); return session; });
    });
    route("DELETE", "/sessions/:id", (id, req) => { const sessionId = sid(req); this.trades.refresh(id); this.trades.assertDeletable(this.session(id, sessionId)); this.stop(id, sessionId);
      this.store.change(id, s => { s.sessions = s.sessions.filter(x => x.id !== sessionId); }); return { deleted: true }; });
    route("POST", "/sessions/:id/messages", (id, req) => {
      const { content, requestId, snapshotHints } = z.object({ content: z.string().trim().min(1).max(30000), requestId: z.string().uuid(),
        snapshotHints: z.object({ mode: z.enum(["REAL", "VIRTUAL"]), ids: z.array(z.string().max(120)).max(20), syncedAt: z.string().datetime() }).optional() }).parse(req.body);
      return this.submit(id, sid(req), content, requestId, snapshotHints);
    });
    route("POST", "/sessions/:id/stop", (id, req) => { const sessionId = sid(req); this.session(id, sessionId); this.stop(id, sessionId); return { stopped: true }; });
    for (const action of ["approve", "reject"] as const) route("POST", `/sessions/:id/trades/:proposalId/${action}`, (id, req) => {
      const params = z.object({ id: z.string().uuid(), proposalId: z.string().uuid() }).parse(req.params);
      z.object({}).strict().parse(req.body);
      return this.trades[action](id, params.id, params.proposalId);
    });
    route("PATCH", "/memory", (id, req) => { const v = z.object({ text: z.string().max(12000), revision: z.string(), enabled: z.boolean().optional(), undo: z.boolean().optional() }).parse(req.body);
      return this.store.updateMemory(id, v.text, v.revision, v.enabled, v.undo); });
  }
}
