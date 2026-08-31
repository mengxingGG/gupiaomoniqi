import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: {
    coverage: {
      reporter: ["text", "html"],
    },
    include: ["test/**/*.test.ts"],
    // 生产服务（真实行情同步、5000 AI、虚拟市场）运行时测试并发创建
    // 多个 PGlite 实例，WASM 初始化可能超过默认 5s；放宽超时并限制并发。
    testTimeout: 30_000,
    hookTimeout: 30_000,
    maxConcurrency: 4,
  },
});
