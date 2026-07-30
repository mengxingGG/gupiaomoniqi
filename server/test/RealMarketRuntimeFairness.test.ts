import { describe, expect, it, vi } from "vitest";
import {
  EastmoneyProvider,
} from "../src/real-market/EastmoneyProvider.js";
import { RealMarketRepository } from "../src/real-market/RealMarketRepository.js";
import { RealMarketRuntime } from "../src/real-market/RealMarketRuntime.js";
import type {
  ProviderInstrumentSnapshot,
  ProviderPage,
  ProviderPageDescriptor,
} from "../src/real-market/types.js";

const runtimeConfig = {
  enabled: true,
  pageSize: 2,
  concurrency: 8,
  fullSweepTargetMs: 5_000,
  hotRefreshIntervalMs: 500,
  hotPagesPerRound: 8,
  requestTimeoutMs: 2_000,
  quoteMaximumReceiveAgeMs: 120_000,
};

describe("真实行情运行时公平调度", () => {
  it("全量同步按并发批次让出宏任务，HTTP 心跳不会等到 326 页全部写完", async () => {
    const totals = { CN: 646, HK: 1, US: 1, UK: 1 } as const;
    const fetchCalls: string[] = [];
    let sweepCompleted = false;
    let resolveFirstSweep!: () => void;
    const firstSweep = new Promise<void>((resolve) => {
      resolveFirstSweep = resolve;
    });
    const repository = fakeRepository({
      completeSweep: () => {
        sweepCompleted = true;
        resolveFirstSweep();
      },
    });
    const provider = fakeProvider(async (market, page) => {
      fetchCalls.push(`${market}:${page}`);
      return providerPage(market, page, totals[market]);
    });
    const runtime = new RealMarketRuntime(
      repository,
      provider,
      runtimeConfig,
    );

    let heartbeatRanBeforeCompletion = false;
    let fetchedPagesAtHeartbeat = 0;
    const heartbeat = new Promise<void>((resolve) => {
      setImmediate(() => {
        heartbeatRanBeforeCompletion = !sweepCompleted;
        fetchedPagesAtHeartbeat = fetchCalls.length;
        resolve();
      });
    });

    await runtime.initialize();
    runtime.start();
    try {
      await firstSweep;
      await heartbeat;

      expect(fetchCalls).toHaveLength(326);
      expect(heartbeatRanBeforeCompletion).toBe(true);
      expect(fetchedPagesAtHeartbeat).toBeGreaterThan(0);
      expect(fetchedPagesAtHeartbeat).toBeLessThan(326);
    } finally {
      runtime.stop();
      await runtime.waitForStop();
    }
  });

  it("全量同步超出目标周期后仍保留最短冷却时间", async () => {
    let nowMs = 0;
    const nowSpy = vi
      .spyOn(Date, "now")
      .mockImplementation(() => nowMs);
    let sweepStarts = 0;
    let completedSweeps = 0;
    let resolveFirstSweep!: () => void;
    const firstSweep = new Promise<void>((resolve) => {
      resolveFirstSweep = resolve;
    });
    const repository = fakeRepository({
      startSweep: () => {
        sweepStarts += 1;
      },
      completeSweep: () => {
        completedSweeps += 1;
        if (completedSweeps === 1) {
          resolveFirstSweep();
        }
      },
    });
    const provider = fakeProvider(async (market, page) => {
      nowMs += 2_000;
      return providerPage(market, page, 1);
    });
    const runtime = new RealMarketRuntime(
      repository,
      provider,
      runtimeConfig,
      async () => new Map(),
      () => new Date(nowMs),
    );

    await runtime.initialize();
    runtime.start();
    try {
      await firstSweep;
      await delay(50);

      expect(
        runtime.getStatus().lastCompletedSweepDurationMs,
      ).toBeGreaterThan(runtimeConfig.fullSweepTargetMs);
      expect(sweepStarts).toBe(1);
    } finally {
      runtime.stop();
      await runtime.waitForStop();
      nowSpy.mockRestore();
    }
  });

  it("首次热点刷新等待刷新间隔，不与启动时的全量首页争抢", async () => {
    const fetchCounts = new Map<string, number>();
    let resolveFirstSweep!: () => void;
    const firstSweep = new Promise<void>((resolve) => {
      resolveFirstSweep = resolve;
    });
    const repository = fakeRepository({
      completeSweep: resolveFirstSweep,
      sourcePage: () => ({ market: "CN", page: 1 }),
    });
    const provider = fakeProvider(async (market, page) => {
      const key = `${market}:${page}`;
      fetchCounts.set(key, (fetchCounts.get(key) ?? 0) + 1);
      return providerPage(market, page, 1);
    });
    const runtime = new RealMarketRuntime(
      repository,
      provider,
      runtimeConfig,
      async () => new Map([["hot-id", 10_000]]),
    );

    await runtime.initialize();
    runtime.start();
    try {
      await firstSweep;
      await delay(50);

      expect(fetchCounts.get("CN:1")).toBe(1);
    } finally {
      runtime.stop();
      await runtime.waitForStop();
    }
  });

  it("热点优先级读取单次失败不会产生未处理 rejection，后续轮次仍会继续", async () => {
    vi.useFakeTimers();
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    process.on("unhandledRejection", onUnhandledRejection);

    const prioritySource = vi.fn(async () => {
      if (prioritySource.mock.calls.length === 2) {
        throw new Error("priority source failed once");
      }
      return new Map<string, number>();
    });
    const runtime = new RealMarketRuntime(
      fakeRepository(),
      fakeProvider(async (market, page) =>
        providerPage(market, page, 0),
      ),
      runtimeConfig,
      prioritySource,
    );

    await runtime.initialize();
    runtime.start();
    try {
      await vi.advanceTimersByTimeAsync(
        runtimeConfig.hotRefreshIntervalMs,
      );
      expect(prioritySource).toHaveBeenCalledTimes(2);
      expect(runtime.getStatus().lastError).toBe(
        "priority source failed once",
      );

      await vi.advanceTimersByTimeAsync(
        runtimeConfig.hotRefreshIntervalMs,
      );
      expect(prioritySource).toHaveBeenCalledTimes(3);
      expect(unhandledRejections).toEqual([]);
    } finally {
      runtime.stop();
      await vi.runAllTimersAsync();
      await runtime.waitForStop();
      process.off("unhandledRejection", onUnhandledRejection);
      vi.useRealTimers();
    }
  });
});

