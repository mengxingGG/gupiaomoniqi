import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { AssistantError } from "./AssistantStore.js";

function privateAddress(ip: string) {
  if (isIP(ip) === 6) return !/^2[0-9a-f]{3}:/i.test(ip) || /^2001:(db8|0):/i.test(ip);
  const [a = 0, b = 0] = ip.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19));
}

export function normalizeBaseUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new AssistantError("请输入完整的 API 地址，例如 https://服务地址/v1"); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new AssistantError("API 地址只允许 HTTP(S)，不能包含密钥、查询或片段");
  return url.toString().replace(/\/+$/, "").replace(/\/(chat\/completions|models)$/, "");
}

/** DNS 解析后固定连接地址，不跟随重定向，阻断内网访问与 DNS 重绑定。 */
export async function providerRequest(url: string, options: {
  key?: string; body?: unknown; signal?: AbortSignal; text?: boolean; onText?: (text: string) => void;
} = {}): Promise<unknown> {
  const target = new URL(url);
  const addresses = await lookup(target.hostname.replace(/^\[|\]$/g, ""), { all: true });
  const localAllowed = (process.env.ASSISTANT_ALLOWED_HOSTS ?? "").split(",").includes(target.hostname);
  if (!localAllowed && (target.protocol !== "https:" || addresses.some(a => privateAddress(a.address))))
    throw new AssistantError("该服务地址不可从服务器安全访问。局域网模型须由管理员配置 ASSISTANT_ALLOWED_HOSTS。");
  const address = addresses[0];
  if (!address) throw new AssistantError("无法解析服务地址");
  return await new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    const req = (target.protocol === "https:" ? httpsRequest : httpRequest)(target, {
      method: body === undefined ? "GET" : "POST", signal: options.signal, family: address.family,
      headers: { accept: "application/json", ...(body ? { "content-type": "application/json" } : {}),
        ...(options.key ? { authorization: `Bearer ${options.key}` } : {}) },
      lookup: (_host, _opts, cb) => cb(null, address.address, address.family),
    }, res => {
      const streaming = String(res.headers["content-type"]).includes("text/event-stream");
      const decoder = new TextDecoder();
      let pending = "", content = "", finish = "stop", completed = false;
      const calls: { id: string; type: "function"; function: { name: string; arguments: string } }[] = [];
      const consume = (line: string) => {
        if (!line.startsWith("data:")) return;
        const data = line.slice(5).trim();
        if (!data) return;
        if (data === "[DONE]") { completed = true; return; }
        const event = JSON.parse(data);
        if (event.error) throw new AssistantError("模型流式返回错误，请检查服务状态");
        const choice = event.choices?.[0]; if (!choice) return;
        if (choice.finish_reason) { finish = choice.finish_reason; completed = true; }
        if (typeof choice.delta?.content === "string") { content += choice.delta.content; options.onText?.(content); }
        for (const call of choice.delta?.tool_calls ?? []) {
          if (!Number.isInteger(call.index) || call.index < 0 || call.index >= 12) throw new AssistantError("模型工具调用格式不正确");
          const current = calls[call.index] ??= { id: "", type: "function", function: { name: "", arguments: "" } };
          if (call.id) current.id = call.id;
          if (call.function?.name) current.function.name += call.function.name;
          if (call.function?.arguments) current.function.arguments += call.function.arguments;
        }
      };
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 4_000_000) { req.destroy(new AssistantError("服务返回内容过大")); return; }
        if (streaming) {
          try {
            pending += decoder.decode(chunk, { stream: true });
            const lines = pending.split("\n"); pending = lines.pop() ?? "";
            lines.forEach(consume);
          } catch (error) { req.destroy(error instanceof Error ? error : new AssistantError("流式响应格式不正确")); }
        } else chunks.push(chunk);
      });
      res.on("error", reject);
      res.on("end", () => {
        if ((res.statusCode ?? 500) >= 300) {
          reject(new AssistantError(res.statusCode === 401 || res.statusCode === 403 ? "模型凭据无效或无访问权限，请检查设置" :
            res.statusCode === 429 ? "模型服务额度或频率受限，请稍后重试" : `模型服务返回 HTTP ${res.statusCode}，请检查模型、思考参数与工具兼容性`)); return;
        }
        try {
          if (streaming) {
            pending += decoder.decode(); if (pending.trim()) consume(pending);
            if (!completed) throw new AssistantError("模型流式连接提前中断，已收到的内容保留，请重试");
            resolve({ choices: [{ finish_reason: finish, message: { role: "assistant", content, ...(calls.length ? { tool_calls: calls.filter(Boolean) } : {}) } }] });
          } else { const raw = Buffer.concat(chunks).toString("utf8"); resolve(options.text ? raw : JSON.parse(raw)); }
        }
        catch { reject(new AssistantError("服务没有返回有效 JSON，请检查 API 地址")); }
      });
    });
    req.setTimeout(120000, () => req.destroy(new AssistantError("模型请求超时，请重试或降低思考强度")));
    req.on("error", reject);
    req.end(body);
  });
}
