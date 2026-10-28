import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { REAL_MARKET_CONFIG } from "../src/config.js";
import { EastmoneyProvider } from "../src/real-market/EastmoneyProvider.js";
import { RealMarketRepository } from "../src/real-market/RealMarketRepository.js";
import { RealMarketRuntime } from "../src/real-market/RealMarketRuntime.js";
import { RealTradingService } from "../src/real-market/RealTradingService.js";
import { migrateRealDatabase } from "../src/real-market/db/migrations.js";
import type { ProviderCandle, ProviderPage } from "../src/real-market/types.js";

const clients: PGlite[] = [];
const now = new Date("2026-10-28T14:00:00.000Z");
afterEach(async () => { for (const client of clients.splice(0)) await client.close(); });
async function setup() {
  const client = new PGlite(); clients.push(client); await client.waitReady;
  await migrateRealDatabase(client);
  return { client, repository: await RealMarketRepository.create(client) };
}
async function page(timestamp: unknown = undefined): Promise<ProviderPage> {
  const provider = new EastmoneyProvider({ pageSize: 100, requestTimeoutMs: 1000,
    clock: () => now, fetchImplementation: vi.fn(async () => Response.json({ rc: 0, data: { total: 1, diff: [
      { f12: "AAPL", f13: 105, f14: "Apple", f2: 100, f18: 98, f17: 99, f15: 101, f16: 97, f5: 1000, f6: 100000, f124: timestamp },
    ] } })) as unknown as typeof fetch });
  return provider.fetchPage("US", 1);
}
function candle(instrumentId: string, source: ProviderCandle["source"], time = "2026-10-28T00:00:00.000Z"): ProviderCandle {
  return { instrumentId, interval: "DAY", source, time, open: 90, close: 91, high: 92, low: 89,
    volume: 100, isPartial: false, updatedAt: now.toISOString() };
}

