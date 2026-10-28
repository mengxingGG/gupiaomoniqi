import type {
  CandleInterval,
  Instrument,
  MarketItem,
  PaginatedData,
  Quote,
  StockMarket,
} from "@gupiaomoniqi/shared";
import { UNKNOWN_INDUSTRY } from "@gupiaomoniqi/shared";
import type { PGlite } from "@electric-sql/pglite";
import type {
  ProviderCandle,
  ProviderInstrumentSnapshot,
  ProviderPage,
  ProviderPageState,
  RealInstrumentRecord,
  RealQuoteRecord,
} from "./types.js";

interface InstrumentQuoteRow {
  id: string;
  provider_sec_id: string;
  symbol: string;
  name: string;
  market: StockMarket;
  source_currency: RealInstrumentRecord["sourceCurrency"];
  quote_currency: RealInstrumentRecord["quoteCurrency"];
  exchange_code: string;
  industry: string;
  lot_size: number;
  settlement_cycle: RealInstrumentRecord["settlementCycle"];
  is_tradable: boolean;
  is_active: boolean;
  source_page: number;
  source_rank: number;
  source_updated_at: Date | string | null;
  current_price: number | null;
  previous_close: number | null;
  open_price: number | null;
  high_price: number | null;
  low_price: number | null;
  volume: number | null;
  amount: number | null;
  change_amount: number | null;
  change_percent: number | null;
  raw_current_price: number | null;
  raw_previous_close: number | null;
  raw_open_price: number | null;
  raw_high_price: number | null;
  raw_low_price: number | null;
  quote_source_updated_at: Date | string | null;
  received_at: Date | string | null;
  data_provider: RealQuoteRecord["dataProvider"];
}

const PROVIDER_PAGE_WRITE_BATCH_SIZE = 25;
const CANDLE_WRITE_BATCH_SIZE = 100;

const MARKET_DAY_FORMATTERS: Record<
  StockMarket,
  Intl.DateTimeFormat
> = {
  CN: createMarketDayFormatter("Asia/Shanghai"),
  HK: createMarketDayFormatter("Asia/Hong_Kong"),
  US: createMarketDayFormatter("America/New_York"),
  UK: createMarketDayFormatter("Europe/London"),
};

export interface RealMarketListingFilter {
  market?: StockMarket;
  industry?: string;
  search?: string;
  page: number;
  pageSize: number;
  instrumentIds?: ReadonlySet<string>;
  sortBy: "DEFAULT" | "CHANGE_PERCENT";
  sortOrder: "DESC" | "ASC";
}

export interface SweepCompletion {
  completedAt: string;
  totalPages: number;
  completedPages: number;
  failedPages: number;
  instrumentRows: number;
  durationMs: number;
  successfulMarkets: ReadonlySet<StockMarket>;
}

export class RealMarketRepository {
  readonly #instruments = new Map<string, RealInstrumentRecord>();
  readonly #quotes = new Map<string, RealQuoteRecord>();
  readonly #pageStates = new Map<string, ProviderPageState>();
  readonly #providerIds = new Map<string, string>();
  #identityWriteQueue: Promise<void> = Promise.resolve();

  private constructor(readonly client: PGlite) {}

  static async create(client: PGlite): Promise<RealMarketRepository> {
    const repository = new RealMarketRepository(client);
    await repository.#load();
    return repository;
  }

  get instrumentCount(): number {
    return [...this.#instruments.values()].filter(
      (instrument) => instrument.isActive,
    ).length;
  }

  get quotedInstrumentCount(): number {
    let count = 0;
    for (const instrumentId of this.#quotes.keys()) {
      if (this.#instruments.get(instrumentId)?.isActive) {
        count += 1;
      }
    }
    return count;
  }

  countByMarket(market: StockMarket): number {
    let count = 0;
    for (const instrument of this.#instruments.values()) {
      if (instrument.isActive && instrument.market === market) {
        count += 1;
      }
    }
    return count;
  }

