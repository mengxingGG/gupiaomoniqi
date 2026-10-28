import { randomUUID } from "node:crypto";
import type {
  ChartRange,
  OrderBookSnapshot,
  Quote,
  RealMarketMarketStatus,
  RealMarketStatus,
  StockMarket,
} from "@gupiaomoniqi/shared";
import type { REAL_MARKET_CONFIG } from "../config.js";
import {
  EastmoneyProvider,
  REAL_MARKETS,
} from "./EastmoneyProvider.js";
import { RealMarketRepository } from "./RealMarketRepository.js";
import { isMarketTradingTime, quoteMaximumAgeMs } from "./tradingHours.js";
import type { SupplementalMarketProvider } from "./SupplementalMarketProvider.js";
import type {
  ProviderPage,
  ProviderPageDescriptor,
  RealQuoteRecord,
} from "./types.js";

type RealMarketRuntimeConfig = typeof REAL_MARKET_CONFIG;
type QuoteListener = (quotes: Quote[]) => void;
type PrioritySource = () => Promise<Map<string, number>>;
type RuntimeSettingsSource = () => Partial<{
  concurrency: number;
  hotRefreshIntervalMs: number;
  hotPagesPerRound: number;
  fullSweepTargetMs: number;
}>;

interface MarketProgress {
  providerTotal: number;
  totalPages: number;
  completedPages: number;
  failedPages: number;
  instrumentRows: number;
  lastSuccessAt: string | null;
}

interface ViewPriority {
  score: number;
  expiresAt: number;
}

const DETAIL_PRIORITY_SCORE = 20_000;
const VISIBLE_PRIORITY_SCORE = 100;
const HELD_PRIORITY_SCORE = 15_000;
const MIN_FULL_SWEEP_COOLDOWN_MS = 1_000;

