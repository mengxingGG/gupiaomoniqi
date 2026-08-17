import { performance } from "node:perf_hooks";
import { getHeapStatistics } from "node:v8";
import { createApplication } from "../server/src/application.js";
import { openRealDatabase } from "../server/src/real-market/db/client.js";

const activePerRound = positiveInteger(process.argv[2], 320);
const useStoredRealDatabase = process.argv.includes("--stored-real");
let now = new Date();
const isolatedRealConnection = useStoredRealDatabase
  ? null
  : await openRealDatabase(":memory:");
const startupStartedAt = performance.now();
const context = await createApplication({
  aiEnabled: true,
  ...(isolatedRealConnection
    ? { realDatabaseConnection: isolatedRealConnection }
    : {}),
  realSyncEnabled: false,
  clock: () => now,
});
const startupDurationMs = performance.now() - startupStartedAt;

try {
  const memoryAfterStartup = memorySnapshot();
  now = new Date(now.getTime() + 2 * 60_000);
  const roundStartedAt = performance.now();
  const round = await context.aiTradingService.runRound(activePerRound);
  const measuredRoundDurationMs = performance.now() - roundStartedAt;

  console.log(
    JSON.stringify(
      {
        startupDurationMs: roundNumber(startupDurationMs),
        activePerRound,
        measuredRoundDurationMs: roundNumber(measuredRoundDurationMs),
        round,
        status: context.aiTradingService.getStatus(),
        memoryAfterStartup,
        memoryAfterRound: memorySnapshot(),
      },
      null,
      2,
    ),
  );
} finally {
  await context.app.close();
  await isolatedRealConnection?.client.close();
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