  listInstruments(): RealInstrumentRecord[] {
    return [...this.#instruments.values()]
      .filter((instrument) => instrument.isActive)
      .sort(compareInstruments)
      .map((instrument) => structuredClone(instrument));
  }

  getInstrumentById(
    instrumentId: string,
  ): RealInstrumentRecord | undefined {
    const instrument = this.#instruments.get(instrumentId);
    return instrument?.isActive
      ? structuredClone(instrument)
      : undefined;
  }

  listInstrumentsForPage(market: StockMarket, page: number): RealInstrumentRecord[] {
    return [...this.#instruments.values()].filter(i => i.isActive && i.market === market && i.sourcePage === page).map(i => structuredClone(i));
  }

  /** 账本展示读取留存标的；行情列表和新交易仍使用仅返回活跃标的的查询。 */
  getRecordedInstrumentById(instrumentId: string): RealInstrumentRecord | undefined {
    const instrument = this.#instruments.get(instrumentId);
    return instrument ? structuredClone(instrument) : undefined;
  }

  getQuote(instrumentId: string): RealQuoteRecord | undefined {
    const quote = this.#quotes.get(instrumentId);
    return quote ? structuredClone(quote) : undefined;
  }

  listQuotes(): Quote[] {
    return [...this.#quotes.values()]
      .filter((quote) => this.#instruments.get(quote.instrumentId)?.isActive)
      .map((quote) => toPublicQuote(quote));
  }

  getSourcePage(
    instrumentId: string,
  ): { market: StockMarket; page: number } | undefined {
    const instrument = this.#instruments.get(instrumentId);
    return instrument?.isActive
      ? { market: instrument.market, page: instrument.sourcePage }
      : undefined;
  }

  listMarket(
    filter: RealMarketListingFilter,
  ): PaginatedData<MarketItem> {
    const query = filter.search?.toLocaleLowerCase("zh-CN") ?? "";
    const filtered = [...this.#instruments.values()]
      .filter(
        (instrument) =>
          instrument.isActive &&
          this.#quotes.has(instrument.id) &&
          (!filter.market || instrument.market === filter.market) &&
          (!filter.industry ||
            normalizeIndustry(instrument.industry) === filter.industry) &&
          (!filter.instrumentIds ||
            filter.instrumentIds.has(instrument.id)) &&
          (!query ||
            instrument.symbol.toLowerCase().includes(query) ||
            instrument.name
              .toLocaleLowerCase("zh-CN")
              .includes(query) ||
            normalizeIndustry(instrument.industry)
              .toLocaleLowerCase("zh-CN")
              .includes(query)),
      )
      .sort((left, right) =>
        compareMarketItems(
          left,
          right,
          this.#quotes,
          filter.sortBy,
          filter.sortOrder,
        ),
      );
    const start = (filter.page - 1) * filter.pageSize;
    const items = filtered
      .slice(start, start + filter.pageSize)
      .map((instrument): MarketItem | null => {
        const quote = this.#quotes.get(instrument.id);
        return quote
          ? {
              instrument: toPublicInstrument(instrument),
              quote: toPublicQuote(quote),
            }
          : null;
      })
      .filter((item): item is MarketItem => item !== null);

    return {
      items,
      total: filtered.length,
      page: filter.page,
      pageSize: filter.pageSize,
    };
  }

  getMarketItem(instrumentId: string): MarketItem | undefined {
    const instrument = this.#instruments.get(instrumentId);
    const quote = this.#quotes.get(instrumentId);

    if (!instrument?.isActive || !quote) {
      return undefined;
    }

    return {
      instrument: toPublicInstrument(instrument),
      quote: toPublicQuote(quote),
    };
  }

  getPageStates(): ProviderPageState[] {
    return [...this.#pageStates.values()].map((state) =>
      structuredClone(state),
    );
  }

  async startSweep(id: string, startedAt: string): Promise<void> {
    await this.client.query(
      `INSERT INTO real_sync_sweeps
         (id, started_at, state)
       VALUES ($1, $2, 'RUNNING')
       ON CONFLICT (id) DO NOTHING`,
      [id, startedAt],
    );
  }

  async completeSweep(
    id: string,
    completion: SweepCompletion,
  ): Promise<void> {
    await this.client.transaction(async (transaction) => {
      await transaction.query(
        `UPDATE real_sync_sweeps
            SET completed_at = $2,
                total_pages = $3,
                completed_pages = $4,
                failed_pages = $5,
                instrument_rows = $6,
                duration_ms = $7,
                state = CASE WHEN $5 = 0
                             THEN 'COMPLETED'
                             ELSE 'DEGRADED' END
          WHERE id = $1`,
        [
          id,
          completion.completedAt,
          completion.totalPages,
          completion.completedPages,
          completion.failedPages,
          completion.instrumentRows,
          completion.durationMs,
        ],
      );

      for (const market of completion.successfulMarkets) {
        await transaction.query(
          `UPDATE real_instruments
              SET is_active = false,
                  updated_at = $3
            WHERE market = $1
              AND is_active = true
              AND last_seen_sweep_id IS DISTINCT FROM $2`,
          [market, id, completion.completedAt],
        );
      }
    });

    if (completion.successfulMarkets.size > 0) {
      const activeResult = await this.client.query<{ id: string }>(
        `SELECT id FROM real_instruments WHERE is_active = true`,
      );
      const activeIds = new Set(
        activeResult.rows.map((row) => row.id),
      );
      for (const instrument of this.#instruments.values()) {
        instrument.isActive = activeIds.has(instrument.id);
      }
    }
  }

  async recordPageFailure(
    market: StockMarket,
    page: number,
    pageSize: number,
    error: string,
    attemptedAt: string,
  ): Promise<void> {
    await this.client.query(
      `INSERT INTO real_provider_pages
         (market, page, page_size, last_attempt_at,
          consecutive_failures, last_error)
       VALUES ($1, $2, $3, $4, 1, $5)
       ON CONFLICT (market, page, page_size)
       DO UPDATE SET
         last_attempt_at = excluded.last_attempt_at,
         consecutive_failures =
           real_provider_pages.consecutive_failures + 1,
         last_error = excluded.last_error`,
      [market, page, pageSize, attemptedAt, error.slice(0, 2_000)],
    );
    const key = pageKey(market, page, pageSize);
    const previous = this.#pageStates.get(key);
    this.#pageStates.set(key, {
      market,
      page,
      pageSize,
      providerTotal: previous?.providerTotal ?? 0,
      rowCount: previous?.rowCount ?? 0,
      lastSweepId: previous?.lastSweepId ?? null,
      lastAttemptAt: attemptedAt,
      lastSuccessAt: previous?.lastSuccessAt ?? null,
      lastDurationMs: previous?.lastDurationMs ?? null,
      consecutiveFailures: (previous?.consecutiveFailures ?? 0) + 1,
      lastError: error,
    });
  }

  async upsertProviderPage(
    providerPage: ProviderPage,
    sweepId: string | null,
    hotInstrumentIds: ReadonlySet<string> = new Set(),
    supplemental = false,
  ): Promise<void> {
    await this.upsertProviderPageResolved(providerPage, sweepId, hotInstrumentIds, supplemental);
  }

  /** Resolve identities and persist as one serialized operation; callers must emit this page. */
  async upsertProviderPageResolved(
    providerPage: ProviderPage,
    sweepId: string | null,
    hotInstrumentIds: ReadonlySet<string> = new Set(),
    supplemental = false,
  ): Promise<ProviderPage> {
    const operation = this.#identityWriteQueue.then(() =>
      this.#writeProviderPage(providerPage, sweepId, hotInstrumentIds, supplemental),
    );
    this.#identityWriteQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async #writeProviderPage(
    providerPage: ProviderPage,
    sweepId: string | null,
    hotInstrumentIds: ReadonlySet<string>,
    supplemental: boolean,
  ): Promise<ProviderPage> {
    const resolved = this.#resolvePageIdentities(providerPage.items, supplemental);
    const items = uniqueProviderPageItems(resolved).map((item) => {
      const retained = this.#quotes.get(item.instrument.id);
      // 当前东财 isTradable 由本页报价完整性推导；本页缺价时不应丢弃已有有效报价的交易能力。
      const hasRetainedQuote = retained !== undefined &&
        Number.isFinite(retained.currentPrice) && retained.currentPrice > 0;
      const incoming = item.quote;
      if (incoming && (incoming.symbol !== item.instrument.symbol || incoming.market !== item.instrument.market ||
          incoming.quoteCurrency !== item.instrument.quoteCurrency)) {
        throw new Error(`Quote metadata identity mismatch: ${item.instrument.providerSecId}`);
      }
      if (incoming && !validQuoteSnapshot(incoming)) throw new Error("Invalid real quote snapshot");
      // Rejected/older quotes must not be emitted or turned into candle snapshots.
      const accepted = incoming && (!retained ||
        !retained.updatedAt && (incoming.updatedAt !== "" || incoming.receivedAt >= retained.receivedAt) ||
        incoming.updatedAt !== "" && incoming.updatedAt >= retained.updatedAt) ? incoming : null;
      return {
        instrument: !item.instrument.isTradable && hasRetainedQuote
          ? { ...item.instrument, isTradable: true }
          : item.instrument,
        quote: accepted && !accepted.dataProvider && !supplemental
          ? { ...accepted, dataProvider: "EASTMONEY" as const }
          : accepted,
      };
    });
    for (const item of items) {
      const existing = this.#instruments.get(item.instrument.id);
      if (
        existing &&
        existing.providerSecId !== item.instrument.providerSecId
      ) {
        throw instrumentIdentityCollision(
          item.instrument.id,
          existing.providerSecId,
          item.instrument.providerSecId,
        );
      }
    }
    const instruments = items.map(({ instrument }) => ({
      id: instrument.id,
      provider_sec_id: instrument.providerSecId,
      symbol: instrument.symbol,
      name: instrument.name,
      market: instrument.market,
      source_currency: instrument.sourceCurrency,
      quote_currency: instrument.quoteCurrency,
      exchange_code: instrument.exchangeCode,
      industry: instrument.industry,
      lot_size: instrument.lotSize,
      settlement_cycle: instrument.settlementCycle,
      is_tradable: instrument.isTradable,
      source_page: instrument.sourcePage,
      source_rank: instrument.sourceRank,
      last_seen_sweep_id: sweepId,
      source_updated_at: instrument.sourceUpdatedAt || null,
      updated_at: providerPage.receivedAt,
    }));
    const quotes = items
      .map(({ quote }) => quote)
      .filter((quote): quote is RealQuoteRecord => quote !== null)
      .map((quote) => ({
        data_provider: quote.dataProvider ?? "EASTMONEY",
        instrument_id: quote.instrumentId,
        current_price: quote.currentPrice,
        previous_close: quote.previousClose,
        open_price: quote.openPrice,
        high_price: quote.highPrice,
        low_price: quote.lowPrice,
        volume: quote.volume,
        amount: quote.amount,
        change_amount: quote.changeAmount,
        change_percent: quote.changePercent,
        raw_current_price: quote.rawCurrentPrice,
        raw_previous_close: quote.rawPreviousClose,
        raw_open_price: quote.rawOpenPrice,
        raw_high_price: quote.rawHighPrice,
        raw_low_price: quote.rawLowPrice,
        source_updated_at: quote.updatedAt || null,
        received_at: quote.receivedAt,
      }));
    const dailyCandles = items
      .map(({ instrument, quote }) =>
        quote ? dailySnapshot(instrument, quote) : null,
      )
      .filter((candle): candle is ProviderCandle => candle !== null);
    const minuteCandles = items
      .map(({ quote }) =>
        quote && hotInstrumentIds.has(quote.instrumentId)
          ? hotMinuteSnapshot(
              quote,
              this.#quotes.get(quote.instrumentId),
            )
          : null,
      )
      .filter((candle): candle is ProviderCandle => candle !== null);

    await this.client.transaction(async (transaction) => {
      for (const batch of chunked(
        supplemental ? [] : instruments,
        PROVIDER_PAGE_WRITE_BATCH_SIZE,
      )) {
        const written = await transaction.query(
          `INSERT INTO real_instruments (
             id, provider_sec_id, symbol, name, market,
             source_currency, quote_currency, exchange_code, industry,
             lot_size, settlement_cycle, is_tradable, is_active,
             source_page, source_rank, last_seen_sweep_id,
             source_updated_at, updated_at
           )
           SELECT x.id, x.provider_sec_id, x.symbol, x.name, x.market,
                  x.source_currency, x.quote_currency, x.exchange_code,
                  x.industry, x.lot_size, x.settlement_cycle,
                  x.is_tradable, true, x.source_page, x.source_rank,
                  x.last_seen_sweep_id, x.source_updated_at, x.updated_at
             FROM jsonb_to_recordset($1::jsonb) AS x(
               id text, provider_sec_id text, symbol text, name text,
               market text, source_currency text, quote_currency text,
               exchange_code text, industry text, lot_size integer,
               settlement_cycle text, is_tradable boolean,
               source_page integer, source_rank integer,
               last_seen_sweep_id text, source_updated_at timestamptz,
               updated_at timestamptz
             )
           ON CONFLICT (id) DO UPDATE SET
             symbol = excluded.symbol,
             name = excluded.name,
             market = excluded.market,
             source_currency = excluded.source_currency,
             quote_currency = excluded.quote_currency,
             exchange_code = excluded.exchange_code,
             industry = excluded.industry,
             lot_size = excluded.lot_size,
             settlement_cycle = excluded.settlement_cycle,
             is_tradable = excluded.is_tradable,
             is_active = true,
             source_page = excluded.source_page,
             source_rank = excluded.source_rank,
             last_seen_sweep_id = COALESCE(
               excluded.last_seen_sweep_id,
               real_instruments.last_seen_sweep_id
             ),
             source_updated_at = excluded.source_updated_at,
             updated_at = excluded.updated_at
           WHERE real_instruments.provider_sec_id = excluded.provider_sec_id
           RETURNING id`,
          [JSON.stringify(batch)],
        );
        if (written.rows.length !== batch.length) {
          throw new Error("Real market instrument identity changed concurrently");
        }
        await yieldToEventLoop();
      }

      for (const batch of chunked(
        quotes,
        PROVIDER_PAGE_WRITE_BATCH_SIZE,
      )) {
        await transaction.query(
          `INSERT INTO real_quotes (
             instrument_id, current_price, previous_close, open_price,
             high_price, low_price, volume, amount, change_amount,
             change_percent, raw_current_price, raw_previous_close,
             raw_open_price, raw_high_price, raw_low_price,
             source_updated_at, received_at, data_provider
           )
           SELECT x.instrument_id, x.current_price, x.previous_close,
                  x.open_price, x.high_price, x.low_price, x.volume,
                  x.amount, x.change_amount, x.change_percent,
                  x.raw_current_price, x.raw_previous_close,
                  x.raw_open_price, x.raw_high_price, x.raw_low_price,
                  x.source_updated_at, x.received_at, x.data_provider
             FROM jsonb_to_recordset($1::jsonb) AS x(
               instrument_id text, current_price float8,
               previous_close float8, open_price float8,
               high_price float8, low_price float8, volume float8,
               amount float8, change_amount float8,
               change_percent float8, raw_current_price float8,
               raw_previous_close float8, raw_open_price float8,
               raw_high_price float8, raw_low_price float8,
               source_updated_at timestamptz, received_at timestamptz, data_provider text
             )
           ON CONFLICT (instrument_id) DO UPDATE SET
             current_price = excluded.current_price,
             previous_close = excluded.previous_close,
             open_price = excluded.open_price,
             high_price = excluded.high_price,
             low_price = excluded.low_price,
             volume = excluded.volume,
             amount = excluded.amount,
             change_amount = excluded.change_amount,
             change_percent = excluded.change_percent,
             raw_current_price = excluded.raw_current_price,
             raw_previous_close = excluded.raw_previous_close,
             raw_open_price = excluded.raw_open_price,
             raw_high_price = excluded.raw_high_price,
             raw_low_price = excluded.raw_low_price,
             source_updated_at = excluded.source_updated_at,
             received_at = excluded.received_at,
             data_provider = excluded.data_provider
           WHERE (real_quotes.source_updated_at IS NULL AND
                  (excluded.source_updated_at IS NOT NULL OR excluded.received_at >= real_quotes.received_at))
              OR excluded.source_updated_at >= real_quotes.source_updated_at`,
          [JSON.stringify(batch)],
        );
        await yieldToEventLoop();
      }

      await upsertCandleRows(
        transaction,
        dailyCandles,
        false,
        PROVIDER_PAGE_WRITE_BATCH_SIZE,
      );
      if (supplemental && quotes.length) await transaction.query(
        "UPDATE real_instruments SET is_tradable = true WHERE id = ANY($1::text[])", [quotes.map(q => q.instrument_id)],
      );
      await upsertCandleRows(
        transaction,
        minuteCandles,
        true,
        PROVIDER_PAGE_WRITE_BATCH_SIZE,
      );

      if (!supplemental) await transaction.query(
        `INSERT INTO real_provider_pages (
           market, page, page_size, provider_total, row_count,
           last_sweep_id, last_attempt_at, last_success_at,
           last_duration_ms, consecutive_failures, last_error
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, 0, NULL)
         ON CONFLICT (market, page, page_size)
         DO UPDATE SET
           provider_total = excluded.provider_total,
           row_count = excluded.row_count,
           last_sweep_id = COALESCE(
             excluded.last_sweep_id,
             real_provider_pages.last_sweep_id
           ),
           last_attempt_at = excluded.last_attempt_at,
           last_success_at = excluded.last_success_at,
           last_duration_ms = excluded.last_duration_ms,
           consecutive_failures = 0,
           last_error = NULL`,
        [
          providerPage.market,
          providerPage.page,
          providerPage.pageSize,
          providerPage.providerTotal,
          items.length,
          sweepId,
          providerPage.receivedAt,
          providerPage.durationMs,
        ],
      );
    });

    for (const { instrument, quote } of items) {
      if (!supplemental) {
        this.#instruments.set(instrument.id, structuredClone(instrument));
        this.#providerIds.set(instrument.providerSecId, instrument.id);
      }
      if (supplemental && quote) {
        const stored = this.#instruments.get(instrument.id);
        if (stored) this.#instruments.set(instrument.id, { ...stored, isTradable: true });
      }

      if (quote) {
        const current = this.#quotes.get(quote.instrumentId);
        if (
          !current || !current.updatedAt && (quote.updatedAt !== "" || quote.receivedAt >= current.receivedAt) ||
          quote.updatedAt !== "" && quote.updatedAt >= current.updatedAt
        ) {
          this.#quotes.set(
            quote.instrumentId,
            structuredClone(quote),
          );
        }
      }
    }

    // 补报价不改变东方财富的页码、清单完整性或分片成功状态。
    if (supplemental) return { ...providerPage, items };
    const state: ProviderPageState = {
      market: providerPage.market,
      page: providerPage.page,
      pageSize: providerPage.pageSize,
      providerTotal: providerPage.providerTotal,
      rowCount: items.length,
      lastSweepId: sweepId,
      lastAttemptAt: providerPage.receivedAt,
      lastSuccessAt: providerPage.receivedAt,
      lastDurationMs: providerPage.durationMs,
      consecutiveFailures: 0,
      lastError: null,
    };
    this.#pageStates.set(
      pageKey(
        providerPage.market,
        providerPage.page,
        providerPage.pageSize,
      ),
      state,
    );
    return { ...providerPage, items };
  }

