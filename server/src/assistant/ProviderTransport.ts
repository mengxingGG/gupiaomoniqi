import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { AssistantError } from "./AssistantStore.js";
import { createStreamAccumulator, type StreamFormat } from "./ProviderCodec.js";

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
  const base = url.toString().replace(/\/+$/, "").replace(/\/(chat\/completions|responses|messages|models)$/, "");
  const normalized = new URL(base);
  // 官方及常见兼容服务均以 /v1 为根；自定义路径原样保留。
  return normalized.pathname === "/" ? `${base}/v1` : base;
}

export interface ProviderRequestOptions {
  key?: string; body?: unknown; signal?: AbortSignal; text?: boolean; onText?: (text: string) => void;
  protocol?: StreamFormat; headers?: Record<string, string>;
}

/** DNS 解析后固定连接地址，不跟随重定向，阻断内网访问与 DNS 重绑定。 */
export async function providerRequest(url: string, options: ProviderRequestOptions = {}): Promise<unknown> {
  options.signal?.throwIfAborted();
  const target = new URL(url);
  const addresses = await lookup(target.hostname.replace(/^\[|\]$/g, ""), { all: true });
  options.signal?.throwIfAborted();
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
      headers: { accept: "application/json, text/event-stream", ...(body ? { "content-type": "application/json" } : {}),
        ...(options.protocol === "anthropic" ? { "anthropic-version": "2023-06-01", ...(options.key ? { "x-api-key": options.key } : {}) } :
          options.key ? { authorization: `Bearer ${options.key}` } : {}), ...options.headers },
      lookup: (_host, _opts, cb) => cb(null, address.address, address.family),
    }, res => {
      const streaming = String(res.headers["content-type"]).includes("text/event-stream");
      const decoder = new TextDecoder();
      const accumulator = createStreamAccumulator(options.protocol ?? "openai-chat", options.onText);
      let pending = "", frame: string[] = [];
      const flush = () => { if (frame.length) { accumulator.consume(frame.join("\n")); frame = []; } };
      const consume = (line: string) => {
        line = line.replace(/\r$/, "");
        if (!line) { flush(); return; }
        if (line.startsWith("data:")) frame.push(line.slice(5).replace(/^ /, ""));
      };
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 4_000_000) { reject(new AssistantError("服务返回内容过大")); res.destroy(); req.destroy(); return; }
        if (streaming && (res.statusCode ?? 500) < 300) {
          try {
            pending += decoder.decode(chunk, { stream: true });
            const lines = pending.split("\n"); pending = lines.pop() ?? "";
            lines.forEach(consume);
          } catch (error) {
            reject(error instanceof Error ? error : new AssistantError("流式响应格式不正确"));
            // 错误通过 Promise 交付，关闭已结束的 socket 时不再次派发同一个异常。
            res.destroy(); req.destroy();
          }
        } else chunks.push(chunk);
      });
      res.on("error", reject);
      res.on("aborted", () => reject(new AssistantError("服务连接提前中断，请重试")));
      res.on("end", () => {
        if ((res.statusCode ?? 500) >= 300) {
          const details = Buffer.concat(chunks).toString("utf8");
          if (/context[_ -]?(length|window)|maximum context|too many tokens|prompt is too long|input.*exceed.*token/i.test(details)) {
            reject(new AssistantError("所选上下文超过该模型接口支持的范围，请在设置中调小上下文后重试")); return;
          }
          reject(new AssistantError(res.statusCode === 401 || res.statusCode === 403 ? "模型凭据无效或无访问权限，请检查设置" :
            res.statusCode === 429 ? "模型服务额度或频率受限，请稍后重试" : `模型服务返回 HTTP ${res.statusCode}，请检查模型、思考参数与工具兼容性`)); return;
        }
        try {
          if (streaming) {
            pending += decoder.decode(); if (pending.trim()) consume(pending); flush();
            resolve(accumulator.finish());
          } else { const raw = Buffer.concat(chunks).toString("utf8"); resolve(options.text ? raw : JSON.parse(raw)); }
        }
        catch (error) { reject(error instanceof AssistantError ? error : new AssistantError("服务返回的 JSON 或流式内容不完整，请检查 API 地址和协议")); }
      });
    });
    req.setTimeout(120000, () => req.destroy(new AssistantError("模型请求超时，请重试或降低思考强度")));
    req.on("error", reject);
    req.end(body);
  });
}
