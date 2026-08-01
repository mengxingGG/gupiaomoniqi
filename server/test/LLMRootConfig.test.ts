import { describe, expect, it } from "vitest";
import {
  loadRootConfig,
  parseRootConfig,
} from "../src/config/RootConfig.js";

describe("RootConfig LLM 配置", () => {
  it("文件不存在时安静禁用", async () => {
    const result = await loadRootConfig({
      path: "C:/missing/config.json",
      readText: async () => {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      },
    });

    expect(result).toMatchObject({ state: "MISSING", llmTrading: null, error: null });
  });

  it("坏 JSON 和坏参数只返回禁用状态", () => {
    expect(parseRootConfig("{").state).toBe("INVALID");
    expect(
      parseRootConfig(
        JSON.stringify({
          llmTrading: {
            baseUrl: "file:///tmp/model",
            modelId: "model",
          },
        }),
      ).state,
    ).toBe("INVALID");
  });

  it("显式关闭时不要求填写地址和模型", () => {
    const result = parseRootConfig(
      JSON.stringify({ llmTrading: { enabled: false } }),
    );
    expect(result).toMatchObject({ state: "DISABLED", llmTrading: null });
  });

  it("使用 32K、300 秒和单并发默认值并规范地址", () => {
    const result = parseRootConfig(
      JSON.stringify({
        llmTrading: {
          baseUrl: "http://127.0.0.1:8080/v1/",
          modelId: "local-qwen",
        },
      }),
    );

    expect(result.state).toBe("ENABLED");
    expect(result.llmTrading).toMatchObject({
      baseUrl: "http://127.0.0.1:8080/v1",
      modelId: "local-qwen",
      agentCount: 10,
      contextWindow: 32_768,
      requestTimeoutMs: 300_000,
      maxConcurrency: 1,
    });
  });

  it("拒绝伪装成私网的域名和 URL 内嵌凭据", () => {
    for (const baseUrl of [
      "http://10.evil.example/v1",
      "http://user:secret@127.0.0.1:8080/v1",
    ]) {
      expect(
        parseRootConfig(
          JSON.stringify({
            llmTrading: { baseUrl, modelId: "local-qwen" },
          }),
        ).state,
      ).toBe("INVALID");
    }
  });
});