  #resolvePageIdentities(items: ProviderInstrumentSnapshot[], supplemental: boolean): ProviderInstrumentSnapshot[] {
    // Reserve every persisted identity, including inactive rows. Staged identities are
    // local to this write and only become visible in memory after commit.
    const occupied = new Map<string, string>();
    const assigned = new Map<string, string>();
    const ownerOf = (id: string) => occupied.get(id) ?? this.#instruments.get(id)?.providerSecId;
    const byProvider = new Map<string, ProviderInstrumentSnapshot>();
    for (const item of items) {
      const previous = byProvider.get(item.instrument.providerSecId);
      if (!previous || item.instrument.sourceRank < previous.instrument.sourceRank) {
        byProvider.set(item.instrument.providerSecId, item);
      }
    }
    // Stable ordering avoids dependence on the provider's row order within a page.
    const ordered = [...byProvider.values()].sort((a, b) =>
      a.instrument.providerSecId < b.instrument.providerSecId ? -1 :
      a.instrument.providerSecId > b.instrument.providerSecId ? 1 : 0);
    const result: ProviderInstrumentSnapshot[] = [];
    for (const item of ordered) {
      const instrument = item.instrument;
      const provider = instrument.providerSecId;
      let id = this.#providerIds.get(provider) ?? assigned.get(provider);
      if (id) {
        const stored = this.#instruments.get(id)!;
        if (stored.market !== instrument.market) throw new Error(`Provider identity market mismatch: ${provider}`);
      } else {
        if (supplemental) throw new Error(`Unknown supplemental provider identity: ${provider}`);
        id = instrument.id;
        const owner = ownerOf(id);
        if (owner && owner !== provider) {
          // A page may only claim a colliding legacy ID when it actually is the
          // provider's normal Eastmoney ID, not an inconsistent forged snapshot.
          const normal = `real-${instrument.market.toLowerCase()}-${provider.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
          if (id !== normal) throw instrumentIdentityCollision(id, owner, provider);
          const suffix = Buffer.from(provider, "utf16le").toString("hex");
          const base = `${id}--secid-${suffix}`;
          id = base;
          let attempt = 0;
          while (ownerOf(id)) id = `${base}-${++attempt}`;
        }
        assigned.set(provider, id);
        occupied.set(id, provider);
      }
      if (supplemental && instrument.id !== id) throw instrumentIdentityCollision(instrument.id, provider, provider);
      if (item.quote && item.quote.instrumentId !== instrument.id) {
        throw new Error(`Quote identity mismatch: ${provider}`);
      }
      result.push({ instrument: { ...instrument, id }, quote: item.quote ? { ...item.quote, instrumentId: id } : null });
    }
    return result;
  }

  async upsertCandles(candles: ProviderCandle[]): Promise<void> {
    if (candles.length === 0) {
      return;
    }
    await this.client.transaction(async (transaction) => {
      await upsertCandleRows(
        transaction,
        candles,
        false,
        CANDLE_WRITE_BATCH_SIZE,
      );
    });
  }

  /** 单一股票、周期的区间原子替换，整组 OHLC 来自同一源。 */
  async replaceHistoryWindow(candles: ProviderCandle[]): Promise<void> {
    if (!candles.length) return;
    const first = candles[0]!;
    if (candles.some(c => c.instrumentId !== first.instrumentId || c.interval !== first.interval || c.source !== first.source)) throw new Error("历史区间不能混用标的或来源");
    const sorted = [...candles].sort((a, b) => a.time.localeCompare(b.time));
    if (sorted.some(c => !Number.isFinite(Date.parse(c.time)) || !Number.isFinite(Date.parse(c.updatedAt)) ||
        ![c.open, c.close, c.high, c.low].every(p => Number.isFinite(p) && p > 0) ||
        c.high < Math.max(c.open, c.close) || c.low > Math.min(c.open, c.close) ||
        !Number.isFinite(c.volume) || c.volume < 0)) throw new Error("历史区间包含无效价格、时间或成交量");
    const period = first.interval === "MONTH" || first.interval === "YEAR";
    const key = (c: ProviderCandle) => period ? c.time.slice(0, first.interval === "YEAR" ? 4 : 7) : c.time;
    const unique = [...new Map(sorted.map(c => [key(c), c])).values()];
    await this.client.transaction(async transaction => {
      // A qfq basis can change even without a provider switch. Keep only this
      // complete response, not a tail imported under a different adjustment basis.
      await transaction.query("DELETE FROM real_candles WHERE instrument_id = $1 AND interval = $2 AND source IN ('REAL_PROVIDER_HISTORY', 'REAL_TENCENT_HISTORY')",
        [first.instrumentId, first.interval]);
      await upsertCandleRows(transaction, unique, false, CANDLE_WRITE_BATCH_SIZE);
    });
  }

  async listCandles(
    instrumentId: string,
    interval: CandleInterval,
    limit: number,
  ): Promise<ProviderCandle[]> {
    const result = await this.client.query<{
      instrument_id: string;
      interval: "MINUTE" | "DAY" | "MONTH" | "YEAR";
      bucket_start: Date | string;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
      average_price: number | null;
      source: ProviderCandle["source"];
      data_provider: ProviderCandle["dataProvider"] | null;
      is_partial: boolean;
      updated_at: Date | string;
    }>(
      `SELECT instrument_id, interval, bucket_start,
              open::float8, high::float8, low::float8, close::float8,
              volume::float8, average_price::float8, source, data_provider, is_partial,
              updated_at
         FROM (
           SELECT *
             FROM real_candles
            WHERE instrument_id = $1
              AND interval = $2
              -- Legacy snapshots have neither verifiable provider provenance nor
              -- a guarantee that their bucket used an actual source timestamp.
              AND (source <> 'REAL_PROVIDER_SNAPSHOT' OR data_provider IS NOT NULL)
              AND source = COALESCE(
                (SELECT source FROM real_candles
                  WHERE instrument_id = $1 AND interval = $2
                    AND source IN ('REAL_PROVIDER_HISTORY', 'REAL_TENCENT_HISTORY')
                  ORDER BY updated_at DESC, bucket_start DESC, source LIMIT 1), source)
            ORDER BY bucket_start DESC
            LIMIT $3
         ) selected
        ORDER BY bucket_start`,
      [instrumentId, interval, limit],
    );
    return result.rows.map((row) => ({
      instrumentId: row.instrument_id,
      interval: row.interval,
      time: toIso(row.bucket_start),
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
      averagePrice: row.average_price ?? undefined,
      source: row.source,
      dataProvider: row.data_provider ?? undefined,
      isPartial: row.is_partial,
      updatedAt: toIso(row.updated_at),
    }));
  }

  async listHeldInstrumentIds(): Promise<Set<string>> {
    const result = await this.client.query<{ instrument_id: string }>(
      `SELECT DISTINCT instrument_id
         FROM real_positions
        WHERE quantity > 0`,
    );
    return new Set(result.rows.map((row) => row.instrument_id));
  }

  async latestCompletedSweep(): Promise<{
    id: string;
    completedAt: string;
    durationMs: number | null;
    failedPages: number;
  } | null> {
    const result = await this.client.query<{
      id: string;
      completed_at: Date | string;
      duration_ms: number | null;
      failed_pages: number;
    }>(
      `SELECT id, completed_at, duration_ms, failed_pages
         FROM real_sync_sweeps
        WHERE completed_at IS NOT NULL
        ORDER BY completed_at DESC
        LIMIT 1`,
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          completedAt: toIso(row.completed_at),
          durationMs: row.duration_ms,
          failedPages: row.failed_pages,
        }
      : null;
  }

  async #load(): Promise<void> {
    const result = await this.client.query<InstrumentQuoteRow>(
      `SELECT i.id, i.provider_sec_id, i.symbol, i.name, i.market,
              i.source_currency, i.quote_currency, i.exchange_code,
              i.industry, i.lot_size, i.settlement_cycle,
              i.is_tradable, i.is_active, i.source_page, i.source_rank,
              i.source_updated_at,
              q.current_price::float8, q.previous_close::float8,
              q.open_price::float8, q.high_price::float8,
              q.low_price::float8, q.volume::float8, q.amount::float8,
              q.change_amount::float8, q.change_percent::float8,
              q.raw_current_price::float8,
              q.raw_previous_close::float8, q.raw_open_price::float8,
              q.raw_high_price::float8, q.raw_low_price::float8,
              q.source_updated_at AS quote_source_updated_at, q.data_provider,
              q.received_at
         FROM real_instruments i
         LEFT JOIN real_quotes q ON q.instrument_id = i.id`,
    );

    for (const row of result.rows) {
      const instrument: RealInstrumentRecord = {
        id: row.id,
        providerSecId: row.provider_sec_id,
        symbol: row.symbol,
        name: row.name,
        market: row.market,
        sourceCurrency: row.source_currency,
        quoteCurrency: row.quote_currency,
        type: "STOCK_REAL",
        industry: row.industry,
        isTradable: row.is_tradable,
        lotSize: row.lot_size,
        settlementCycle: row.settlement_cycle,
        exchangeCode: row.exchange_code,
        sourcePage: row.source_page,
        sourceRank: row.source_rank,
        sourceUpdatedAt: row.source_updated_at ? toIso(row.source_updated_at) : "",
        isActive: row.is_active,
      };
      this.#instruments.set(instrument.id, instrument);
      this.#providerIds.set(instrument.providerSecId, instrument.id);

      if (
        row.current_price !== null &&
        Number.isFinite(row.current_price) && row.current_price > 0 &&
        row.received_at
      ) {
        const quote: RealQuoteRecord = {
          instrumentId: row.id,
          symbol: row.symbol,
          market: row.market,
          quoteCurrency: row.quote_currency,
          currentPrice: row.current_price,
          previousClose: row.previous_close!,
          openPrice: row.open_price!,
          highPrice: row.high_price!,
          lowPrice: row.low_price!,
          volume: row.volume!,
          amount: row.amount!,
          changeAmount: row.change_amount!,
          changePercent: row.change_percent!,
          rawCurrentPrice: row.raw_current_price!,
          rawPreviousClose: row.raw_previous_close!,
          rawOpenPrice: row.raw_open_price!,
          rawHighPrice: row.raw_high_price!,
          rawLowPrice: row.raw_low_price!,
          updatedAt: row.quote_source_updated_at ? toIso(row.quote_source_updated_at) : "",
          receivedAt: toIso(row.received_at),
          dataProvider: row.data_provider,
        };
        // Restore trading capability only for a complete, valid retained snapshot;
        // missing database fields are never synthesized from current price.
        if (validQuoteSnapshot(quote)) {
          instrument.isTradable = true;
          this.#quotes.set(row.id, quote);
        }
      }
    }

    const pageResult = await this.client.query<{
      market: StockMarket;
      page: number;
      page_size: number;
      provider_total: number;
      row_count: number;
      last_sweep_id: string | null;
      last_attempt_at: Date | string | null;
      last_success_at: Date | string | null;
      last_duration_ms: number | null;
      consecutive_failures: number;
      last_error: string | null;
    }>(`SELECT * FROM real_provider_pages`);

    for (const row of pageResult.rows) {
      this.#pageStates.set(
        pageKey(row.market, row.page, row.page_size),
        {
          market: row.market,
          page: row.page,
          pageSize: row.page_size,
          providerTotal: row.provider_total,
          rowCount: row.row_count,
          lastSweepId: row.last_sweep_id,
          lastAttemptAt: row.last_attempt_at
            ? toIso(row.last_attempt_at)
            : null,
          lastSuccessAt: row.last_success_at
            ? toIso(row.last_success_at)
            : null,
          lastDurationMs: row.last_duration_ms,
          consecutiveFailures: row.consecutive_failures,
          lastError: row.last_error,
        },
      );
    }
  }
}

function toPublicInstrument(
  instrument: RealInstrumentRecord,
): Instrument {
  return {
    id: instrument.id,
    symbol: instrument.symbol,
    name: instrument.name,
    market: instrument.market,
    sourceCurrency: instrument.sourceCurrency,
    quoteCurrency: instrument.quoteCurrency,
    type: "STOCK_REAL",
    industry: normalizeIndustry(instrument.industry),
    isTradable: instrument.isTradable,
    lotSize: instrument.lotSize,
    settlementCycle: instrument.settlementCycle,
  };
}

function toPublicQuote(quote: RealQuoteRecord): Quote {
  const {
    rawCurrentPrice: _rawCurrentPrice,
    rawPreviousClose: _rawPreviousClose,
    rawOpenPrice: _rawOpenPrice,
    rawHighPrice: _rawHighPrice,
    rawLowPrice: _rawLowPrice,
    amount: _amount,
    ...publicQuote
  } = quote;
  return structuredClone(publicQuote);
}

function compareInstruments(
  left: RealInstrumentRecord,
  right: RealInstrumentRecord,
): number {
  const marketOrder: Record<StockMarket, number> = {
    CN: 0,
    HK: 1,
    US: 2,
    UK: 3,
  };
  return (
    marketOrder[left.market] - marketOrder[right.market] ||
    left.sourceRank - right.sourceRank ||
    left.symbol.localeCompare(right.symbol)
  );
}

function compareMarketItems(
  left: RealInstrumentRecord,
  right: RealInstrumentRecord,
  quotes: ReadonlyMap<string, RealQuoteRecord>,
  sortBy: "DEFAULT" | "CHANGE_PERCENT",
  sortOrder: "DESC" | "ASC",
): number {
  if (sortBy === "CHANGE_PERCENT") {
    const byChange = compareByNumber(
      quotes.get(left.id)?.changePercent ?? 0,
      quotes.get(right.id)?.changePercent ?? 0,
      sortOrder,
    );
    if (byChange !== 0) {
      return byChange;
    }
  }
  return compareInstruments(left, right);
}

function compareByNumber(
  left: number,
  right: number,
  order: "DESC" | "ASC",
): number {
  return order === "ASC" ? left - right : right - left;
}

function dailySnapshot(
  instrument: RealInstrumentRecord,
  quote: RealQuoteRecord,
): ProviderCandle | null {
  if (!quote.updatedAt || !Number.isFinite(Date.parse(quote.updatedAt))) return null;
  return {
    instrumentId: instrument.id,
    interval: "DAY",
    time: marketDayBucket(quote.updatedAt, instrument.market),
    open: quote.openPrice,
    high: quote.highPrice,
    low: quote.lowPrice,
    close: quote.currentPrice,
    volume: quote.volume,
    source: "REAL_PROVIDER_SNAPSHOT",
    dataProvider: quote.dataProvider ?? "EASTMONEY",
    isPartial: true,
    updatedAt: quote.receivedAt,
  };
}

function hotMinuteSnapshot(
  quote: RealQuoteRecord,
  previous: RealQuoteRecord | undefined,
): ProviderCandle | null {
  if (!quote.updatedAt || !Number.isFinite(Date.parse(quote.updatedAt))) return null;
  const bucket = new Date(
    Math.floor(new Date(quote.updatedAt).getTime() / 60_000) * 60_000,
  ).toISOString();
  const open =
    previous && previous.dataProvider === quote.dataProvider && previous.updatedAt &&
    Math.floor(new Date(previous.updatedAt).getTime() / 60_000) ===
      Math.floor(new Date(quote.updatedAt).getTime() / 60_000)
      ? previous.currentPrice
      : quote.currentPrice;
  return {
    instrumentId: quote.instrumentId,
    interval: "MINUTE",
    time: bucket,
    open,
    high: Math.max(open, quote.currentPrice),
    low: Math.min(open, quote.currentPrice),
    close: quote.currentPrice,
    volume: previous && previous.dataProvider === quote.dataProvider && previous.updatedAt &&
      marketDayBucket(previous.updatedAt, quote.market) === marketDayBucket(quote.updatedAt, quote.market)
      ? Math.max(0, quote.volume - previous.volume) : 0,
    source: "REAL_PROVIDER_SNAPSHOT",
    dataProvider: quote.dataProvider ?? "EASTMONEY",
    isPartial: true,
    updatedAt: quote.receivedAt,
  };
}

function validQuoteSnapshot(quote: RealQuoteRecord): boolean {
  return [quote.currentPrice, quote.previousClose, quote.openPrice, quote.highPrice, quote.lowPrice,
    quote.rawCurrentPrice, quote.rawPreviousClose, quote.rawOpenPrice, quote.rawHighPrice, quote.rawLowPrice]
    .every(p => Number.isFinite(p) && p > 0) &&
    quote.highPrice >= Math.max(quote.openPrice, quote.currentPrice) &&
    quote.lowPrice <= Math.min(quote.openPrice, quote.currentPrice) &&
    [quote.changeAmount, quote.changePercent].every(Number.isFinite) &&
    [quote.volume, quote.amount].every(v => Number.isFinite(v) && v >= 0) &&
    (quote.updatedAt === "" || Number.isFinite(Date.parse(quote.updatedAt))) &&
    Number.isFinite(Date.parse(quote.receivedAt));
}

function marketDayBucket(
  timestamp: string,
  market: StockMarket,
): string {
  const parts = Object.fromEntries(
    MARKET_DAY_FORMATTERS[market]
      .formatToParts(new Date(timestamp))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T00:00:00.000Z`;
}

function normalizeIndustry(industry: string): string {
  const normalized = industry.trim();
  return ["", "-", "--", "N/A", "NA", "NONE", "NULL", "UNKNOWN", "未知"].includes(
    normalized.toLocaleUpperCase("en-US"),
  )
    ? UNKNOWN_INDUSTRY
    : normalized;
}

function createMarketDayFormatter(
  timeZone: string,
): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

async function upsertCandleRows(
  transaction: {
    query<T>(
      query: string,
      parameters?: unknown[],
    ): Promise<{ rows: T[] }>;
  },
  candles: ProviderCandle[],
  mergeVolume: boolean,
  batchSize: number,
): Promise<void> {
  for (const batch of chunked(candles, batchSize)) {
    const rows = batch.map((candle) => ({
      instrument_id: candle.instrumentId,
      interval: candle.interval,
      bucket_start: candle.time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      average_price: candle.averagePrice ?? null,
      source: candle.source,
      data_provider: candle.dataProvider ?? (candle.source === "REAL_TENCENT_HISTORY" ? "TENCENT" : candle.source === "REAL_PROVIDER_HISTORY" ? "EASTMONEY" : null),
      is_partial: candle.isPartial,
      updated_at: candle.updatedAt,
    }));
    await transaction.query(
      `INSERT INTO real_candles (
         instrument_id, interval, bucket_start, open, high, low, close,
         volume, average_price, source, data_provider, is_partial, updated_at
       )
       SELECT x.instrument_id, x.interval, x.bucket_start, x.open,
              x.high, x.low, x.close, x.volume, x.average_price,
              x.source, x.data_provider, x.is_partial, x.updated_at
         FROM jsonb_to_recordset($1::jsonb) AS x(
           instrument_id text, interval text, bucket_start timestamptz,
           open float8, high float8, low float8, close float8,
           volume float8, average_price float8, source text,
           data_provider text, is_partial boolean, updated_at timestamptz
         )
       ON CONFLICT (instrument_id, interval, bucket_start)
       DO UPDATE SET
         open = ${mergeVolume ? "CASE WHEN real_candles.source = excluded.source AND real_candles.data_provider IS NOT DISTINCT FROM excluded.data_provider THEN real_candles.open ELSE excluded.open END" : "excluded.open"},
         high = ${mergeVolume ? "CASE WHEN real_candles.source = excluded.source AND real_candles.data_provider IS NOT DISTINCT FROM excluded.data_provider THEN GREATEST(real_candles.high, excluded.high) ELSE excluded.high END" : "excluded.high"},
         low = ${mergeVolume ? "CASE WHEN real_candles.source = excluded.source AND real_candles.data_provider IS NOT DISTINCT FROM excluded.data_provider THEN LEAST(real_candles.low, excluded.low) ELSE excluded.low END" : "excluded.low"},
         close = excluded.close,
         volume = ${mergeVolume
          ? "CASE WHEN real_candles.source = excluded.source AND real_candles.data_provider IS NOT DISTINCT FROM excluded.data_provider THEN real_candles.volume + excluded.volume ELSE excluded.volume END"
          : "excluded.volume"},
         average_price = excluded.average_price,
         source = excluded.source,
         data_provider = excluded.data_provider,
         is_partial = excluded.is_partial,
         updated_at = excluded.updated_at
       WHERE excluded.source IN ('REAL_PROVIDER_HISTORY', 'REAL_TENCENT_HISTORY')
          OR real_candles.source NOT IN ('REAL_PROVIDER_HISTORY', 'REAL_TENCENT_HISTORY')`,
      [JSON.stringify(rows)],
    );
    await yieldToEventLoop();
  }
}

function pageKey(
  market: StockMarket,
  page: number,
  pageSize: number,
): string {
  return `${market}:${page}:${pageSize}`;
}

function toIso(value: Date | string): string {
  return new Date(value).toISOString();
}

function chunked<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function uniqueProviderPageItems(
  items: ProviderInstrumentSnapshot[],
): ProviderInstrumentSnapshot[] {
  const unique = new Map<string, ProviderInstrumentSnapshot>();
  for (const item of items) {
    const current = unique.get(item.instrument.id);
    if (
      current &&
      current.instrument.providerSecId !==
        item.instrument.providerSecId
    ) {
      throw instrumentIdentityCollision(
        item.instrument.id,
        current.instrument.providerSecId,
        item.instrument.providerSecId,
      );
    }
    if (
      !current ||
      item.instrument.sourceRank < current.instrument.sourceRank
    ) {
      unique.set(item.instrument.id, item);
    }
  }
  return [...unique.values()];
}

function instrumentIdentityCollision(
  instrumentId: string,
  currentProviderSecId: string,
  incomingProviderSecId: string,
): Error {
  return new Error(
    `Real market instrument identity collision: ${instrumentId} ` +
      `maps to both ${currentProviderSecId} and ${incomingProviderSecId}`,
  );
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
