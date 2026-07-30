import { describe, expect, it, vi } from "vitest";
import { prepareLocalDatabases } from "../src/startup/prepareLocalDatabases.js";

describe("prepareLocalDatabases", () => {
  it("虚拟盘库损坏时会备份后用种子快照重建", async () => {
    const inspectVirtualDatabase = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("Aborted()"))
      .mockResolvedValueOnce();
    const inspectRealDatabase = vi.fn<() => Promise<void>>().mockResolvedValue();
    const rebuildVirtualDatabase = vi.fn<() => Promise<void>>().mockResolvedValue();
    const rebuildRealDatabase = vi.fn<() => Promise<void>>().mockResolvedValue();
    const backupDirectory = vi
      .fn<(path: string) => Promise<string>>()
      .mockImplementation(async (path) => `${path}.broken-20260729-203000`);
    const pathExists = vi.fn<(path: string) => Promise<boolean>>(
      async (path) => !path.endsWith("real-pgdata"),
    );

    const result = await prepareLocalDatabases({
      virtualDatabaseDir: "server/data/pgdata",
      realDatabaseDir: "server/data/real-pgdata",
      marketSeedPath: "server/data/market-seeds.json",
      inspectVirtualDatabase,
      inspectRealDatabase,
      rebuildVirtualDatabase,
      rebuildRealDatabase,
      backupDirectory,
      pathExists,
      now: () => new Date("2026-07-29T20:30:00.000Z"),
    });

    expect(backupDirectory).toHaveBeenCalledWith("server/data/pgdata");
    expect(rebuildVirtualDatabase).toHaveBeenCalledTimes(1);
    expect(inspectVirtualDatabase).toHaveBeenCalledTimes(2);
    expect(rebuildRealDatabase).not.toHaveBeenCalled();
    expect(result.virtual.status).toBe("rebuilt");
    expect(result.virtual.backupPath).toBe(
      "server/data/pgdata.broken-20260729-203000",
    );
    expect(result.real.status).toBe("ready");
  });

  it("真实盘库损坏时会备份并重建为空库", async () => {
    const inspectVirtualDatabase = vi.fn<() => Promise<void>>().mockResolvedValue();
    const inspectRealDatabase = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("Aborted()"))
      .mockResolvedValueOnce();
    const rebuildVirtualDatabase = vi.fn<() => Promise<void>>().mockResolvedValue();
    const rebuildRealDatabase = vi.fn<() => Promise<void>>().mockResolvedValue();
    const backupDirectory = vi
      .fn<(path: string) => Promise<string>>()
      .mockImplementation(async (path) => `${path}.broken-20260729-203500`);
    const pathExists = vi.fn<(path: string) => Promise<boolean>>(async () => true);

    const result = await prepareLocalDatabases({
      virtualDatabaseDir: "server/data/pgdata",
      realDatabaseDir: "server/data/real-pgdata",
      marketSeedPath: "server/data/market-seeds.json",
      inspectVirtualDatabase,
      inspectRealDatabase,
      rebuildVirtualDatabase,
      rebuildRealDatabase,
      backupDirectory,
      pathExists,
      now: () => new Date("2026-07-29T20:35:00.000Z"),
    });

    expect(backupDirectory).toHaveBeenCalledWith("server/data/real-pgdata");
    expect(rebuildRealDatabase).toHaveBeenCalledTimes(1);
    expect(inspectRealDatabase).toHaveBeenCalledTimes(2);
    expect(result.virtual.status).toBe("ready");
    expect(result.real.status).toBe("rebuilt");
    expect(result.real.backupPath).toBe(
      "server/data/real-pgdata.broken-20260729-203500",
    );
  });

  it("虚拟盘和种子都缺失时会先自动获取 1200 只种子再重建", async () => {
    let seedExists = false;
    const inspectVirtualDatabase = vi.fn<() => Promise<void>>().mockResolvedValue();
    const inspectRealDatabase = vi.fn<() => Promise<void>>().mockResolvedValue();
    const rebuildVirtualDatabase = vi.fn<() => Promise<void>>().mockResolvedValue();
    const rebuildRealDatabase = vi.fn<() => Promise<void>>().mockResolvedValue();
    const ensureMarketSeed = vi.fn(async () => {
      seedExists = true;
    });
    const backupDirectory = vi.fn<(path: string) => Promise<string>>();
    const pathExists = vi.fn<(path: string) => Promise<boolean>>(
      async (path) =>
        path.endsWith("market-seeds.json")
          ? seedExists
          : !path.endsWith("pgdata"),
    );

    const result = await prepareLocalDatabases({
      virtualDatabaseDir: "server/data/pgdata",
      realDatabaseDir: "server/data/real-pgdata",
      marketSeedPath: "server/data/market-seeds.json",
      inspectVirtualDatabase,
      inspectRealDatabase,
      rebuildVirtualDatabase,
      rebuildRealDatabase,
      ensureMarketSeed,
      backupDirectory,
      pathExists,
    });

    expect(ensureMarketSeed).toHaveBeenCalledTimes(1);
    expect(rebuildVirtualDatabase).toHaveBeenCalledTimes(1);
    expect(inspectVirtualDatabase).toHaveBeenCalledTimes(1);
    expect(result.virtual.status).toBe("rebuilt");
  });

  it("虚拟盘数据库有效时不会因为临时种子已删除而重新抓取", async () => {
    const inspectVirtualDatabase = vi.fn<() => Promise<void>>().mockResolvedValue();
    const inspectRealDatabase = vi.fn<() => Promise<void>>().mockResolvedValue();
    const rebuildVirtualDatabase = vi.fn<() => Promise<void>>().mockResolvedValue();
    const rebuildRealDatabase = vi.fn<() => Promise<void>>().mockResolvedValue();
    const ensureMarketSeed = vi.fn<() => Promise<void>>().mockResolvedValue();
    const backupDirectory = vi.fn<(path: string) => Promise<string>>();
    const pathExists = vi.fn<(path: string) => Promise<boolean>>(
      async (path) => !path.endsWith("market-seeds.json"),
    );

    const result = await prepareLocalDatabases({
      virtualDatabaseDir: "server/data/pgdata",
      realDatabaseDir: "server/data/real-pgdata",
      marketSeedPath: "server/data/market-seeds.json",
      inspectVirtualDatabase,
      inspectRealDatabase,
      rebuildVirtualDatabase,
      rebuildRealDatabase,
      ensureMarketSeed,
      backupDirectory,
      pathExists,
    });

    expect(ensureMarketSeed).not.toHaveBeenCalled();
    expect(rebuildVirtualDatabase).not.toHaveBeenCalled();
    expect(result.virtual.status).toBe("ready");
  });

  it("虚拟盘库缺失且没有种子快照时会给出明确错误", async () => {
    const inspectVirtualDatabase = vi.fn<() => Promise<void>>().mockResolvedValue();
    const inspectRealDatabase = vi.fn<() => Promise<void>>().mockResolvedValue();
    const rebuildVirtualDatabase = vi.fn<() => Promise<void>>().mockResolvedValue();
    const rebuildRealDatabase = vi.fn<() => Promise<void>>().mockResolvedValue();
    const backupDirectory = vi.fn<(path: string) => Promise<string>>();
    const pathExists = vi.fn<(path: string) => Promise<boolean>>(
      async (path) => !path.endsWith("pgdata") && !path.endsWith("market-seeds.json"),
    );

    await expect(
      prepareLocalDatabases({
        virtualDatabaseDir: "server/data/pgdata",
        realDatabaseDir: "server/data/real-pgdata",
        marketSeedPath: "server/data/market-seeds.json",
        inspectVirtualDatabase,
        inspectRealDatabase,
        rebuildVirtualDatabase,
        rebuildRealDatabase,
        backupDirectory,
        pathExists,
        now: () => new Date("2026-07-29T20:40:00.000Z"),
      }),
    ).rejects.toThrow("虚拟盘数据库缺失，且找不到 market-seeds.json");
  });

  it("虚拟盘库第一次备份遇到占用失败时允许重试后继续重建", async () => {
    const inspectVirtualDatabase = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("Aborted()"))
      .mockResolvedValueOnce();
    const inspectRealDatabase = vi.fn<() => Promise<void>>().mockResolvedValue();
    const rebuildVirtualDatabase = vi.fn<() => Promise<void>>().mockResolvedValue();
    const rebuildRealDatabase = vi.fn<() => Promise<void>>().mockResolvedValue();
    const backupDirectory = vi
      .fn<(path: string) => Promise<string>>()
      .mockRejectedValueOnce(Object.assign(new Error("EPERM"), { code: "EPERM" }))
      .mockResolvedValueOnce("server/data/pgdata.broken-20260729-214625");
    const pathExists = vi.fn<(path: string) => Promise<boolean>>(async () => true);

    const result = await prepareLocalDatabases({
      virtualDatabaseDir: "server/data/pgdata",
      realDatabaseDir: "server/data/real-pgdata",
      marketSeedPath: "server/data/market-seeds.json",
      inspectVirtualDatabase,
      inspectRealDatabase,
      rebuildVirtualDatabase,
      rebuildRealDatabase,
      backupDirectory,
      pathExists,
      now: () => new Date("2026-07-29T21:46:25.000Z"),
      delayMs: vi.fn(async () => undefined),
    });

    expect(backupDirectory).toHaveBeenCalledTimes(2);
    expect(rebuildVirtualDatabase).toHaveBeenCalledTimes(1);
    expect(result.virtual.status).toBe("rebuilt");
    expect(result.virtual.backupPath).toBe(
      "server/data/pgdata.broken-20260729-214625",
    );
  });
});