describe("RealMarketRuntime PGlite 写入队列", () => {
  it("全量页面写入保持单路，不并发冲击数据库主线程", async () => {
    let activeWrites = 0;
    let maximumActiveWrites = 0;
    let resolveFirstSweep!: () => void;
    const firstSweep = new Promise<void>((resolve) => {
      resolveFirstSweep = resolve;
    });
    const repository = fakeRepository({
      completeSweep: resolveFirstSweep,
      upsertProviderPage: async () => {
        activeWrites += 1;
        maximumActiveWrites = Math.max(
          maximumActiveWrites,
          activeWrites,
        );
        await delay(2);
        activeWrites -= 1;
      },
    });
    const provider = fakeProvider(async (market, page) =>
      providerPage(market, page, market === "CN" ? 40 : 1),
    );
    const runtime = new RealMarketRuntime(
      repository,
      provider,
      {
        ...runtimeConfig,
        pageSize: 2,
        concurrency: 8,
      },
    );

    await runtime.initialize();
    runtime.start();
    try {
      await firstSweep;
      expect(maximumActiveWrites).toBe(1);
    } finally {
      runtime.stop();
      await runtime.waitForStop();
    }
  });
});

describe("RealMarketRuntime 报价通知", () => {
  it("同一股票重复报价只向监听器发布首条", async () => {
    let resolveFirstSweep!: () => void;
    const firstSweep = new Promise<void>((resolve) => {
      resolveFirstSweep = resolve;
    });
    const repository = fakeRepository({
      completeSweep: resolveFirstSweep,
    });
    const duplicatePage = providerPage("CN", 1, 2);
    duplicatePage.items = [
      providerSnapshot(100, 0),
      providerSnapshot(999, 1),
    ];
    const provider = fakeProvider(async (market, page) =>
      market === "CN" && page === 1
        ? duplicatePage
        : providerPage(market, page, 0),
    );
    const runtime = new RealMarketRuntime(
      repository,
      provider,
      runtimeConfig,
    );
    const listener = vi.fn();
    runtime.subscribe(listener);

    await runtime.initialize();
    runtime.start();
    try {
      await firstSweep;

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0]?.[0]).toEqual([
        expect.objectContaining({
          instrumentId: "real-cn-1-600519",
          currentPrice: 100,
        }),
      ]);
    } finally {
      runtime.stop();
      await runtime.waitForStop();
    }
  });
});

