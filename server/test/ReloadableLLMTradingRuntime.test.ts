import { describe, expect, it, vi } from "vitest";
import { ReloadableLLMTradingRuntime } from "../src/ai/ReloadableLLMTradingRuntime.js";
import type { LLMTradingRuntime } from "../src/ai/LLMTradingRuntime.js";
import type { LLMTradingService } from "../src/ai/LLMTradingService.js";
import type { LLMTradingConfig } from "../src/config/RootConfig.js";

describe("ReloadableLLMTradingRuntime", () => {
  it("运行中重载会等待旧轮停止，再启动新配置", async () => {
    const runtimes = new Map<string, FakeRuntime>();
    const controller = new ReloadableLLMTradingRuntime(
      config("model-a"),
      "ENABLED",
      null,
      (nextConfig) => {
        const runtime = new FakeRuntime();
        runtimes.set(nextConfig.modelId, runtime);
        return {
          service: fakeService(nextConfig),
          runtime: runtime as unknown as LLMTradingRuntime,
        };
      },
    );

    controller.start();
    expect(runtimes.get("model-a")?.start).toHaveBeenCalledOnce();

    await controller.reload(config("model-b"), "ENABLED", null);
    expect(runtimes.get("model-a")?.stopAndWait).toHaveBeenCalledOnce();
    expect(runtimes.get("model-b")?.start).toHaveBeenCalledOnce();
    expect(controller.getStatus()).toMatchObject({
      enabled: true,
      modelId: "model-b",
    });

    controller.reportReloadFailure("INVALID", "bad json");
    expect(controller.getStatus()).toMatchObject({
      modelId: "model-b",
      reloadState: "INVALID",
      reloadError: "bad json",
    });

    await controller.reload(null, "DISABLED", null);
    expect(runtimes.get("model-b")?.stopAndWait).toHaveBeenCalledOnce();
    expect(controller.getStatus()).toMatchObject({
      enabled: false,
      configurationState: "DISABLED",
      reloadError: null,
    });
    await controller.stopAndWait();
  });
});

class FakeRuntime {
  readonly start = vi.fn();
  readonly stopAndWait = vi.fn(async () => undefined);
}

function fakeService(config: LLMTradingConfig): LLMTradingService {
  return {
    getStatus: () => ({
      enabled: true,
      modelId: config.modelId,
      jsonSchemaMode: config.jsonSchemaMode,
      agentCount: config.agentCount,
      runningRequests: 0,
      completedRequests: 0,
      lastRequestLatencyMs: null,
      averageRequestLatencyMs: null,
      providerFailures: 0,
      lastSuccessAt: null,
      lastError: null,
      circuitOpenUntil: null,
    }),
  } as unknown as LLMTradingService;
}

function config(modelId: string): LLMTradingConfig {
  return {
    enabled: true,
    baseUrl: "http://127.0.0.1:8080/v1",
    modelId,
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
  };
}
