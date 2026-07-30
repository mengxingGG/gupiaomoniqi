import { createApplication } from "../server/src/application.js";

const active = positiveInteger(process.argv[2], 320);
const rounds = positiveInteger(process.argv[3], 1);
const intervalMs = positiveInteger(process.argv[4], 1_000);
const loadStartedAt = Date.now();
const context = await createApplication({ aiEnabled: true });
const loadedMs = Date.now() - loadStartedAt;
const results = [];

try {
  for (let index = 0; index < rounds; index += 1) {
    results.push(await context.aiTradingService.runRound(active));
    if (index < rounds - 1) {
      await delay(intervalMs);
    }
  }

  const status = context.aiTradingService.getStatus();
  console.log(
    JSON.stringify(
      {
        loadedMs,
        activePerRound: active,
        rounds,
        intervalMs,
        results,
        status: {
          recentTradesPerMinute: status.recentTradesPerMinute,
          recentTradesPerSecond: status.recentTradesPerSecond,
          dueBacklog: status.dueBacklog,
        },
      },
      null,
      2,
    ),
  );
} finally {
  await context.app.close();
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function positiveInteger(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number(value ?? fallback);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
