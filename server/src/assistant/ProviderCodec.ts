import { z } from "zod";
import type { AssistantProvider, AssistantSettings, ReasoningEffort } from "@gupiaomoniqi/shared";
import { AssistantError } from "./AssistantStore.js";

type Item = Record<string, any>;
export interface ToolCall { id: string; type: "function"; function: { name: string; arguments: string } }
export interface ProviderMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  reasoning_content?: string;
  responseOutput?: Item[];
  anthropicContent?: Item[];
}
export interface ProviderTool { type: "function"; function: { name: string; description: string; parameters: Item } }
export interface ProviderReply { message: ProviderMessage; calls: ToolCall[]; content: string; truncated: boolean }
export type StreamFormat = AssistantProvider | "mcp";

const callSchema = z.object({ id: z.string().min(1).max(300), type: z.literal("function"),
  function: z.object({ name: z.string().min(1).max(200), arguments: z.string().max(100000) }) });
const object = (v: unknown): Item => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new AssistantError("模型返回的数据格式不正确");
  return v as Item;
};
const array = (v: unknown): Item[] => {
  if (!Array.isArray(v) || v.length > 128) throw new AssistantError("模型返回的内容块格式不正确");
  return v.map(object);
};

export function reasoningOptions(provider: AssistantProvider, mode = "adaptive"): ReasoningEffort[] {
  if (provider === "deepseek") return ["auto", "none", "low", "high", "max"];
  if (provider === "anthropic") return mode === "budget" ? ["auto", "none", "low", "medium", "high"] : ["auto", "none", "low", "medium", "high", "xhigh", "max"];
  return ["auto", "none", "minimal", "low", "medium", "high", "xhigh"];
}
export function outputBudget(settings: AssistantSettings) {
  return settings.reasoning === "max" ? 16384 : ["high", "xhigh"].includes(settings.reasoning) ? 8192 : 4096;
}
export function reasoningParameters(settings: AssistantSettings): Item {
  const { provider, reasoning, claudeThinkingMode } = settings;
  if (!reasoningOptions(provider, claudeThinkingMode).includes(reasoning)) throw new AssistantError("所选接口不支持此思考选项，请切回自动或重新选择");
  // 自动模式不强加跨模型参数；由提供方选择默认思考策略。
  if (reasoning === "auto") return {};
  if (provider === "deepseek") return reasoning === "none" ? { thinking: { type: "disabled" } } :
    { thinking: { type: "enabled" }, reasoning_effort: reasoning };
  if (provider === "openai-responses") return { reasoning: { effort: reasoning } };
  if (provider === "anthropic") {
    if (reasoning === "none") return { thinking: { type: "disabled" } };
    if (claudeThinkingMode === "budget") return { thinking: { type: "enabled", budget_tokens: ({ low: 1024, medium: 2048, high: 4096 } as Item)[reasoning] } };
    return { thinking: { type: "adaptive" }, output_config: { effort: reasoning } };
  }
  return { reasoning_effort: reasoning };
}

