import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { importMarketSeeds } from "../src/db/importMarketSeeds.js";

describe("importMarketSeeds", () => {
  it("启动初始化会在写数据库前拒绝非 300 只/市场的快照", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "gupiaomoniqi-seed-validation-"),
    );
    const snapshotPath = join(directory, "market-seeds.json");

    try {
      await writeFile(
        snapshotPath,
        JSON.stringify({
          schemaVersion: 1,
          source: "test",
          sourceHost: "example.invalid",
          fetchedAt: new Date().toISOString(),
          selection: "test",
          requestedPerMarket: 100,
          markets: {},
          instruments: [],
        }),
        "utf8",
      );

      await expect(
        importMarketSeeds(snapshotPath, {
          expectedPerMarket: 300,
        }),
      ).rejects.toThrow("每个市场 100 只，预期 300 只");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
