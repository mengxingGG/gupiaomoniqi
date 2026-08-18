import { performance } from "node:perf_hooks";
import { getHeapStatistics } from "node:v8";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { createApplication } from "../server/src/application.js";
import { importMarketSeeds } from "../server/src/db/importMarketSeeds.js";
import { migrateDatabase } from "../server/src/db/migrations.js";
import * as schema from "../server/src/db/schema.js";
import { openRealDatabase } from "../server/src/real-market/db/client.js";

const activePerRound = positiveInteger(process.argv[2], 320);
const traderCount = positiveInteger(process.argv[3], 5_000);
const client = new PGlite();
await client.waitReady;
const virtualConnection = {
  client,
  db: drizzle({ client, schema }),
};
const realConnection = await openRealDatabase(":memory:");
let now = new Date();

await migrateDatabase(client);
await importMarketSeeds("server/data/market-seeds.json", {
  databaseConnection: virtualConnection,
  deleteSnapshotAfterImport: false,
  expectedPerMarket: 300,
});

const startupStartedAt = performance.now();
const context = await createApplication({
  databaseConnection: virtualConnection,
  realDatabaseConnection: realConnection,
  realSyncEnabled: false,
  aiEnabled: true,
  aiTraderCount: traderCount,
  virtualMarketEventsEnabled: false,
  clock: () => now,
});
const startupDurationMs = performance.now() - startupStartedAt;

try {
  now = new Date(now.getTime() + 2 * 60_000);
  const first = await measuredRound();
  const second = await measuredRound();
  console.log(
    JSON.stringify(
      {
        traderCount,
        activePerRound,
        startupDurationMs: roundNumber(startupDurationMs),
        first,
        second,
        status: context.aiTradingService.getStatus(),
        marketState: context.marketStateService.getStatus(),
        memory: memorySnapshot(),
      },
      null,
      2,
    ),
  );
} finally {
  await context.app.close();
  await realConnection.client.close();
  await client.close();
}

async function measuredRound() {
  const startedAt = performance.now();
  const result = await context.aiTradingService.runRound(activePerRound);
  return {
    durationMs: roundNumber(performance.now() - startedAt),
    result,
  };
}

function memorySnapshot() {
  const memory = process.memoryUsage();
  return {
    rssMb: megabytes(memory.rss),
    heapUsedMb: megabytes(memory.heapUsed),
    heapTotalMb: megabytes(memory.heapTotal),
    externalMb: megabytes(memory.external),
    heapLimitMb: megabytes(getHeapStatistics().heap_size_limit),
  };
}

function megabytes(bytes: number): number {
  return roundNumber(bytes / (1024 * 1024));
}

function roundNumber(value: number): number {
  return Math.round(value * 10) / 10;
}

function positiveInteger(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number(value ?? fallback);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
