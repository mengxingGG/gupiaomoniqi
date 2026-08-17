import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadRootConfig,
  parseRootConfig,
  resolveRootConfigPath,
} from "../src/config/RootConfig.js";

describe("RootConfig LLM 配置", () => {
  it("文件不存在时安静禁用", async () => {
    const result = await loadRootConfig({
      path: "C:/missing/config.json",
      readText: async () => {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      },
    });

    expect(result).toMatchObject({
      state: "MISSING",
      llmTrading: null,
      error: null,
      smtpState: "MISSING",
      smtp: null,
      smtpError: null,
    });
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

  it("统一按显式路径、APP_CONFIG_PATH、工作目录的顺序解析", () => {
    const previous = process.env.APP_CONFIG_PATH;
    const environmentPath = "persistent/config.json";
    try {
      process.env.APP_CONFIG_PATH = environmentPath;
      expect(resolveRootConfigPath()).toBe(
        resolve(process.cwd(), environmentPath),
      );
      expect(resolveRootConfigPath("explicit/config.json")).toBe(
        resolve(process.cwd(), "explicit/config.json"),
      );
    } finally {
      if (previous === undefined) {
        delete process.env.APP_CONFIG_PATH;
      } else {
        process.env.APP_CONFIG_PATH = previous;
      }
    }
  });

  it("读取 QQ 邮箱 SSL 配置且 SMTP 错误不影响有效 LLM", () => {
    const valid = parseRootConfig(
      JSON.stringify({
        smtp: {
          host: "smtp.qq.com",
          port: 465,
          secure: true,
          user: "mailer@qq.com",
          pass: "authorization-code",
          from: "股票模拟器 <mailer@qq.com>",
        },
      }),
    );
    expect(valid).toMatchObject({
      state: "DISABLED",
      smtpState: "ENABLED",
      smtp: {
        host: "smtp.qq.com",
        port: 465,
        secure: true,
        requireTls: false,
        user: "mailer@qq.com",
      },
    });

    const invalidSmtp = parseRootConfig(
      JSON.stringify({
        llmTrading: {
          baseUrl: "http://127.0.0.1:8080/v1",
          modelId: "local-qwen",
        },
        smtp: {
          host: "smtp.qq.com",
          from: "股票模拟器 <mailer@qq.com>",
          user: "mailer@qq.com",
        },
      }),
    );
    expect(invalidSmtp.state).toBe("ENABLED");
    expect(invalidSmtp.llmTrading).not.toBeNull();
    expect(invalidSmtp).toMatchObject({
      smtpState: "INVALID",
      smtp: null,
    });
  });
});
