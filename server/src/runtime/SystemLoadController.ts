import os from "node:os";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { getHeapStatistics } from "node:v8";
import type {
  AITradingStatus,
  RealMarketStatus,
} from "@gupiaomoniqi/shared";

export type LoadLevel = "NORMAL" | "BUSY" | "HIGH_PRESSURE" | "CRITICAL";

export interface SystemLoadSample {
  cpuPercent: number;
  rssRatio: number;
  heapRatio: number;
  eventLoopLagMs: number;
  aiBacklog: number;
  realSweepPressure: number;
  sampledAt: string;
}

export interface SystemLoadControllerStatus {
  enabled: boolean;
  level: LoadLevel;
  sampledAt: string | null;
  metrics: SystemLoadSample | null;
  ai: DynamicAIRuntimeSettings;
  realMarket: DynamicRealMarketSettings;
}

export interface DynamicAIRuntimeSettings {
  activePerRound: number;
  intervalMs: number;
}

export interface DynamicRealMarketSettings {
  concurrency: number;
  hotRefreshIntervalMs: number;
  hotPagesPerRound: number;
  fullSweepTargetMs: number;
}

interface BaseRuntimeSettings {
  aiActivePerRound: number;
  aiRoundIntervalMs: number;
  realConcurrency: number;
  realHotRefreshIntervalMs: number;
  realHotPagesPerRound: number;
  realFullSweepTargetMs: number;
}

interface StatusSources {
  aiStatus: () => AITradingStatus | null;
  realStatus: () => RealMarketStatus | null;
}

interface SystemLoadControllerOptions {
  enabled?: boolean;
  sampleIntervalMs?: number;
  reliefSamples?: number;
  metricsProvider?: () => SystemLoadSample;
}

export class SystemLoadController {
  readonly #eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
  readonly #cpuCount = Math.max(1, os.cpus().length);
  readonly #totalMemoryBytes = Math.max(1, os.totalmem());
  readonly #metricsProvider?: () => SystemLoadSample;
  #timer: NodeJS.Timeout | null = null;
  #lastCpuUsage = process.cpuUsage();
  #lastSampleTime = performance.now();
  #recoverySamples = 0;
  #level: LoadLevel = "NORMAL";
  #lastSample: SystemLoadSample | null = null;
  #aiSettings: DynamicAIRuntimeSettings;
  #realSettings: DynamicRealMarketSettings;