function fakeRepository(
  options: {
    startSweep?: () => void;
    completeSweep?: () => void;
    upsertProviderPage?: () => Promise<void>;
    sourcePage?: (
      instrumentId: string,
    ) => ProviderPageDescriptor | undefined;
  } = {},
): RealMarketRepository {
  return {
    getPageStates: () => [],
    latestCompletedSweep: async () => null,
    startSweep: async () => options.startSweep?.(),
    upsertProviderPage: async () =>
      options.upsertProviderPage?.(),
    completeSweep: async () => options.completeSweep?.(),
    recordPageFailure: async () => undefined,
    getSourcePage: (instrumentId: string) =>
      options.sourcePage?.(instrumentId),
    listHeldInstrumentIds: async () => new Set<string>(),
    countByMarket: () => 0,
    instrumentCount: 0,
    quotedInstrumentCount: 0,
  } as unknown as RealMarketRepository;
}

function fakeProvider(
  fetchPage: (
    market: "CN" | "HK" | "US" | "UK",
    page: number,
  ) => Promise<ProviderPage>,
): EastmoneyProvider {
  return {
    fetchPage: vi.fn(fetchPage),
    fetchHistory: vi.fn(async () => []),
    fetchOrderBook: vi.fn(),
  } as unknown as EastmoneyProvider;
}

function providerPage(
  market: "CN" | "HK" | "US" | "UK",
  page: number,
  providerTotal: number,
): ProviderPage {
  return {
    market,
    page,
    pageSize: 2,
    providerTotal,
    receivedAt: new Date().toISOString(),
    durationMs: 1,
    items: [],
  };
}

function providerSnapshot(
  currentPrice: number,
  sourceRank: number,
): ProviderInstrumentSnapshot {
  const receivedAt = "2026-07-30T12:00:00.000Z";
  return {
    instrument: {
      id: "real-cn-1-600519",
      providerSecId: "1.600519",
      symbol: "600519",
      name: sourceRank === 0 ? "贵州茅台" : "重复条目",
      market: "CN",
      sourceCurrency: "CNY",
      quoteCurrency: "CNY",
      type: "STOCK_REAL",
      industry: "白酒",
      isTradable: true,
      lotSize: 100,
      settlementCycle: "T1",
      exchangeCode: "1",
      sourcePage: 1,
      sourceRank,
      sourceUpdatedAt: receivedAt,
      isActive: true,
    },
    quote: {
      instrumentId: "real-cn-1-600519",
      symbol: "600519",
      market: "CN",
      quoteCurrency: "CNY",
      currentPrice,
      previousClose: 98,
      openPrice: 99,
      highPrice: currentPrice,
      lowPrice: 97,
      volume: 10_000,
      amount: currentPrice * 10_000,
      changeAmount: currentPrice - 98,
      changePercent: ((currentPrice - 98) / 98) * 100,
      updatedAt: receivedAt,
      receivedAt,
      rawCurrentPrice: currentPrice,
      rawPreviousClose: 98,
      rawOpenPrice: 99,
      rawHighPrice: currentPrice,
      rawLowPrice: 97,
    },
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
