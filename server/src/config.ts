import os from "node:os";
import {
  MINIMUM_TRADE_FEE_USD,
  VIRTUAL_TRADE_FEE_RATE,
} from "@gupiaomoniqi/shared";

export interface VirtualRuntimeProfile {
  aiTraderCount: number;
  aiActivePerRound: number;
  aiRoundIntervalMs: number;
}

export function recommendVirtualRuntimeProfile(input: {
  cpuCount: number;
  totalMemoryBytes: number;
}): VirtualRuntimeProfile {
  const memoryGiB = input.totalMemoryBytes / (1024 ** 3);
  if (input.cpuCount <= 2 || memoryGiB <= 4.5) {
    return {
      aiTraderCount: 1_800,
      aiActivePerRound: 64,
      aiRoundIntervalMs: 4_000,
    };
  }
  if (input.cpuCount <= 4 || memoryGiB <= 8.5) {
    return {
      aiTraderCount: 3_200,
      aiActivePerRound: 160,
      aiRoundIntervalMs: 1_200,
    };
  }
  return {
    aiTraderCount: 5_000,
    aiActivePerRound: 320,
    aiRoundIntervalMs: 1_000,
  };
}

const VIRTUAL_RUNTIME_PROFILE = recommendVirtualRuntimeProfile({
  cpuCount: os.cpus().length,
  totalMemoryBytes: os.totalmem(),
});

export const GAME_RULES = {
  initialCashUsd: 1_000_000,
  usdCnyDisplayRate: 7,
  feeRate: VIRTUAL_TRADE_FEE_RATE,
  minimumFeeUsd: MINIMUM_TRADE_FEE_USD,
  tickIntervalMs: 3_000,
  maxTickChangeRate: 0.0035,
  dailyPriceLimitRate: 0.1,
  sessionTtlMs: 30 * 24 * 60 * 60 * 1_000,
  aiTraderCount: Number(
    process.env.AI_TRADER_COUNT ?? VIRTUAL_RUNTIME_PROFILE.aiTraderCount,
  ),
  aiActivePerRound: Number(
    process.env.AI_ACTIVE_PER_ROUND ??
      VIRTUAL_RUNTIME_PROFILE.aiActivePerRound,
  ),
  aiRoundIntervalMs: Number(
    process.env.AI_ROUND_INTERVAL_MS ??
      VIRTUAL_RUNTIME_PROFILE.aiRoundIntervalMs,
  ),
} as const;

export const SERVER_CONFIG = {
  host: process.env.HOST ?? "0.0.0.0",
  port: Number(process.env.PORT ?? 3100),
} as const;

export const SECURITY_CONFIG = {
  allowedOrigins: csvList(process.env.CORS_ALLOWED_ORIGINS, [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ]),
} as const;

export const REAL_MARKET_CONFIG = {
  enabled: process.env.REAL_MARKET_SYNC_ENABLED !== "false",
  pageSize: boundedInteger(
    process.env.REAL_MARKET_PAGE_SIZE,
    100,
    20,
    500,
  ),
  concurrency: boundedInteger(
    process.env.REAL_MARKET_CONCURRENCY,
    2,
    1,
    32,
  ),
  fullSweepTargetMs: boundedInteger(
    process.env.REAL_MARKET_FULL_SWEEP_MS,
    300_000,
    5_000,
    10 * 60_000,
  ),
  hotRefreshIntervalMs: boundedInteger(
    process.env.REAL_MARKET_HOT_REFRESH_MS,
    1_000,
    500,
    60_000,
  ),
  hotPagesPerRound: boundedInteger(
    process.env.REAL_MARKET_HOT_PAGES_PER_ROUND,
    1,
    1,
    32,
  ),
  requestTimeoutMs: boundedInteger(
    process.env.REAL_MARKET_REQUEST_TIMEOUT_MS,
    8_000,
    1_000,
    60_000,
  ),
  quoteMaximumReceiveAgeMs: boundedInteger(
    process.env.REAL_MARKET_QUOTE_MAX_AGE_MS,
    120_000,
    10_000,
    30 * 60_000,
  ),
} as const;

export const LOAD_CONTROLLER_CONFIG = {
  enabled: process.env.LOAD_CONTROLLER_ENABLED !== "false",
  sampleIntervalMs: boundedInteger(
    process.env.LOAD_CONTROLLER_SAMPLE_INTERVAL_MS,
    5_000,
    1_000,
    60_000,
  ),
  reliefSamples: boundedInteger(
    process.env.LOAD_CONTROLLER_RELIEF_SAMPLES,
    3,
    1,
    20,
  ),
} as const;

function boundedInteger(
  input: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = Number(input ?? fallback);

  if (!Number.isInteger(value)) {
    return fallback;
  }

  return Math.min(maximum, Math.max(minimum, value));
}

function csvList(
  value: string | undefined,
  fallback: readonly string[],
): readonly string[] {
  if (!value) {
    return fallback;
  }
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return items.length > 0 ? items : fallback;
}