export class RealMarketRuntime {
  readonly #listeners = new Set<QuoteListener>();
  readonly #inFlightFetches = new Map<string, Promise<ProviderPage>>();
  readonly #viewPriorities = new Map<string, ViewPriority>();
  #latestPriorities = new Map<string, number>();
  readonly #historyRequests = new Map<string, Promise<HistoryResult>>();
  readonly #orderBookRequests = new Map<string, Promise<OrderBookResult>>();
  readonly #orderBookCache = new Map<
    string,
    { snapshot: OrderBookSnapshot; expiresAt: number }
  >();
  #writeQueue: Promise<void> = Promise.resolve();
  readonly #abortController = new AbortController();
  readonly #progress = new Map<StockMarket, MarketProgress>();
  #running = false;
  #stopped = false;
  #hotTimer: ReturnType<typeof setTimeout> | undefined;
  #hotRoundRunning = false;
  #fullLoop: Promise<void> | undefined;
  #activeSweepId: string | null = null;
  #activeSweepStartedAt: string | null = null;
  #lastCompletedSweepAt: string | null = null;
  #lastCompletedSweepDurationMs: number | null = null;
  #lastError: string | null = null;
  #lastSweepFailedPages = 0;
  #hotPageCount = 0;
  readonly #gapFill = { quotes: 0, histories: 0, orderBooks: 0, lastSuccessAt: null as string | null };
  #effectiveSettings!: {
    concurrency: number;
    hotRefreshIntervalMs: number;
    hotPagesPerRound: number;
    fullSweepTargetMs: number;
  };

  constructor(
    private readonly repository: RealMarketRepository,
    private readonly provider: EastmoneyProvider,
    private readonly config: RealMarketRuntimeConfig,
    private readonly prioritySource: PrioritySource = async () =>
      new Map(),
    private readonly clock: () => Date = () => new Date(),
    private readonly runtimeSettingsSource?: RuntimeSettingsSource,
    private readonly supplemental?: Pick<SupplementalMarketProvider, "fetchQuotes" | "fetchHistory" | "fetchOrderBook">,
  ) {
    this.#effectiveSettings = {
      concurrency: this.config.concurrency,
      hotRefreshIntervalMs: this.config.hotRefreshIntervalMs,
      hotPagesPerRound: this.config.hotPagesPerRound,
      fullSweepTargetMs: this.config.fullSweepTargetMs,
    };
    for (const market of REAL_MARKETS) {
      this.#progress.set(market, emptyProgress());
    }
  }

  async initialize(): Promise<void> {
    for (const state of this.repository.getPageStates()) {
      const progress = this.#progress.get(state.market) ?? emptyProgress();
      progress.providerTotal = Math.max(
        progress.providerTotal,
        state.providerTotal,
      );
      progress.totalPages = Math.max(progress.totalPages, state.page);
      progress.lastSuccessAt = latestIso(
        progress.lastSuccessAt,
        state.lastSuccessAt,
      );
      this.#progress.set(state.market, progress);
    }

    const latest = await this.repository.latestCompletedSweep();
    if (latest) {
      this.#lastCompletedSweepAt = latest.completedAt;
      this.#lastCompletedSweepDurationMs = latest.durationMs;
      this.#lastSweepFailedPages = latest.failedPages;
    }
  }

  start(): void {
    if (this.#running || this.#stopped || !this.config.enabled) {
      return;
    }
    this.#running = true;
    this.#fullLoop = this.#runFullLoop();
    this.#scheduleHotRefresh(
      this.#refreshEffectiveSettings().hotRefreshIntervalMs,
    );
  }

  stop(): void {
    this.#stopped = true;
    this.#running = false;
    this.#abortController.abort();
    if (this.#hotTimer) {
      clearTimeout(this.#hotTimer);
      this.#hotTimer = undefined;
    }
  }

  async waitForStop(): Promise<void> {
    await this.#fullLoop?.catch(() => undefined);
    await this.#writeQueue.catch(() => undefined);
  }

  subscribe(listener: QuoteListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  touchInstrument(
    instrumentId: string,
    kind: "DETAIL" | "VISIBLE" = "DETAIL",
  ): void {
    const score =
      kind === "DETAIL" ? DETAIL_PRIORITY_SCORE : VISIBLE_PRIORITY_SCORE;
    const ttl = kind === "DETAIL" ? 2 * 60_000 : 30_000;
    const previous = this.#viewPriorities.get(instrumentId);
    this.#viewPriorities.set(instrumentId, {
      score: Math.max(score, previous?.score ?? 0),
      expiresAt: Date.now() + ttl,
    });
  }

  getStatus(): RealMarketStatus {
    const markets: RealMarketMarketStatus[] = REAL_MARKETS.map(
      (market) => {
        const progress = this.#progress.get(market) ?? emptyProgress();
        return {
          market,
          providerTotal: progress.providerTotal,
          storedInstruments: this.repository.countByMarket(market),
          totalPages: progress.totalPages,
          completedPages: progress.completedPages,
          failedPages: progress.failedPages,
          lastSuccessAt: progress.lastSuccessAt,
        };
      },
    );
    const state = !this.config.enabled
      ? "DISABLED"
      : this.#activeSweepId
        ? "SYNCING"
        : this.#lastError || this.#lastSweepFailedPages > 0
          ? "DEGRADED"
          : this.#lastCompletedSweepAt
            ? "LIVE"
            : "STARTING";

    return {
      mode: "REAL",
      provider: "EASTMONEY_WEBGUEST",
      state,
      enabled: this.config.enabled,
      database: "PGLITE_SEPARATE",
      instrumentCount: this.repository.instrumentCount,
      quotedInstrumentCount: this.repository.quotedInstrumentCount,
      activeSweepId: this.#activeSweepId,
      activeSweepStartedAt: this.#activeSweepStartedAt,
      lastCompletedSweepAt: this.#lastCompletedSweepAt,
      lastCompletedSweepDurationMs:
        this.#lastCompletedSweepDurationMs,
      fullSweepTargetMs: this.#effectiveSettings.fullSweepTargetMs,
      hotRefreshIntervalMs: this.#effectiveSettings.hotRefreshIntervalMs,
      pageSize: this.config.pageSize,
      concurrency: this.#effectiveSettings.concurrency,
      hotPageCount: this.#hotPageCount,
      lastError: this.#lastError,
      markets,
      gapFill: { ...this.#gapFill },
    };
  }

  async ensureHistory(
    instrumentId: string,
    range: ChartRange,
  ): Promise<HistoryResult> {
    const key = `${instrumentId}:${range}`;
    const existing = this.#historyRequests.get(key);
    if (existing) {
      return existing;
    }

    const request = this.#loadHistory(instrumentId, range).finally(() => {
      this.#historyRequests.delete(key);
    });
    this.#historyRequests.set(key, request);
    return request;
  }

  async fetchOrderBook(
    instrumentId: string,
  ): Promise<OrderBookResult> {
    const cached = this.#orderBookCache.get(instrumentId);
    if (cached && cached.expiresAt > Date.now()) {
      return {
        snapshot: cached.snapshot,
        error: null,
      };
    }
    const existing = this.#orderBookRequests.get(instrumentId);
    if (existing) {
      return existing;
    }
    const request = this.#loadOrderBook(instrumentId).finally(() => {
      this.#orderBookRequests.delete(instrumentId);
    });
    this.#orderBookRequests.set(instrumentId, request);
    return request;
  }

  async #loadHistory(
    instrumentId: string,
    range: ChartRange,
  ): Promise<HistoryResult> {
    const instrument = this.repository.getInstrumentById(instrumentId);
    if (!instrument) {
      return { fetched: false, error: "没有找到这只真实股票" };
    }
    this.touchInstrument(instrumentId, "DETAIL");

    try {
      const candles = await this.provider.fetchHistory(
        instrument,
        range,
        this.#abortController.signal,
      );
      if (!candles.length) throw new Error("主源未返回有效历史");
      // 替换相同历史窗口，避免主/备用源切换后保留同一周期的两套桶。
      await this.repository.replaceHistoryWindow(candles);
      return { fetched: candles.length > 0, error: null };
    } catch (error) {
      if (this.supplemental && !this.#stopped) {
        try {
          const candles = await this.supplemental.fetchHistory(instrument, range, this.#abortController.signal);
          if (!candles.length) throw new Error("备用历史为空");
          await this.repository.replaceHistoryWindow(candles);
          this.#gapFill.histories++; this.#gapFill.lastSuccessAt = this.clock().toISOString();
          return { fetched: true, error: null };
        } catch { /* 备用源仍失败时保留原有历史，不补造行情。 */ }
      }
      const message = errorMessage(error);
      this.#lastError = message;
      return { fetched: false, error: message };
    }
  }

  async #loadOrderBook(
    instrumentId: string,
  ): Promise<OrderBookResult> {
    const instrument = this.repository.getInstrumentById(instrumentId);
    const quote = this.repository.getQuote(instrumentId);
    if (!instrument || !quote) {
      return { snapshot: null, error: "没有找到这只真实股票" };
    }
    this.touchInstrument(instrumentId, "DETAIL");

    try {
      let orderBook;
      try { orderBook = await this.provider.fetchOrderBook(
        instrument,
        this.#abortController.signal,
      ); } catch (error) {
        if (!this.supplemental || this.#stopped) throw error;
        orderBook = await this.supplemental.fetchOrderBook(instrument, this.#abortController.signal);
        this.#gapFill.orderBooks++; this.#gapFill.lastSuccessAt = this.clock().toISOString();
      }
      const snapshot: OrderBookSnapshot = {
        instrumentId,
        quoteCurrency: quote.quoteCurrency,
        mode: "REAL",
        asks: orderBook.asks.map((level) => ({
          price: level.price,
          quantity: level.quantity,
          orderCount: 0,
        })),
        bids: orderBook.bids.map((level) => ({
          price: level.price,
          quantity: level.quantity,
          orderCount: 0,
        })),
        updatedAt: orderBook.updatedAt,
        available: true,
        notice: orderBook.dataProvider === "TENCENT" ? "东方财富盘口暂缺，当前为腾讯完整五档快照" : undefined,
      };
      this.#orderBookCache.set(instrumentId, {
        snapshot,
        expiresAt: Date.now() + 5_000,
      });
      return { snapshot, error: null };
    } catch (error) {
      const message = errorMessage(error);
      this.#lastError = message;
      return { snapshot: null, error: message };
    }
  }

  async #runFullLoop(): Promise<void> {
    while (!this.#stopped) {
      const settings = this.#refreshEffectiveSettings();
      const started = Date.now();
      await this.#runSweep().catch((error: unknown) => {
        this.#lastError = errorMessage(error);
      });
      const remaining = settings.fullSweepTargetMs - (Date.now() - started);
      if (!this.#stopped) {
        await abortableDelay(
          Math.max(MIN_FULL_SWEEP_COOLDOWN_MS, remaining),
          this.#abortController.signal,
        ).catch(() => undefined);
      }
    }
  }

  async #runSweep(): Promise<void> {
    const settings = this.#refreshEffectiveSettings();
    const sweepId = randomUUID();
    const startedAt = this.clock();
    this.#activeSweepId = sweepId;
    this.#activeSweepStartedAt = startedAt.toISOString();
    this.#lastError = null;
    const progress = new Map<StockMarket, MarketProgress>();
    for (const market of REAL_MARKETS) {
      progress.set(market, emptyProgress());
    }
    this.#progress.clear();
    for (const [market, value] of progress) {
      this.#progress.set(market, value);
    }
    await this.repository.startSweep(
      sweepId,
      startedAt.toISOString(),
    );

    await Promise.all(
      REAL_MARKETS.map(async (market) => {
        const result = await this.#fetchFullPage(
          { market, page: 1 },
          sweepId,
        );
        const marketProgress = progress.get(market) ?? emptyProgress();

        if (result.page) {
          marketProgress.providerTotal = result.page.providerTotal;
          marketProgress.totalPages = Math.max(
            1,
            Math.ceil(
              result.page.providerTotal / this.config.pageSize,
            ),
          );
          marketProgress.completedPages = 1;
          marketProgress.instrumentRows = result.page.items.length;
          marketProgress.lastSuccessAt = result.page.receivedAt;
        } else {
          const cached = this.repository
            .getPageStates()
            .find(
              (state) =>
                state.market === market &&
                state.page === 1 &&
                state.pageSize === this.config.pageSize,
            );
          marketProgress.providerTotal = cached?.providerTotal ?? 0;
          marketProgress.totalPages = cached
            ? Math.max(
                1,
                Math.ceil(
                  cached.providerTotal / this.config.pageSize,
                ),
              )
            : 1;
          marketProgress.failedPages = 1;
        }
        progress.set(market, marketProgress);
        return { market, result };
      }),
    );
    await yieldToEventLoop();

    const descriptors: ProviderPageDescriptor[] = [];
    for (const market of REAL_MARKETS) {
      const totalPages = progress.get(market)?.totalPages ?? 1;
      for (let page = 2; page <= totalPages; page += 1) {
        descriptors.push({ market, page });
      }
    }
    const hotScores = await this.#collectPriorities().catch(() => new Map());
    this.#latestPriorities = hotScores;
    descriptors.sort(
      (left, right) =>
        pageScore(right, hotScores, this.repository) -
        pageScore(left, hotScores, this.repository),
    );

    for (
      let offset = 0;
      offset < descriptors.length && !this.#stopped;
      offset += settings.concurrency
    ) {
      const batch = descriptors.slice(
        offset,
        offset + settings.concurrency,
      );
      const results = await Promise.all(
        batch.map(async (descriptor) => ({
          descriptor,
          result: await this.#fetchFullPage(descriptor, sweepId),
        })),
      );

      for (const { descriptor, result } of results) {
        const marketProgress =
          progress.get(descriptor.market) ?? emptyProgress();
        if (result.page) {
          marketProgress.completedPages += 1;
          marketProgress.instrumentRows += result.page.items.length;
          marketProgress.providerTotal = Math.max(
            marketProgress.providerTotal,
            result.page.providerTotal,
          );
          marketProgress.lastSuccessAt = latestIso(
            marketProgress.lastSuccessAt,
            result.page.receivedAt,
          );
        } else {
          marketProgress.failedPages += 1;
        }
        progress.set(descriptor.market, marketProgress);
      }

      await yieldToEventLoop();
    }

    const completedAt = this.clock();
    const durationMs = Math.max(
      0,
      completedAt.getTime() - startedAt.getTime(),
    );
    const totalPages = sumProgress(progress, "totalPages");
    const completedPages = sumProgress(progress, "completedPages");
    const failedPages = sumProgress(progress, "failedPages");
    const successfulMarkets = new Set(
      REAL_MARKETS.filter((market) => {
        const value = progress.get(market) ?? emptyProgress();
        return (
          value.failedPages === 0 &&
          value.completedPages === value.totalPages
        );
      }),
    );
    await this.repository.completeSweep(sweepId, {
      completedAt: completedAt.toISOString(),
      totalPages,
      completedPages,
      failedPages,
      instrumentRows: sumProgress(progress, "instrumentRows"),
      durationMs,
      successfulMarkets,
    });

    for (const [market, value] of progress) {
      this.#progress.set(market, value);
    }
    this.#lastCompletedSweepAt = completedAt.toISOString();
    this.#lastCompletedSweepDurationMs = durationMs;
    this.#lastSweepFailedPages = failedPages;
    this.#activeSweepId = null;
    this.#activeSweepStartedAt = null;
    this.#lastError =
      failedPages > 0
        ? `本轮有 ${failedPages}/${totalPages} 个全市场分片失败，已保留最后成功快照`
        : null;
  }

  async #fetchFullPage(
    descriptor: ProviderPageDescriptor,
    sweepId: string,
  ): Promise<{ page: ProviderPage | null; error: string | null }> {
    const requestedAt = this.clock().toISOString();
    let lastError = "未知错误";
    for (let attempt = 1; attempt <= 3 && !this.#stopped; attempt += 1) {
      try {
        let page = await this.#fetchRawPage(descriptor);
        const hotIds = this.#hotIdsForPage(descriptor);
        await this.#enqueuePageWrite(async () => {
          page = await this.#persistResolvedPage(
            page,
            sweepId,
            hotIds,
          );
          this.#emitPage(page);
        });
        await this.#repairQuoteGaps(descriptor, requestedAt, page);
        return { page, error: null };
      } catch (error) {
        lastError = errorMessage(error);
        if (attempt < 3) {
          await abortableDelay(
            attempt * 250,
            this.#abortController.signal,
          ).catch(() => undefined);
        }
      }
    }

    await this.repository.recordPageFailure(
      descriptor.market,
      descriptor.page,
      this.config.pageSize,
      lastError,
      this.clock().toISOString(),
    );
    await this.#repairQuoteGaps(descriptor, requestedAt);
    return { page: null, error: lastError };
  }

  async #refreshHotPages(): Promise<void> {
    if (
      this.#hotRoundRunning ||
      this.#stopped ||
      !this.config.enabled
    ) {
      return;
    }
    this.#hotRoundRunning = true;

    try {
      const settings = this.#refreshEffectiveSettings();
      const priorities = await this.#collectPriorities();
      this.#latestPriorities = priorities;
      const pages = new Map<
        string,
        {
          descriptor: ProviderPageDescriptor;
          score: number;
          instrumentIds: Set<string>;
        }
      >();
      for (const [instrumentId, score] of priorities) {
        const sourcePage = this.repository.getSourcePage(instrumentId);
        if (!sourcePage) {
          continue;
        }
        const key = descriptorKey(sourcePage);
        const entry = pages.get(key) ?? {
          descriptor: sourcePage,
          score: 0,
          instrumentIds: new Set<string>(),
        };
        entry.score += score;
        entry.instrumentIds.add(instrumentId);
        pages.set(key, entry);
      }
      const selected = [...pages.values()]
        .sort((left, right) => right.score - left.score)
        .slice(0, settings.hotPagesPerRound);
      this.#hotPageCount = selected.length;

      for (
        let offset = 0;
        offset < selected.length && !this.#stopped;
        offset += settings.concurrency
      ) {
        const batch = selected.slice(
          offset,
          offset + settings.concurrency,
        );
        await Promise.allSettled(
          batch.map(async ({ descriptor, instrumentIds }) => {
            const latestState = this.repository
              .getPageStates()
              .find(
                (state) =>
                  state.market === descriptor.market &&
                  state.page === descriptor.page &&
                  state.pageSize === this.config.pageSize,
              );
            if (
              latestState?.lastSuccessAt &&
              Date.now() -
                new Date(latestState.lastSuccessAt).getTime() <
                settings.hotRefreshIntervalMs * 0.75
            ) {
              return;
            }

            const requestedAt = this.clock().toISOString();
            try {
              let page = await this.#fetchRawPage(descriptor);
              await this.#enqueuePageWrite(async () => {
                page = await this.#persistResolvedPage(
                  page,
                  null,
                  instrumentIds,
                );
                this.#emitPage(page);
              });
              await this.#repairQuoteGaps(descriptor, requestedAt, page, instrumentIds);
            } catch (error) {
              await this.repository.recordPageFailure(
                descriptor.market,
                descriptor.page,
                this.config.pageSize,
                errorMessage(error),
                this.clock().toISOString(),
              );
              await this.#repairQuoteGaps(descriptor, requestedAt, undefined, instrumentIds);
            }
          }),
        );
        await yieldToEventLoop();
      }
    } finally {
      this.#hotRoundRunning = false;
    }
  }

  async #persistResolvedPage(page: ProviderPage, sweepId: string | null, hotIds: ReadonlySet<string>, supplemental = false): Promise<ProviderPage> {
    if (typeof this.repository.upsertProviderPageResolved === "function") {
      return this.repository.upsertProviderPageResolved(page, sweepId, hotIds, supplemental);
    }
    // Compatibility for legacy empty-page repository adapters: never emit an
    // unresolved nonempty page when identity resolution is unavailable.
    if (page.items.length) throw new Error("Repository cannot resolve provider identities");
    await this.repository.upsertProviderPage(page, sweepId, hotIds, supplemental);
    return page;
  }

  #enqueuePageWrite(work: () => Promise<void>): Promise<void> {
    const operation = this.#writeQueue.then(async () => {
      try {
        await work();
      } finally {
        await yieldToEventLoop();
      }
    });
    this.#writeQueue = operation.catch(() => undefined);
    return operation;
  }

  async #repairQuoteGaps(descriptor: ProviderPageDescriptor, requestedAt: string, primary?: ProviderPage, onlyIds?: ReadonlySet<string>) {
    if (!this.supplemental || this.#stopped) return;
    const requestedAtMs = new Date(requestedAt).getTime();
    const isQuoteStale = (quote: RealQuoteRecord | null | undefined): boolean => {
      if (!quote) return true;
      const sourceUpdatedAt = Date.parse(quote.updatedAt);
      if (!Number.isFinite(sourceUpdatedAt)) return true;
      // 收市期间的静止价格本身是有效的东财快照，不因时间流逝强行切备用源。
      if (!isMarketTradingTime(quote.market, new Date(requestedAtMs))) return false;
      return requestedAtMs - sourceUpdatedAt > quoteMaximumAgeMs(
          quote.market,
          new Date(requestedAtMs),
          this.config.quoteMaximumReceiveAgeMs,
          this.config.quoteMaximumReceiveAgeOffHoursMs,
        );
    };
    const candidates = primary ? primary.items.filter(item => isQuoteStale(item.quote)).map(item => item.instrument)
      : this.repository.listInstrumentsForPage(descriptor.market, descriptor.page);
    // 本次主源明确缺价或整页失败时，即使缓存尚未超时，也应尝试备用源。
    const missingFromPrimary = new Set(primary
      ? primary.items.filter(item => !item.quote).map(item => item.instrument.id)
      : candidates.map(item => item.id));
    if (primary && primary.items.length < Math.min(primary.pageSize, Math.max(0, primary.providerTotal - (primary.page - 1) * primary.pageSize))) {
      const present = new Set(primary.items.map(item => item.instrument.id));
      const omitted = this.repository.listInstrumentsForPage(descriptor.market, descriptor.page).filter(i => !present.has(i.id));
      for (const item of omitted) missingFromPrimary.add(item.id);
      candidates.push(...omitted);
    }
    const missing = [...new Map(candidates.filter(i => (!onlyIds || onlyIds.has(i.id)) &&
      (missingFromPrimary.has(i.id) || isQuoteStale(this.repository.getQuote(i.id))))
      .map(i => [i.id, i])).values()];
    if (!missing.length) return;
    const observed = new Map(missing.map(i => [i.id, this.repository.getQuote(i.id)]));
    try {
      const quotes = await this.supplemental.fetchQuotes(missing, this.#abortController.signal);
      if (this.#stopped) return;
      await this.#enqueuePageWrite(async () => {
        // 网络等待期间主源可能已恢复：提交前再次核对，成功数据绝不被补缺覆盖。
        const requested = new Map(missing.map(i => [i.id, i]));
        const items = quotes.flatMap(quote => {
          const instrument = requested.get(quote.instrumentId);
          const current = this.repository.getQuote(quote.instrumentId);
          const before = observed.get(quote.instrumentId);
          const sourceUpdatedAt = Date.parse(quote.updatedAt);
          if (!instrument || !Number.isFinite(sourceUpdatedAt)) return [];
          // 请求期间主源若已恢复且报价已变化，保持东财优先；不以较旧备用价倒退。
          if (current?.dataProvider === "EASTMONEY" &&
            (!before || current.updatedAt !== before.updatedAt || current.receivedAt !== before.receivedAt ||
              current.currentPrice !== before.currentPrice || before.dataProvider !== current.dataProvider)) return [];
          if (current && (Date.parse(current.updatedAt) > sourceUpdatedAt ||
            Date.parse(current.updatedAt) === sourceUpdatedAt && !missingFromPrimary.has(instrument.id))) return [];
          return [{ instrument, quote }];
        });
        if (!items.length) return;
        let page: ProviderPage = { ...descriptor, pageSize: this.config.pageSize, providerTotal: 0, durationMs: 0, receivedAt: this.clock().toISOString(), items };
        page = await this.#persistResolvedPage(page, null, onlyIds ?? this.#hotIdsForPage(descriptor), true);
        this.#gapFill.quotes += items.length; this.#gapFill.lastSuccessAt = page.receivedAt;
        this.#emitPage(page);
      });
    } catch { /* 分片失败状态由主流程保留，备用失败不清空最后成功行情。 */ }
  }

  #scheduleHotRefresh(delayMs: number): void {
    this.#hotTimer = setTimeout(() => {
      this.#hotTimer = undefined;
      if (this.#stopped || !this.#running) {
        return;
      }
      void this.#refreshHotPages()
        .catch((error: unknown) => {
          if (!this.#stopped && this.#running) {
            this.#lastError = errorMessage(error);
          }
        })
        .finally(() => {
          if (!this.#stopped && this.#running) {
            this.#scheduleHotRefresh(
              this.#refreshEffectiveSettings().hotRefreshIntervalMs,
            );
          }
        })
        .catch((error: unknown) => {
          if (!this.#stopped && this.#running) {
            this.#lastError = errorMessage(error);
            this.#scheduleHotRefresh(
              this.#effectiveSettings.hotRefreshIntervalMs,
            );
          }
        });
    }, delayMs);
    this.#hotTimer.unref?.();
  }

  #refreshEffectiveSettings() {
    const dynamic = this.runtimeSettingsSource?.() ?? {};
    this.#effectiveSettings = {
      concurrency: Math.max(
        1,
        Math.round(dynamic.concurrency ?? this.config.concurrency),
      ),
      hotRefreshIntervalMs: Math.max(
        500,
        Math.round(
          dynamic.hotRefreshIntervalMs ?? this.config.hotRefreshIntervalMs,
        ),
      ),
      hotPagesPerRound: Math.max(
        1,
        Math.round(
          dynamic.hotPagesPerRound ?? this.config.hotPagesPerRound,
        ),
      ),
      fullSweepTargetMs: Math.max(
        5_000,
        Math.round(
          dynamic.fullSweepTargetMs ?? this.config.fullSweepTargetMs,
        ),
      ),
    };
    return this.#effectiveSettings;
  }

  async #fetchRawPage(
    descriptor: ProviderPageDescriptor,
  ): Promise<ProviderPage> {
    const key = descriptorKey(descriptor);
    const existing = this.#inFlightFetches.get(key);
    if (existing) {
      return existing;
    }
    const request = this.provider
      .fetchPage(
        descriptor.market,
        descriptor.page,
        this.#abortController.signal,
      )
      .finally(() => this.#inFlightFetches.delete(key));
    this.#inFlightFetches.set(key, request);
    return request;
  }

  async #collectPriorities(): Promise<Map<string, number>> {
    const priorities = await this.prioritySource();
    const held = await this.repository.listHeldInstrumentIds();
    for (const instrumentId of held) {
      priorities.set(
        instrumentId,
        (priorities.get(instrumentId) ?? 0) + HELD_PRIORITY_SCORE,
      );
    }
    const now = Date.now();
    for (const [instrumentId, priority] of this.#viewPriorities) {
      if (priority.expiresAt <= now) {
        this.#viewPriorities.delete(instrumentId);
        continue;
      }
      priorities.set(
        instrumentId,
        (priorities.get(instrumentId) ?? 0) + priority.score,
      );
    }
    return priorities;
  }

  #hotIdsForPage(
    descriptor: ProviderPageDescriptor,
  ): Set<string> {
    return new Set(
      [...this.#latestPriorities.keys()].filter((instrumentId) => {
        const sourcePage = this.repository.getSourcePage(instrumentId);
        return (
          sourcePage?.market === descriptor.market &&
          sourcePage.page === descriptor.page
        );
      }),
    );
  }

  #emitPage(page: ProviderPage): void {
    const quotes: Quote[] = [];
    const emittedInstrumentIds = new Set<string>();
    for (const { quote } of page.items) {
      if (
        !quote ||
        emittedInstrumentIds.has(quote.instrumentId)
      ) {
        continue;
      }
      emittedInstrumentIds.add(quote.instrumentId);
      quotes.push({
        dataProvider: quote.dataProvider ?? "EASTMONEY",
        instrumentId: quote.instrumentId,
        symbol: quote.symbol,
        market: quote.market,
        quoteCurrency: quote.quoteCurrency,
        currentPrice: quote.currentPrice,
        previousClose: quote.previousClose,
        openPrice: quote.openPrice,
        highPrice: quote.highPrice,
        lowPrice: quote.lowPrice,
        volume: quote.volume,
        changeAmount: quote.changeAmount,
        changePercent: quote.changePercent,
        updatedAt: quote.updatedAt,
        receivedAt: quote.receivedAt,
      });
    }
    if (quotes.length === 0) {
      return;
    }
    for (const listener of this.#listeners) {
      listener(quotes);
    }
  }
}