export function buildProviderRequest(settings: AssistantSettings, messages: ProviderMessage[], tools: ProviderTool[], budget = outputBudget(settings)) {
  const common = { model: settings.model, stream: true, ...reasoningParameters(settings) };
  const base = settings.baseUrl;
  if (settings.provider === "openai-responses") {
    const input = messages.filter(m => m.role !== "system").flatMap((m): Item[] => {
      if (m.role === "tool") return [{ type: "function_call_output", call_id: m.tool_call_id, output: m.content ?? "" }];
      if (m.responseOutput) return m.responseOutput;
      return [{ role: m.role, content: m.content ?? "" }];
    });
    return { url: `${base}/responses`, body: { ...common, store: false, include: ["reasoning.encrypted_content"],
      instructions: messages.filter(m => m.role === "system").map(m => m.content).join("\n\n"), input, max_output_tokens: budget,
      ...(tools.length ? { tools: tools.map(t => ({ type: "function", ...t.function, strict: false })), tool_choice: "auto" } : {}) } };
  }
  if (settings.provider === "anthropic") {
    const input: Item[] = [];
    for (const m of messages.filter(m => m.role !== "system")) {
      const role = m.role === "assistant" ? "assistant" : "user";
      const content = m.role === "tool" ? [{ type: "tool_result", tool_use_id: m.tool_call_id, content: m.content ?? "" }] :
        m.anthropicContent ?? [{ type: "text", text: m.content || "（空消息）" }];
      // 多个并行工具结果必须紧邻上一条 tool_use，合并为一个 user 内容块数组。
      const previous = input.at(-1);
      if (previous?.role === role) previous.content.push(...content);
      else input.push({ role, content: [...content] });
    }
    return { url: `${base}/messages`, body: { ...common, system: messages.filter(m => m.role === "system").map(m => m.content).join("\n\n"),
      messages: input, max_tokens: budget,
      ...(tools.length ? { tools: tools.map(t => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters })), tool_choice: { type: "auto" } } : {}) } };
  }
  const input = messages.map(({ responseOutput: _r, anthropicContent: _a, ...m }) => {
    if (settings.provider !== "deepseek") { const { reasoning_content: _c, ...chat } = m; return chat; }
    // 旧会话/切换模型后的纯文本没有可验证的思考续接信息，作为历史资料而非伪造协议消息。
    if (tools.length && m.role === "assistant" && m.reasoning_content === undefined && !m.tool_calls)
      return { role: "user", content: `历史助手答复（仅作上下文资料）：\n${m.content ?? ""}` };
    return m;
  });
  return { url: `${base}/chat/completions`, body: { ...common, messages: input,
    ...(settings.provider === "deepseek" ? { max_tokens: budget } : { max_completion_tokens: budget }),
    ...(tools.length ? { tools, tool_choice: "auto" } : {}) } };
}

export function parseProviderReply(provider: AssistantProvider, raw: unknown): ProviderReply {
  const value = object(raw);
  let content = "", calls: unknown[] = [], message: ProviderMessage, truncated = false;
  if (value.error) throw new AssistantError("模型服务返回错误，请检查接口、模型及思考设置");
  if (provider === "openai-responses") {
    if (value.status && !["completed", "incomplete"].includes(value.status)) throw new AssistantError("模型响应尚未完成、失败或已取消");
    const output = array(value.output);
    truncated = value.status === "incomplete";
    for (const item of output) {
      if (item.type === "message") for (const part of array(item.content)) {
        if (part.type === "output_text" && typeof part.text === "string") content += part.text;
        if (part.type === "refusal" && typeof part.refusal === "string") content += part.refusal;
      }
      if (item.type === "function_call") calls.push({ id: item.call_id, type: "function", function: { name: item.name, arguments: item.arguments } });
    }
    message = { role: "assistant", content, responseOutput: output };
  } else if (provider === "anthropic") {
    const blocks = array(value.content);
    truncated = value.stop_reason === "max_tokens";
    for (const block of blocks) {
      if (block.type === "text" && typeof block.text === "string") content += block.text;
      if (block.type === "tool_use") calls.push({ id: block.id, type: "function", function: { name: block.name, arguments: JSON.stringify(object(block.input)) } });
    }
    message = { role: "assistant", content, anthropicContent: blocks };
  } else {
    const choice = object(value.choices?.[0]);
    const msg = object(choice.message);
    content = typeof msg.content === "string" ? msg.content : typeof msg.refusal === "string" ? msg.refusal : "";
    calls = msg.tool_calls ?? [];
    truncated = choice.finish_reason === "length";
    message = { role: "assistant", content, ...(provider === "deepseek" ? { reasoning_content: typeof msg.reasoning_content === "string" ? msg.reasoning_content : "" } : {}) };
  }
  const parsed = z.array(callSchema).max(12).safeParse(calls);
  if (!parsed.success || new Set(parsed.data?.map(c => c.id)).size !== parsed.data?.length) throw new AssistantError("模型工具调用格式不正确");
  if (truncated && parsed.data.length) throw new AssistantError("工具参数因输出上限被截断，未执行工具；请降低思考强度或缩小问题");
  if (parsed.data.length) message.tool_calls = parsed.data;
  return { message, content, calls: parsed.data, truncated };
}

