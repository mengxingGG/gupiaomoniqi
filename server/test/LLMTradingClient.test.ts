import { describe, expect, it, vi } from "vitest";
import type { LLMTradingConfig } from "../src/config/RootConfig.js";
import {
  LLMClientError,
  LlamaCppTradingClient,
} from "../src/ai/LLMTradingClient.js";

describe("LlamaCppTradingClient", () => {
  it("默认使用 MiniMax 兼容的 json_object，不发送 llama.cpp 专属字段", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify(validDecision()),
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const client = new LlamaCppTradingClient(
      config({ apiKey: "secret" }),
      fetchMock as typeof fetch,
    );

    await expect(
      client.requestDecision({ system: "system", user: "market" }),
    ).resolves.toEqual(validDecision());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:8080/v1/chat/completions");
    expect(options?.headers).toMatchObject({ authorization: "Bearer secret" });
    const request = JSON.parse(String(options?.body));
    expect(request).toMatchObject({
      model: "local-model",
      stream: false,
      response_format: {
        type: "json_object",
      },
    });
    expect(request).not.toHaveProperty("chat_template_kwargs");
    expect(request.response_format).not.toHaveProperty("json_schema");
  });

  it("显式 strict 时才发送 llama.cpp 严格 JSON schema", async () => {
    const fetchMock = vi.fn(async () => responseWithDecision(validDecision()));
    const client = new LlamaCppTradingClient(
      config({ jsonSchemaMode: "strict" }),
      fetchMock as typeof fetch,
    );

    await client.requestDecision({ system: "system", user: "market" });
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(request).toMatchObject({
      chat_template_kwargs: { enable_thinking: false },
      response_format: {
        type: "json_schema",
        json_schema: { strict: true },
      },
    });
  });

  it("没有密钥时不发送 Authorization", async () => {
    const fetchMock = vi.fn(async (_url: unknown, options?: RequestInit) => {
      expect(options?.headers).not.toHaveProperty("authorization");
      return responseWithDecision(validDecision());
    });
    const client = new LlamaCppTradingClient(config(), fetchMock as typeof fetch);
    await client.requestDecision({ system: "s", user: "u" });
  });

  it("通过模型列表验证配置的模型 ID", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ id: "local-model" }] }), {
        status: 200,
      }),
    );
    const client = new LlamaCppTradingClient(config(), fetchMock as typeof fetch);

    await expect(client.checkAvailability()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8080/v1/models",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("拒绝 Markdown 包裹和 HTTP 错误", async () => {
    const markdownClient = new LlamaCppTradingClient(
      config(),
      (async () => responseWithDecision("```json\n{}\n```", false)) as typeof fetch,
    );
    await expect(
      markdownClient.requestDecision({ system: "s", user: "u" }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });

    const httpClient = new LlamaCppTradingClient(
      config(),
      (async () => new Response("unavailable", { status: 503 })) as typeof fetch,
    );
    await expect(
      httpClient.requestDecision({ system: "s", user: "u" }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<LLMClientError>>({
        code: "HTTP_ERROR",
        statusCode: 503,
      }),
    );
  });

  it("到达配置超时后主动取消请求", async () => {
    vi.useFakeTimers();
    try {
      const client = new LlamaCppTradingClient(
        config({ requestTimeoutMs: 1_000 }),
        ((_url: unknown, options?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            options?.signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
          })) as typeof fetch,
      );
      const request = client.requestDecision({ system: "s", user: "u" });
      const rejection = expect(request).rejects.toMatchObject({ code: "TIMEOUT" });
      await vi.advanceTimersByTimeAsync(1_000);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });
});

function config(overrides: Partial<LLMTradingConfig> = {}): LLMTradingConfig {
  return {
    enabled: true,
    baseUrl: "http://127.0.0.1:8080/v1",
    modelId: "local-model",
    apiKey: "",
    jsonSchemaMode: "object",
    agentCount: 10,
    contextWindow: 32_768,
    requestTimeoutMs: 300_000,
    decisionIntervalMs: 60_000,
    maxConcurrency: 1,
    maxOutputTokens: 512,
    temperature: 0.35,
    circuitBackoffMs: 60_000,
    circuitMaximumBackoffMs: 300_000,
    ...overrides,
  };
}

function validDecision() {
  return {
    action: "HOLD",
    instrumentId: null,
    orderType: null,
    limitPrice: null,
    allocationPercent: 0,
    positionPercent: 0,
    confidence: 0.5,
    reason: "等待机会",
  };
}

function responseWithDecision(value: unknown, stringify = true): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: stringify ? JSON.stringify(value) : value,
          },
        },
      ],
    }),
    { status: 200 },
  );
}