export interface HistoryResult {
  fetched: boolean;
  error: string | null;
}

export interface OrderBookResult {
  snapshot: OrderBookSnapshot | null;
  error: string | null;
}

function emptyProgress(): MarketProgress {
  return {
    providerTotal: 0,
    totalPages: 0,
    completedPages: 0,
    failedPages: 0,
    instrumentRows: 0,
    lastSuccessAt: null,
  };
}

function descriptorKey(descriptor: ProviderPageDescriptor): string {
  return `${descriptor.market}:${descriptor.page}`;
}

function pageScore(
  descriptor: ProviderPageDescriptor,
  priorities: ReadonlyMap<string, number>,
  repository: RealMarketRepository,
): number {
  let total = 0;
  for (const [instrumentId, score] of priorities) {
    const sourcePage = repository.getSourcePage(instrumentId);
    if (
      sourcePage?.market === descriptor.market &&
      sourcePage.page === descriptor.page
    ) {
      total += score;
    }
  }
  return total;
}

function sumProgress(
  progress: ReadonlyMap<StockMarket, MarketProgress>,
  key:
    | "totalPages"
    | "completedPages"
    | "failedPages"
    | "instrumentRows",
): number {
  let total = 0;
  for (const value of progress.values()) {
    total += value[key];
  }
  return total;
}

function latestIso(
  left: string | null,
  right: string | null,
): string | null {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return left > right ? left : right;
}

function abortableDelay(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("ABORTED"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("ABORTED"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
