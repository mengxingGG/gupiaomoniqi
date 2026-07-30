import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  request as httpRequest,
  type IncomingHttpHeaders,
} from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createApplication,
  type ApplicationContext,
} from "../src/application.js";
import { createTestHarness } from "./helpers.js";

const originalServeWeb = process.env.SERVE_WEB;
const originalWebDistDir = process.env.WEB_DIST_DIR;

let context: ApplicationContext | undefined;
let webRoot: string | undefined;
let cleanupRoot: string | undefined;

beforeEach(() => {
  delete process.env.SERVE_WEB;
  delete process.env.WEB_DIST_DIR;
});

afterEach(async () => {
  if (context) {
    await context.app.close();
    context = undefined;
  }
  if (cleanupRoot) {
    await rm(cleanupRoot, { force: true, recursive: true });
    cleanupRoot = undefined;
  }
  webRoot = undefined;
  restoreEnvironmentVariable("SERVE_WEB", originalServeWeb);
  restoreEnvironmentVariable("WEB_DIST_DIR", originalWebDistDir);
});

describe("production web hosting", () => {
  it("默认关闭静态托管，保持原有 404 行为", async () => {
    const { repository } = await createTestHarness({
      registerAccount: false,
    });
    context = await createApplication({ repository });

    const response = await context.app.inject({
      method: "GET",
      url: "/",
      headers: { accept: "text/html" },
    });

    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toContain(
      "application/json",
    );
  });

  it("通过环境变量启用同进程 SPA，同时保留 API 与 WebSocket 路由优先级", async () => {
    const build = await createWebBuild();
    webRoot = build.root;
    cleanupRoot = build.cleanupRoot;
    process.env.SERVE_WEB = "true";
    process.env.WEB_DIST_DIR = webRoot;

    const { repository } = await createTestHarness({
      registerAccount: false,
    });
    context = await createApplication({ repository });

    const rootResponse = await context.app.inject({
      method: "GET",
      url: "/",
    });
    const deepLinkResponse = await context.app.inject({
      method: "GET",
      url: "/stocks/us-aapl?tab=chart",
      headers: { accept: "text/html,application/xhtml+xml" },
    });
    const assetResponse = await context.app.inject({
      method: "GET",
      url: "/assets/app-abcd1234.js",
    });
    const healthResponse = await context.app.inject({
      method: "GET",
      url: "/api/health",
      headers: { accept: "text/html" },
    });
    const missingApiResponse = await context.app.inject({
      method: "GET",
      url: "/api/does-not-exist",
      headers: { accept: "text/html" },
    });
    const missingWsResponse = await context.app.inject({
      method: "GET",
      url: "/ws/does-not-exist",
      headers: { accept: "text/html" },
    });
    const missingAssetResponse = await context.app.inject({
      method: "GET",
      url: "/missing.png",
      headers: { accept: "image/avif,image/webp,*/*" },
    });

    expect(rootResponse.statusCode).toBe(200);
    expect(rootResponse.body).toContain("production-shell");
    expect(rootResponse.headers["cache-control"]).toBe("no-store");
    expect(rootResponse.headers["content-security-policy"]).toContain(
      "script-src 'self'",
    );

    expect(deepLinkResponse.statusCode).toBe(200);
    expect(deepLinkResponse.body).toContain("production-shell");
    expect(deepLinkResponse.headers["cache-control"]).toBe("no-store");

    expect(assetResponse.statusCode).toBe(200);
    expect(assetResponse.body).toContain("production asset");
    expect(assetResponse.headers["cache-control"]).toBe(
      "public, max-age=31536000, immutable",
    );

    expect(healthResponse.statusCode).toBe(200);
    expect(healthResponse.json().data.status).toBe("ok");
    expect(healthResponse.headers["content-type"]).toContain(
      "application/json",
    );
    expect(healthResponse.headers["content-security-policy"]).toContain(
      "default-src 'none'",
    );

    for (const response of [
      missingApiResponse,
      missingWsResponse,
      missingAssetResponse,
    ]) {
      expect(response.statusCode).toBe(404);
      expect(response.headers["content-type"]).toContain(
        "application/json",
      );
      expect(response.body).not.toContain("production-shell");
    }

    await context.app.ready();
    const socket = await context.app.injectWS(
      "/ws/market?mode=VIRTUAL",
    );
    expect(socket.readyState).toBe(socket.OPEN);
    socket.terminate();
  });

  it("拒绝目录穿越与编码分隔符读取 webRoot 外文件", async () => {
    const build = await createWebBuild();
    webRoot = build.root;
    cleanupRoot = build.cleanupRoot;
    process.env.SERVE_WEB = "true";
    process.env.WEB_DIST_DIR = webRoot;

    const { repository } = await createTestHarness({
      registerAccount: false,
    });
    context = await createApplication({ repository });
    await context.app.listen({ host: "127.0.0.1", port: 0 });

    const attackUrls = [
      `/../${build.outsideFileName}`,
      `/%2E%2E/${build.outsideFileName}`,
      `/assets/../../${build.outsideFileName}`,
      `/assets/%2E%2E/%2E%2E/${build.outsideFileName}`,
      `/assets/..%2F..%2F${build.outsideFileName}`,
      `/assets%2F..%2F..%2F${build.outsideFileName}`,
      `/assets/..%5C..%5C${build.outsideFileName}`,
      `/assets%5C..%5C..%5C${build.outsideFileName}`,
      `/assets/%252E%252E/%252E%252E/${build.outsideFileName}`,
    ];

    for (const url of attackUrls) {
      const response = await rawHttpGet(context.app, url);

      expect(response.statusCode, url).toBeGreaterThanOrEqual(400);
      expect(response.statusCode, url).toBeLessThan(500);
      expect(response.body, url).not.toContain(OUTSIDE_SECRET);
      expect(response.body, url).not.toContain("production-shell");
      expect(
        String(response.headers["content-type"] ?? ""),
        url,
      ).not.toContain("text/html");
    }
  });

  it("恶意规范化路径不能绕过 API 与 WebSocket 命名空间", async () => {
    const build = await createWebBuild();
    webRoot = build.root;
    cleanupRoot = build.cleanupRoot;
    process.env.SERVE_WEB = "true";
    process.env.WEB_DIST_DIR = webRoot;

    const { repository } = await createTestHarness({
      registerAccount: false,
    });
    context = await createApplication({ repository });
    await context.app.listen({ host: "127.0.0.1", port: 0 });

    const attackUrls = [
      "/public/../api/private.txt",
      "/public/%2E%2E/api/private.txt",
      "/public/..%2Fapi%2Fprivate.txt",
      "/public%2F..%2Fapi%2Fprivate.txt",
      "/public/..%5Capi%5Cprivate.txt",
      "/public/%252E%252E/api/private.txt",
      "/%61pi/private.txt",
      "/public/../ws/private.txt",
      "/public/%2E%2E/ws/private.txt",
      "/public/..%2Fws%2Fprivate.txt",
      "/public%2F..%2Fws%2Fprivate.txt",
      "/public/..%5Cws%5Cprivate.txt",
      "/public/%252E%252E/ws/private.txt",
      "/%77s/private.txt",
    ];

    for (const url of attackUrls) {
      const response = await rawHttpGet(context.app, url);

      expect(response.statusCode, url).toBeGreaterThanOrEqual(400);
      expect(response.statusCode, url).toBeLessThan(500);
      expect(response.body, url).not.toContain(API_NAMESPACE_SECRET);
      expect(response.body, url).not.toContain(WS_NAMESPACE_SECRET);
      expect(response.body, url).not.toContain("production-shell");
      expect(
        String(response.headers["content-type"] ?? ""),
        url,
      ).not.toContain("text/html");
    }
  });

  it("启用静态托管但缺少构建入口时快速失败", async () => {
    cleanupRoot = await mkdtemp(
      join(tmpdir(), "gupiaomoniqi-empty-web-"),
    );
    webRoot = cleanupRoot;
    const { repository } = await createTestHarness({
      registerAccount: false,
    });

    await expect(
      createApplication({
        repository,
        serveWeb: true,
        webRoot,
      }),
    ).rejects.toThrow(/Run "npm run build"/);
  });
});

