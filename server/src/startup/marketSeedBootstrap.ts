import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { DatabaseConnection } from "../db/client.js";
import {
  getDefaultMarketSeedPath,
  importMarketSeeds,
} from "../db/importMarketSeeds.js";

const execFileAsync = promisify(execFile);
const workspaceRoot = fileURLToPath(
  new URL("../../../", import.meta.url),
);
const marketSeedFetcherPath = fileURLToPath(
  new URL("../../../scripts/fetch-market-seeds.mjs", import.meta.url),
);
const expectedMarkets = ["CN", "HK", "US", "UK"] as const;
export const VIRTUAL_MARKET_SEED_COUNT_PER_MARKET = 300;

interface MarketUniverseCount {
  market: string;
  instrument_count: number;
  quote_count: number;
}

export interface VirtualMarketBootstrapResult {
  status: "ready" | "initialized";
  instrumentCount: number;
  snapshotCreated: boolean;
}

export async function ensureVirtualMarketUniverse(
  connection: DatabaseConnection,
  options: {
    marketSeedPath?: string;
    log?: (message: string) => void;
  } = {},
): Promise<VirtualMarketBootstrapResult> {
  const log = options.log ?? console.log;
  const marketSeedPath =
    options.marketSeedPath ??
    process.env.MARKET_SEED_PATH ??
    getDefaultMarketSeedPath();
  const before = await readMarketUniverseCounts(connection);

  if (isCompleteUniverse(before)) {
    return {
      status: "ready",
      instrumentCount:
        expectedMarkets.length * VIRTUAL_MARKET_SEED_COUNT_PER_MARKET,
      snapshotCreated: false,
    };
  }

  const existingInstrumentCount = totalInstruments(before);
  if (existingInstrumentCount > 0) {
    throw new Error(
      "虚拟盘股票池不完整，系统不会自动覆盖已有账户和交易数据。" +
        `当前 ${formatCounts(before)}，预期 CN/HK/US/UK 各 ${VIRTUAL_MARKET_SEED_COUNT_PER_MARKET}。`,
    );
  }

  let snapshotCreated = false;
  if (!(await pathExists(marketSeedPath))) {
    snapshotCreated = true;
    await fetchMarketSeedSnapshot(marketSeedPath, log);
  } else {
    log(`[PREP] 使用已有虚拟盘种子：${marketSeedPath}`);
  }

  await importMarketSeeds(marketSeedPath, {
    databaseConnection: connection,
    deleteSnapshotAfterImport: true,
    expectedPerMarket: VIRTUAL_MARKET_SEED_COUNT_PER_MARKET,
  });

  const after = await readMarketUniverseCounts(connection);
  if (!isCompleteUniverse(after)) {
    throw new Error(
      `虚拟盘初始化后复核失败：${formatCounts(after)}`,
    );
  }

  return {
    status: "initialized",
    instrumentCount:
      expectedMarkets.length * VIRTUAL_MARKET_SEED_COUNT_PER_MARKET,
    snapshotCreated,
  };
}

export async function fetchMarketSeedSnapshot(
  marketSeedPath: string,
  log: (message: string) => void = console.log,
): Promise<void> {
  log(
    "[PREP] 未找到虚拟盘种子，开始从东方财富获取 CN/HK/US/UK 各 300 只股票（共 1200 只）...",
  );
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [
      marketSeedFetcherPath,
      "--count",
      String(VIRTUAL_MARKET_SEED_COUNT_PER_MARKET),
      "--output",
      marketSeedPath,
    ],
    {
      cwd: workspaceRoot,
      env: process.env,
      maxBuffer: 20 * 1024 * 1024,
      windowsHide: true,
    },
  );

  if (stdout.trim()) {
    log(stdout.trim());
  }
  if (stderr.trim()) {
    console.error(stderr.trim());
  }
}

async function readMarketUniverseCounts(
  connection: DatabaseConnection,
): Promise<MarketUniverseCount[]> {
  const result = await connection.client.query<MarketUniverseCount>(
    `SELECT i.market,
            count(*)::int AS instrument_count,
            count(q.instrument_id)::int AS quote_count
       FROM instruments i
       LEFT JOIN quotes q ON q.instrument_id = i.id
      WHERE i.type = 'STOCK_VIRTUAL'
      GROUP BY i.market
      ORDER BY i.market`,
  );
  return result.rows;
}

function isCompleteUniverse(counts: MarketUniverseCount[]): boolean {
  return expectedMarkets.every((market) => {
    const count = counts.find((item) => item.market === market);
    return (
      count?.instrument_count === VIRTUAL_MARKET_SEED_COUNT_PER_MARKET &&
      count.quote_count === VIRTUAL_MARKET_SEED_COUNT_PER_MARKET
    );
  });
}

function totalInstruments(counts: MarketUniverseCount[]): number {
  return counts.reduce(
    (total, item) => total + item.instrument_count,
    0,
  );
}

function formatCounts(counts: MarketUniverseCount[]): string {
  return expectedMarkets
    .map((market) => {
      const count = counts.find((item) => item.market === market);
      return `${market} ${count?.instrument_count ?? 0}/${count?.quote_count ?? 0}`;
    })
    .join("，");
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
