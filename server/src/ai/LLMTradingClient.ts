import type { LLMTradingConfig } from "../config/RootConfig.js";
import { LLM_TRADE_DECISION_JSON_SCHEMA } from "./LLMDecisionSchema.js";

const MAXIMUM_RESPONSE_BYTES = 1_048_576;

export interface LLMDecisionPrompt {
  system: string;
  user: string;
}

export interface LLMDecisionClient {
  checkAvailability(signal?: AbortSignal): Promise<void>;
  requestDecision(prompt: LLMDecisionPrompt, signal?: AbortSignal): Promise<unknown>;
}

export type LLMClientErrorCode =
  | "ABORTED"
  | "TIMEOUT"
  | "NETWORK"
  | "HTTP_ERROR"
  | "INVALID_RESPONSE";

export class LLMClientError extends Error {
  constructor(
    readonly code: LLMClientErrorCode,
    message: string,
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = "LLMClientError";
  }
}

export class LlamaCppTradingClient implements LLMDecisionClient {
  readonly #endpoint: string;
  readonly #modelsEndpoint: string;

  constructor(
    private readonly config: LLMTradingConfig,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {
    this.#endpoint = `${config.baseUrl}/chat/completions`;
    this.#modelsEndpoint = `${config.baseUrl}/models`;
  }

  async checkAvailability(signal?: AbortSignal): Promise<void> {
    const response = await fetchWithTimeout({
      fetchImplementation: this.fetchImplementation,
      url: this.#modelsEndpoint,
      init: {
        method: "GET",
        headers: this.config.apiKey
          ? { authorization: `Bearer ${this.config.apiKey}` }
          : undefined,
      },
      timeoutMs: this.config.requestTimeoutMs,
      signal,
    });
    const responseText = await response.text();
    if (!response.ok) {
      throw new LLMClientError(
        "HTTP_ERROR",
        `LLM 模型探测 HTTP ${response.status}`,
        response.status,
      );
    }
    if (Buffer.byteLength(responseText, "utf8") > MAXIMUM_RESPONSE_BYTES) {
      throw new LLMClientError("INVALID_RESPONSE", "LLM 模型列表响应体过大");
    }

    let envelope: unknown;
    try {
      envelope = JSON.parse(responseText.replace(/^\uFEFF/u, ""));
    } catch {
      throw new LLMClientError("INVALID_RESPONSE", "LLM 模型列表不是 JSON");
    }
    const modelIds = extractModelIds(envelope);
    if (!modelIds.includes(this.config.modelId)) {
      throw new LLMClientError(
        "INVALID_RESPONSE",
        `LLM 模型列表中没有配置的模型 ID：${this.config.modelId}`,
      );
    }
  }

  async requestDecision(
    prompt: LLMDecisionPrompt,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const controller = new AbortController();
    let timeoutReached = false;
    const timeout = setTimeout(() => {
      timeoutReached = true;
      controller.abort(new Error("LLM_REQUEST_TIMEOUT"));
    }, this.config.requestTimeoutMs);
    timeout.unref();

    const abortFromCaller = () => {
      controller.abort(signal?.reason);
    };
    if (signal?.aborted) {
      abortFromCaller();
    } else {
      signal?.addEventListener("abort", abortFromCaller, { once: true });
    }

    try {
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      if (this.config.apiKey) {
        headers.authorization = `Bearer ${this.config.apiKey}`;
      }

      let response: Response;
      try {
        response = await this.fetchImplementation(this.#endpoint, {
          method: "POST",
          headers,
          signal: controller.signal,
          body: JSON.stringify({
            model: this.config.modelId,
            messages: [
              { role: "system", content: prompt.system },
              { role: "user", content: prompt.user },
            ],
            temperature: this.config.temperature,
            max_tokens: this.config.maxOutputTokens,
            stream: false,
            ...(this.config.jsonSchemaMode === "strict"
              ? {
                  chat_template_kwargs: {
                    enable_thinking: false,
                  },
                }
              : {}),
            response_format: responseFormat(this.config.jsonSchemaMode),
          }),
        });
      } catch (error) {
        if (controller.signal.aborted) {
          throw new LLMClientError(
            timeoutReached ? "TIMEOUT" : "ABORTED",
            timeoutReached ? "LLM 请求超时" : "LLM 请求已取消",
          );
        }
        throw new LLMClientError("NETWORK", safeErrorMessage(error));
      }

      const contentLength = Number(response.headers.get("content-length") ?? 0);
      if (contentLength > MAXIMUM_RESPONSE_BYTES) {
        throw new LLMClientError("INVALID_RESPONSE", "LLM 响应体过大");
      }
      const responseText = await response.text();
      if (Buffer.byteLength(responseText, "utf8") > MAXIMUM_RESPONSE_BYTES) {
        throw new LLMClientError("INVALID_RESPONSE", "LLM 响应体过大");
      }
      if (!response.ok) {
        throw new LLMClientError(
          "HTTP_ERROR",
          `LLM HTTP ${response.status}`,
          response.status,
        );
      }

      return parseOpenAIResponse(responseText);
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abortFromCaller);
    }
  }
}

