import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApplication } from "../src/application.js";
import { createTestHarness } from "./helpers.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    await rm(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

describe("LLM 根配置热重载", () => {
  it("支持切换模型和 Schema 模式，坏 JSON 或短暂缺失时保留上次有效配置", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gupiaomoniqi-llm-reload-"));
    temporaryDirectories.push(directory);
    const configPath = join(directory, "config.json");
    await writeConfig(configPath, "model-a", "object");
    const { repository } = await createTestHarness({ registerAccount: false });
    const context = await createApplication({
      repository,
      rootConfigPath: configPath,
      rootConfigWatchIntervalMs: 20,
      rootConfigWatchDebounceMs: 10,
    });

    try {
      expect(context.llmTradingRuntime.getStatus()).toMatchObject({
        enabled: true,
        modelId: "model-a",
        jsonSchemaMode: "object",
      });

      await writeConfig(configPath, "model-b", "strict");
      await waitUntil(() =>
        context.llmTradingRuntime.getStatus().enabled === true &&
        context.llmTradingRuntime.getStatus().modelId === "model-b",
      );
      expect(context.llmTradingService?.getStatus()).toMatchObject({
        modelId: "model-b",
        jsonSchemaMode: "strict",
      });

      await writeFile(configPath, "{", "utf8");
      await waitUntil(
        () =>
          context.llmTradingRuntime.getStatus().reloadState === "INVALID",
      );
      expect(context.llmTradingRuntime.getStatus()).toMatchObject({
        enabled: true,
        modelId: "model-b",
        reloadState: "INVALID",
      });

      await rm(configPath, { force: true });
      await waitUntil(
        () =>
          context.llmTradingRuntime.getStatus().reloadState === "MISSING",
      );
      expect(context.llmTradingRuntime.getStatus()).toMatchObject({
        enabled: true,
        modelId: "model-b",
        reloadState: "MISSING",
      });

      await writeFile(
        configPath,
        JSON.stringify({ llmTrading: { enabled: false } }),
        "utf8",
      );
      await waitUntil(
        () => context.llmTradingRuntime.getStatus().enabled === false,
      );
      expect(context.llmTradingRuntime.getStatus()).toMatchObject({
        enabled: false,
        configurationState: "DISABLED",
        reloadError: null,
      });

      await writeConfig(configPath, "model-c", "object");
      await waitUntil(() =>
        context.llmTradingRuntime.getStatus().enabled === true &&
        context.llmTradingRuntime.getStatus().modelId === "model-c",
      );
    } finally {
      await context.app.close();
    }
  }, 10_000);
});

async function writeConfig(
  path: string,
  modelId: string,
  jsonSchemaMode: "object" | "strict",
): Promise<void> {
  await writeFile(
    path,
    JSON.stringify({
      llmTrading: {
        baseUrl: "http://127.0.0.1:8080/v1",
        modelId,
        jsonSchemaMode,
      },
    }),
    "utf8",
  );
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 3_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("WAIT_FOR_LLM_CONFIG_RELOAD_TIMEOUT");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