/** 不同协议共享 SSE 分帧，内部事件分别组装；仅正文推送到用户界面。 */
export function createStreamAccumulator(format: StreamFormat, onText?: (text: string) => void) {
  let completed = false, finish = "stop", text = "", reasoning = "", final: unknown;
  const calls = new Map<number, ToolCall>();
  const blocks = new Map<number, Item>();
  const parts = new Map<string, string>();
  const inputs = new Map<number, string>();
  const index = (n: unknown) => { if (!Number.isInteger(n) || Number(n) < 0 || Number(n) > 127) throw new AssistantError("流式内容索引无效"); return Number(n); };
  const publishParts = () => { text = [...parts.values()].join(""); onText?.(text); };
  return {
    consume(data: string) {
      if (data === "[DONE]") { if (format === "openai-chat" || format === "deepseek") completed = true; return; }
      const e = object(JSON.parse(data));
      if (format === "mcp") {
        if (e.id === undefined) return;
        if (e.error) throw new AssistantError("Exa 免费搜索返回协议错误，请稍后重试");
        if (e.result !== undefined) { final = e; completed = true; }
        return;
      }
      if (e.error || e.type === "error" || e.type === "response.failed") throw new AssistantError("服务流式返回错误，请稍后重试或检查接口设置");
      if (format === "openai-responses") {
        if (e.type === "response.output_text.delta" || e.type === "response.refusal.delta") {
          const key = `${index(e.output_index)}:${index(e.content_index ?? 0)}`;
          parts.set(key, (parts.get(key) ?? "") + (typeof e.delta === "string" ? e.delta : "")); publishParts();
        }
        if (e.type === "response.completed" || e.type === "response.incomplete") { final = object(e.response); completed = true; }
        return;
      }
      if (format === "anthropic") {
        if (e.type === "content_block_start") { blocks.set(index(e.index), { ...object(e.content_block) }); }
        if (e.type === "content_block_delta") {
          const i = index(e.index), b = blocks.get(i), d = object(e.delta);
          if (!b) throw new AssistantError("Claude 流式内容块缺失");
          if (d.type === "text_delta") { b.text = (b.text ?? "") + d.text; text = [...blocks.values()].filter(x => x.type === "text").map(x => x.text).join(""); onText?.(text); }
          if (d.type === "thinking_delta") b.thinking = (b.thinking ?? "") + d.thinking;
          if (d.type === "signature_delta") b.signature = (b.signature ?? "") + d.signature;
          if (d.type === "input_json_delta") inputs.set(i, (inputs.get(i) ?? "") + d.partial_json);
        }
        if (e.type === "message_delta" && e.delta?.stop_reason) finish = e.delta.stop_reason;
        if (e.type === "message_stop") completed = true;
        return;
      }
      const choice = e.choices?.[0]; if (!choice) return;
      if (choice.finish_reason) { finish = choice.finish_reason; completed = true; }
      if (typeof choice.delta?.content === "string") { text += choice.delta.content; onText?.(text); }
      if (typeof choice.delta?.reasoning_content === "string") reasoning += choice.delta.reasoning_content;
      for (const call of choice.delta?.tool_calls ?? []) {
        const i = index(call.index); if (i >= 12) throw new AssistantError("本次工具调用过多");
        const current = calls.get(i) ?? { id: "", type: "function", function: { name: "", arguments: "" } };
        if (call.id) current.id = call.id;
        if (call.function?.name) current.function.name += call.function.name;
        if (call.function?.arguments) current.function.arguments += call.function.arguments;
        calls.set(i, current);
      }
    },
    finish(): unknown {
      if (!completed) throw new AssistantError("服务流式连接提前中断，已收到的正文保留，请重试");
      if (format === "mcp" || format === "openai-responses") return final;
      if (format === "anthropic") {
        for (const [i, value] of inputs) { const b = blocks.get(i)!; b.input = JSON.parse(value); }
        return { content: [...blocks.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => b), stop_reason: finish };
      }
      return { choices: [{ finish_reason: finish, message: { role: "assistant", content: text,
        ...(format === "deepseek" ? { reasoning_content: reasoning } : {}), ...(calls.size ? { tool_calls: [...calls.values()] } : {}) } }] };
    },
  };
}