function responseFormat(mode: LLMTradingConfig["jsonSchemaMode"]): object {
  if (mode === "strict") {
    return {
      type: "json_schema",
      json_schema: {
        name: "virtual_stock_trade_decision",
        strict: true,
        schema: LLM_TRADE_DECISION_JSON_SCHEMA,
      },
    };
  }
  return { type: "json_object" };
}

function parseOpenAIResponse(responseText: string): unknown {
  let envelope: unknown;
  try {
    envelope = JSON.parse(responseText.replace(/^\uFEFF/u, ""));
  } catch {
    throw new LLMClientError("INVALID_RESPONSE", "LLM 返回的响应外壳不是 JSON");
  }

  const content = extractMessageContent(envelope);
  if (typeof content !== "string" || !content.trim()) {
    throw new LLMClientError("INVALID_RESPONSE", "LLM 响应缺少 choices[0].message.content");
  }

  try {
    return JSON.parse(content.trim().replace(/^\uFEFF/u, ""));
  } catch {
    throw new LLMClientError("INVALID_RESPONSE", "LLM 决策不是严格 JSON");
  }
}

function extractMessageContent(envelope: unknown): string | undefined {
  if (typeof envelope !== "object" || envelope === null || !("choices" in envelope)) {
    return undefined;
  }
  const choices = (envelope as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return undefined;
  }
  const message = choices[0]?.message;
  if (typeof message !== "object" || message === null || !("content" in message)) {
    return undefined;
  }
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((item) =>
        typeof item === "object" && item !== null && "text" in item
          ? String((item as { text?: unknown }).text ?? "")
          : "",
      )
      .join("");
  }
  return undefined;
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function extractModelIds(envelope: unknown): string[] {
  if (typeof envelope !== "object" || envelope === null || !("data" in envelope)) {
    return [];
  }
  const data = (envelope as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    return [];
  }
  return data.flatMap((item) =>
    typeof item === "object" && item !== null && "id" in item
      ? [String((item as { id?: unknown }).id ?? "")]
      : [],
  );
}

async function fetchWithTimeout(input: {
  fetchImplementation: typeof fetch;
  url: string;
  init: RequestInit;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<Response> {
  const controller = new AbortController();
  let timeoutReached = false;
  const timeout = setTimeout(() => {
    timeoutReached = true;
    controller.abort(new Error("LLM_REQUEST_TIMEOUT"));
  }, input.timeoutMs);
  timeout.unref();
  const abortFromCaller = () => controller.abort(input.signal?.reason);
  if (input.signal?.aborted) {
    abortFromCaller();
  } else {
    input.signal?.addEventListener("abort", abortFromCaller, { once: true });
  }

  try {
    return await input.fetchImplementation(input.url, {
      ...input.init,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new LLMClientError(
        timeoutReached ? "TIMEOUT" : "ABORTED",
        timeoutReached ? "LLM 请求超时" : "LLM 请求已取消",
      );
    }
    throw new LLMClientError("NETWORK", safeErrorMessage(error));
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", abortFromCaller);
  }
}