const OUTSIDE_SECRET = "outside-web-root-secret";
const API_NAMESPACE_SECRET = "api-namespace-secret";
const WS_NAMESPACE_SECRET = "ws-namespace-secret";

interface TestWebBuild {
  root: string;
  cleanupRoot: string;
  outsideFileName: string;
}

async function createWebBuild(): Promise<TestWebBuild> {
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "gupiaomoniqi-static-web-"),
  );
  const root = join(temporaryRoot, "web");
  const assets = join(root, "assets");
  const api = join(root, "api");
  const ws = join(root, "ws");
  await Promise.all([
    mkdir(assets, { recursive: true }),
    mkdir(api, { recursive: true }),
    mkdir(ws, { recursive: true }),
  ]);
  await writeFile(
    join(root, "index.html"),
    [
      "<!doctype html>",
      '<html><body><div id="production-shell"></div></body></html>',
    ].join(""),
    "utf8",
  );
  await writeFile(
    join(assets, "app-abcd1234.js"),
    'console.log("production asset");',
    "utf8",
  );
  await Promise.all([
    writeFile(
      join(temporaryRoot, "outside-secret.txt"),
      OUTSIDE_SECRET,
      "utf8",
    ),
    writeFile(
      join(api, "private.txt"),
      API_NAMESPACE_SECRET,
      "utf8",
    ),
    writeFile(
      join(ws, "private.txt"),
      WS_NAMESPACE_SECRET,
      "utf8",
    ),
  ]);
  return {
    root,
    cleanupRoot: temporaryRoot,
    outsideFileName: "outside-secret.txt",
  };
}

async function rawHttpGet(
  app: ApplicationContext["app"],
  path: string,
): Promise<{
  statusCode: number;
  headers: IncomingHttpHeaders;
  body: string;
}> {
  const address = app.server.address();
  if (!address || typeof address === "string") {
    throw new Error("测试服务器没有可用的 TCP 监听地址");
  }

  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port: address.port,
        method: "GET",
        path,
        headers: {
          accept: "text/html",
          connection: "close",
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    request.setTimeout(2_000, () => {
      request.destroy(new Error("恶意路径回归请求超时"));
    });
    request.on("error", reject);
    request.end();
  });
}

function restoreEnvironmentVariable(
  name: "SERVE_WEB" | "WEB_DIST_DIR",
  value: string | undefined,
): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