describe("source-time and provenance invariants", () => {
  it.each([undefined, null, "-", 0, Infinity, 99999999999999])("keeps valid Eastmoney prices but source time unknown for f124=%s", async value => {
    const input = await page(value);
    expect(input.items[0]?.instrument.sourceUpdatedAt).toBe("");
    expect(input.items[0]?.quote).toMatchObject({ currentPrice: 100, updatedAt: "", receivedAt: now.toISOString(), dataProvider: "EASTMONEY" });
    const {client, repository} = await setup();
    await repository.upsertProviderPage(input, null, new Set([input.items[0]!.instrument.id]));
    const id = input.items[0]!.instrument.id;
    expect(await repository.listCandles(id, "DAY", 10)).toEqual([]);
    expect(await repository.listCandles(id, "MINUTE", 10)).toEqual([]);
    expect((await client.query<{source_updated_at: null}>("SELECT source_updated_at FROM real_quotes")).rows[0]?.source_updated_at).toBeNull();
    expect((await RealMarketRepository.create(client)).getQuote(id)?.updatedAt).toBe("");
  });

  it("repairs a freshly received primary quote with unknown source time, and emits the complete fallback", async () => {
    const {repository} = await setup();
    const primary = await page();
    const base = primary.items[0]!.quote!;
    const fallback = { ...base, currentPrice: 101, rawCurrentPrice: 101, updatedAt: now.toISOString(), dataProvider: "TENCENT" as const };
    const fetchQuotes = vi.fn(async () => [fallback]);
    const provider = { fetchPage: async (market: ProviderPage["market"], pageNumber: number) => market === "US" ? primary : { ...primary, market, page: pageNumber, providerTotal: 0, items: [] } } as unknown as EastmoneyProvider;
    const runtime = new RealMarketRuntime(repository, provider, { ...REAL_MARKET_CONFIG, enabled: true, concurrency: 4,
      fullSweepTargetMs: 10000, hotRefreshIntervalMs: 60000 }, async () => new Map(), () => now, undefined,
      { fetchQuotes, fetchHistory: async () => [], fetchOrderBook: async () => ({ asks: [], bids: [], updatedAt: now.toISOString() }) });
    const emissions: Array<{dataProvider?: string; updatedAt: string}> = [];
    runtime.subscribe(quotes => emissions.push(...quotes));
    await runtime.initialize(); runtime.start();
    try {
      const deadline = Date.now() + 10000;
      while (!runtime.getStatus().lastCompletedSweepAt && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
      expect(runtime.getStatus().lastCompletedSweepAt).not.toBeNull();
      expect(fetchQuotes).toHaveBeenCalled();
      expect(repository.getQuote(base.instrumentId)).toMatchObject({ dataProvider: "TENCENT", updatedAt: now.toISOString(), currentPrice: 101 });
      expect(emissions).toContainEqual(expect.objectContaining({ dataProvider: "TENCENT", updatedAt: now.toISOString() }));
    } finally { runtime.stop(); await runtime.waitForStop(); }
  });

  it("does not emit, write candles, or mix fields from an older or undated primary quote", async () => {
    const {repository} = await setup();
    const good = await page(Date.parse("2026-10-28T13:59:00.000Z") / 1000);
    const id = good.items[0]!.instrument.id;
    await repository.upsertProviderPage(good, null, new Set([id]));
    for (const time of [undefined, Date.parse("2026-10-28T13:58:00.000Z") / 1000]) {
      const incoming = await page(time);
      incoming.items[0]!.quote!.currentPrice = 99;
      incoming.items[0]!.quote!.rawCurrentPrice = 99;
      const persisted = await repository.upsertProviderPageResolved(incoming, null, new Set([id]));
      expect(persisted.items[0]?.quote).toBeNull();
      expect(repository.getQuote(id)).toMatchObject({ currentPrice: 100, updatedAt: "2026-10-28T13:59:00.000Z" });
    }
    expect((await repository.listCandles(id, "MINUTE", 10)).map(c => c.close)).toEqual([100]);
  });

  it("marks ambiguous legacy receive-time substitutes unknown without changing ledger identity or price", async () => {
    const {client, repository} = await setup();
    const input = await page(now.getTime() / 1000);
    const id = input.items[0]!.instrument.id;
    await repository.upsertProviderPage(input, null);
    await client.query("DELETE FROM schema_migrations WHERE version = 6");
    await migrateRealDatabase(client); await migrateRealDatabase(client);
    const restarted = await RealMarketRepository.create(client);
    expect(restarted.getQuote(id)).toMatchObject({ currentPrice: 100, updatedAt: "", receivedAt: now.toISOString() });
    expect(restarted.getRecordedInstrumentById(id)?.providerSecId).toBe("105.AAPL");
  });

  it("keeps qfq history isolated from live snapshots, including later polling and source switches", async () => {
    const {repository} = await setup();
    const input = await page(now.getTime() / 1000);
    const id = input.items[0]!.instrument.id;
    await repository.upsertProviderPage(input, null);
    await repository.replaceHistoryWindow([candle(id, "REAL_TENCENT_HISTORY")]);
    await repository.upsertProviderPage(input, null);
    expect((await repository.listCandles(id, "DAY", 10)).map(c => [c.close, c.source])).toEqual([[91, "REAL_TENCENT_HISTORY"]]);
    await repository.replaceHistoryWindow([candle(id, "REAL_PROVIDER_HISTORY", "2026-10-27T00:00:00.000Z")]);
    expect((await repository.listCandles(id, "DAY", 10)).map(c => c.source)).toEqual(["REAL_PROVIDER_HISTORY"]);
    await repository.upsertProviderPage(input, null);
    expect((await repository.listCandles(id, "DAY", 10)).map(c => c.time)).toEqual(["2026-10-27T00:00:00.000Z"]);
  });

  it("does not merge minute OHLC or volume from different quote providers", async () => {
    const {repository} = await setup();
    const input = await page(now.getTime() / 1000);
    const id = input.items[0]!.instrument.id;
    await repository.upsertProviderPage(input, null, new Set([id]));
    const fallback = structuredClone(input);
    Object.assign(fallback.items[0]!.quote!, { dataProvider: "TENCENT", currentPrice: 99, rawCurrentPrice: 99, volume: 1200 });
    await repository.upsertProviderPage(fallback, null, new Set([id]), true);
    expect((await repository.listCandles(id, "MINUTE", 10))[0]).toMatchObject({ open: 99, high: 99, low: 99, close: 99, volume: 0, source: "REAL_PROVIDER_SNAPSHOT", dataProvider: "TENCENT" });
  });

  it("retains legacy unverified snapshot rows for audit but does not present their times as verified chart history", async () => {
    const {client, repository} = await setup();
    const input = await page();
    const id = input.items[0]!.instrument.id;
    await repository.upsertProviderPage(input, null);
    await repository.upsertCandles([candle(id, "REAL_PROVIDER_SNAPSHOT")]);
    expect(await repository.listCandles(id, "DAY", 10)).toEqual([]);
    expect((await client.query<{count: number}>("SELECT COUNT(*)::int AS count FROM real_candles WHERE instrument_id = $1", [id])).rows[0]?.count).toBe(1);
  });

  it("rejects invalid quote prices before persistence", async () => {
    const {repository} = await setup();
    for (const currentPrice of [NaN, Infinity, -1, 0]) {
      const input = await page(); input.items[0]!.quote!.currentPrice = currentPrice;
      await expect(repository.upsertProviderPage(input, null)).rejects.toThrow("Invalid real quote snapshot");
    }
    expect(repository.instrumentCount).toBe(0);
  });
});

describe("missing-quote holdings", () => {
  it.each([NaN, Infinity, 0, -1])("rejects nonpositive/nonfinite execution quotes (%s) for immediate trades and matching", async price => {
    const {repository} = await setup();
    const input = await page(now.getTime() / 1000);
    await repository.upsertProviderPage(input, null);
    const id = input.items[0]!.instrument.id;
    const service = new RealTradingService(repository, 120000, 1800000, () => now);
    const limit = await service.placeOrder("account", "USD", { instrumentId: id, side: "BUY", quantity: 1, orderMode: "LIMIT", limitPrice: 90 });
    expect(limit.order.status).toBe("OPEN");
    const before = await service.getSnapshot("account", "USD");
    const original = repository.getQuote(id)!;
    const spy = vi.spyOn(repository, "getQuote").mockReturnValue({ ...original, currentPrice: price });
    try {
      await expect(service.placeOrder("account", "USD", { instrumentId: id, side: "BUY", quantity: 1 })).rejects.toMatchObject({code: "REAL_INSTRUMENT_NOT_TRADABLE"});
      await expect(service.execute("account", "USD", { instrumentId: id, side: "SELL", quantity: 1 })).rejects.toMatchObject({code: "REAL_INSTRUMENT_NOT_TRADABLE"});
      expect(await service.matchOpenOrders([id])).toBe(0);
    } finally { spy.mockRestore(); }
    expect((await service.getSnapshot("account", "USD")).availableCashUsd).toBe(before.availableCashUsd);
    expect((await service.listOrders("account"))[0]?.status).toBe("OPEN");
    expect(await service.listTransactions("account")).toEqual([]);
  });

  it("retains holding quantity and signals incomplete valuation rather than silently losing the position", async () => {
    const {client, repository} = await setup();
    const input = await page();
    input.items[0]!.quote = null; input.items[0]!.instrument.isTradable = false;
    await repository.upsertProviderPage(input, null);
    const id = input.items[0]!.instrument.id;
    const service = new RealTradingService(repository, 120000, 1800000, () => now);
    await service.getSnapshot("account", "USD");
    await client.query(`INSERT INTO real_positions (id, portfolio_id, instrument_id, quantity, available_quantity, frozen_quantity, average_cost_usd)
      SELECT '22222222-2222-4222-8222-222222222222', id, $1, 10, 7, 3, 90 FROM real_portfolios WHERE account_id='account'`, [id]);
    const result = await service.getSnapshot("account", "USD");
    expect(result).toMatchObject({ valuationComplete: false, unvaluedPositionCount: 1 });
    expect(result.positions).toHaveLength(1);
    expect(result.positions[0]).toMatchObject({ instrumentId: id, quantity: 10, availableQuantity: 7, frozenQuantity: 3, averageCostUsd: 90, valuationStatus: "UNAVAILABLE" });
    const quote = (await page(now.getTime() / 1000));
    await repository.upsertProviderPage(quote, null);
    const restored = await service.getSnapshot("account", "USD");
    expect(restored).toMatchObject({ valuationComplete: true, unvaluedPositionCount: 0, positionsValueUsd: 1000 });
  });
});