  constructor(
    private readonly sources: StatusSources,
    private readonly base: BaseRuntimeSettings,
    private readonly options: SystemLoadControllerOptions = {},
  ) {
    this.#metricsProvider = options.metricsProvider;
    this.#aiSettings = {
      activePerRound: base.aiActivePerRound,
      intervalMs: base.aiRoundIntervalMs,
    };
    this.#realSettings = {
      concurrency: base.realConcurrency,
      hotRefreshIntervalMs: base.realHotRefreshIntervalMs,
      hotPagesPerRound: base.realHotPagesPerRound,
      fullSweepTargetMs: base.realFullSweepTargetMs,
    };
  }

  start(): void {
    if (!this.enabled || this.#timer) {
      return;
    }
    this.#eventLoopDelay.enable();
    this.sampleNow();
    this.#timer = setInterval(() => {
      this.sampleNow();
    }, this.sampleIntervalMs);
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
    this.#eventLoopDelay.disable();
  }

  sampleNow(): SystemLoadSample {
    const sample = this.#metricsProvider
      ? this.#metricsProvider()
      : this.#collectSample();
    const desiredLevel = classifyLoad(sample);
    if (rank(desiredLevel) > rank(this.#level)) {
      this.#level = desiredLevel;
      this.#recoverySamples = 0;
    } else if (rank(desiredLevel) < rank(this.#level)) {
      this.#recoverySamples += 1;
      if (this.#recoverySamples >= this.reliefSamples) {
        this.#level = desiredLevel;
        this.#recoverySamples = 0;
      }
    } else {
      this.#recoverySamples = 0;
    }
    this.#lastSample = sample;
    this.#applyLevel(this.#level);
    return sample;
  }

  getAiSettings(): DynamicAIRuntimeSettings {
    return { ...this.#aiSettings };
  }

  getRealMarketSettings(): DynamicRealMarketSettings {
    return { ...this.#realSettings };
  }

  getStatus(): SystemLoadControllerStatus {
    return {
      enabled: this.enabled,
      level: this.#level,
      sampledAt: this.#lastSample?.sampledAt ?? null,
      metrics: this.#lastSample ? { ...this.#lastSample } : null,
      ai: this.getAiSettings(),
      realMarket: this.getRealMarketSettings(),
    };
  }

  get enabled(): boolean {
    return this.options.enabled ?? true;
  }

  get sampleIntervalMs(): number {
    return this.options.sampleIntervalMs ?? 5_000;
  }

  get reliefSamples(): number {
    return this.options.reliefSamples ?? 3;
  }

  #applyLevel(level: LoadLevel): void {
    const profile = profileForLevel(level);
    this.#aiSettings = {
      activePerRound: Math.max(
        16,
        Math.round(this.base.aiActivePerRound * profile.aiActiveScale),
      ),
      intervalMs: Math.max(
        500,
        Math.round(this.base.aiRoundIntervalMs * profile.aiIntervalScale),
      ),
    };
    this.#realSettings = {
      concurrency: Math.max(
        1,
        Math.round(this.base.realConcurrency * profile.realConcurrencyScale),
      ),
      hotRefreshIntervalMs: Math.max(
        500,
        Math.round(
          this.base.realHotRefreshIntervalMs * profile.realHotIntervalScale,
        ),
      ),
      hotPagesPerRound: Math.max(
        1,
        Math.round(
          this.base.realHotPagesPerRound * profile.realHotPagesScale,
        ),
      ),
      fullSweepTargetMs: Math.max(
        5_000,
        Math.round(
          this.base.realFullSweepTargetMs * profile.realFullSweepScale,
        ),
      ),
    };
  }

  #collectSample(): SystemLoadSample {
    const now = performance.now();
    const elapsedMs = Math.max(1, now - this.#lastSampleTime);
    const cpuUsage = process.cpuUsage(this.#lastCpuUsage);
    this.#lastCpuUsage = process.cpuUsage();
    this.#lastSampleTime = now;
    const cpuPercent = Math.min(
      100,
      ((cpuUsage.user + cpuUsage.system) / 1_000 / elapsedMs / this.#cpuCount) *
        100,
    );
    const memory = process.memoryUsage();
    const heapLimitBytes = Math.max(1, getHeapStatistics().heap_size_limit);
    const eventLoopLagMs = this.#eventLoopDelay.mean / 1_000_000;
    this.#eventLoopDelay.reset();
    return {
      cpuPercent,
      rssRatio: memory.rss / this.#totalMemoryBytes,
      heapRatio:
        memory.heapUsed / heapLimitBytes,
      eventLoopLagMs,
      aiBacklog: this.sources.aiStatus()?.dueBacklog ?? 0,
      realSweepPressure: computeRealSweepPressure(this.sources.realStatus()),
      sampledAt: new Date().toISOString(),
    };
  }
}

function computeRealSweepPressure(
  status: RealMarketStatus | null,
): number {
  if (!status) {
    return 0;
  }
  const failedPages = status.markets.reduce(
    (total, market) => total + market.failedPages,
    0,
  );
  const totalPages = status.markets.reduce(
    (total, market) => total + Math.max(1, market.totalPages),
    0,
  );
  const durationPressure =
    status.lastCompletedSweepDurationMs && status.fullSweepTargetMs > 0
      ? status.lastCompletedSweepDurationMs / status.fullSweepTargetMs
      : 0;
  const failurePressure = totalPages > 0 ? failedPages / totalPages : 0;
  return durationPressure + failurePressure;
}

function classifyLoad(sample: SystemLoadSample): LoadLevel {
  if (
    sample.cpuPercent >= 90 ||
    sample.rssRatio >= 0.9 ||
    sample.heapRatio >= 0.9 ||
    sample.eventLoopLagMs >= 150 ||
    sample.realSweepPressure >= 1.35
  ) {
    return "CRITICAL";
  }
  if (
    sample.cpuPercent >= 78 ||
    sample.rssRatio >= 0.82 ||
    sample.heapRatio >= 0.82 ||
    sample.eventLoopLagMs >= 80 ||
    sample.realSweepPressure >= 1
  ) {
    return "HIGH_PRESSURE";
  }
  if (
    sample.cpuPercent >= 65 ||
    sample.rssRatio >= 0.72 ||
    sample.heapRatio >= 0.74 ||
    sample.eventLoopLagMs >= 35 ||
    sample.realSweepPressure >= 0.7
  ) {
    return "BUSY";
  }
  return "NORMAL";
}

function profileForLevel(level: LoadLevel): {
  aiActiveScale: number;
  aiIntervalScale: number;
  realConcurrencyScale: number;
  realHotIntervalScale: number;
  realHotPagesScale: number;
  realFullSweepScale: number;
} {
  switch (level) {
    case "BUSY":
      return {
        aiActiveScale: 0.85,
        aiIntervalScale: 1.25,
        realConcurrencyScale: 0.85,
        realHotIntervalScale: 1.2,
        realHotPagesScale: 0.85,
        realFullSweepScale: 1.15,
      };
    case "HIGH_PRESSURE":
      return {
        aiActiveScale: 0.6,
        aiIntervalScale: 1.6,
        realConcurrencyScale: 0.65,
        realHotIntervalScale: 1.6,
        realHotPagesScale: 0.65,
        realFullSweepScale: 1.4,
      };
    case "CRITICAL":
      return {
        aiActiveScale: 0.35,
        aiIntervalScale: 2,
        realConcurrencyScale: 0.5,
        realHotIntervalScale: 2,
        realHotPagesScale: 0.5,
        realFullSweepScale: 1.8,
      };
    case "NORMAL":
    default:
      return {
        aiActiveScale: 1,
        aiIntervalScale: 1,
        realConcurrencyScale: 1,
        realHotIntervalScale: 1,
        realHotPagesScale: 1,
        realFullSweepScale: 1,
      };
  }
}

function rank(level: LoadLevel): number {
  return {
    NORMAL: 0,
    BUSY: 1,
    HIGH_PRESSURE: 2,
    CRITICAL: 3,
  }[level];
}
