import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { REAL_MARKET_CONFIG } from "../src/config.js";
import { migrateRealDatabase } from "../src/real-market/db/migrations.js";
import { EastmoneyProvider } from "../src/real-market/EastmoneyProvider.js";
import { RealMarketRepository } from "../src/real-market/RealMarketRepository.js";
import { RealMarketRuntime } from "../src/real-market/RealMarketRuntime.js";
import type { ProviderPage } from "../src/real-market/types.js";

const clients: PGlite[] = [];
const now = "2026-10-28T14:00:00.000Z";
const normalId = "real-us-106-dcom";
afterEach(async () => { for (const client of clients.splice(0)) await client.close(); });

async function setup() {
  const client = new PGlite(); clients.push(client); await client.waitReady;
  await migrateRealDatabase(client);
  return { client, repository: await RealMarketRepository.create(client) };
}
function row(symbol: string, price = 10) {
  return { f12: symbol, f13: 106, f14: symbol, f2: price, f18: 9, f17: 10, f15: Math.max(price, 10), f16: 9, f3: 1, f4: 1, f5: 100, f6: 1000, f124: Date.parse(now) / 1000 };
}
async function page(symbols: string[], pageNumber = 1): Promise<ProviderPage> {
  const provider = new EastmoneyProvider({ pageSize: 10, requestTimeoutMs: 2000,
    clock: () => new Date(now), fetchImplementation: vi.fn(async () => Response.json({ rc: 0, data: { total: symbols.length, diff: symbols.map((s, i) => row(s, 10 + i)) } })) as unknown as typeof fetch });
  return provider.fetchPage("US", pageNumber);
}
async function ids(client: PGlite) {
  return (await client.query<{id: string; provider_sec_id: string; is_active: boolean}>("SELECT id, provider_sec_id, is_active FROM real_instruments ORDER BY provider_sec_id")).rows;
}

describe("Eastmoney identity allocation", () => {
  it("retains inactive legacy identity and all ledger references, across restart and pages", async () => {
    const { client, repository } = await setup();
    await repository.upsertProviderPage(await page(["DCOM_"]), null);
    await client.exec(`UPDATE real_instruments SET is_active=false WHERE id='${normalId}';
      INSERT INTO real_portfolios (id, account_id, initial_cash_usd, available_cash_usd) VALUES ('11111111-1111-4111-8111-111111111111', 'a', 1000, 1000);
      INSERT INTO real_positions (id, portfolio_id, instrument_id, quantity, available_quantity, frozen_quantity, average_cost_usd) VALUES ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','${normalId}',2,2,0,10);
      INSERT INTO real_orders (id, portfolio_id, instrument_id, side, order_mode, status, quantity, quote_currency, actor_id) VALUES ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','${normalId}','BUY','MARKET','OPEN',1,'USD','a');
      INSERT INTO real_transactions (id,portfolio_id,instrument_id,symbol,name,market,side,quantity,quote_price,quote_currency,fx_rate_to_usd,price_usd,gross_amount_usd,fee_usd,net_amount_usd,created_at) VALUES ('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','${normalId}','DCOM_','DCOM_','US','BUY',1,10,'USD',1,10,10,0,10,now());
      CREATE TABLE watchlist_items (instrument_id text NOT NULL); INSERT INTO watchlist_items VALUES ('${normalId}');`);
    const reloaded = await RealMarketRepository.create(client);
    const resolved = await reloaded.upsertProviderPageResolved(await page(["DCOM"], 2), null);
    const newId = resolved.items[0]!.instrument.id;
    expect(newId).not.toBe(normalId);
    expect(resolved.items[0]!.quote?.instrumentId).toBe(newId);
    expect(await ids(client)).toEqual([{id: newId, provider_sec_id: "106.DCOM", is_active: true}, {id: normalId, provider_sec_id: "106.DCOM_", is_active: false}]);
    for (const table of ["real_positions", "real_orders", "real_transactions", "watchlist_items"]) {
      const result = await client.query<{instrument_id: string}>(`SELECT instrument_id FROM ${table}`);
      expect(result.rows).toEqual([{ instrument_id: normalId }]);
    }
    const restarted = await RealMarketRepository.create(client);
    const reverse = await restarted.upsertProviderPageResolved(await page(["DCOM", "DCOM_"]), null, new Set([newId, normalId]));
    expect(Object.fromEntries(reverse.items.map(i => [i.instrument.providerSecId, i.instrument.id]))).toEqual({ "106.DCOM": newId, "106.DCOM_": normalId });
    expect((await client.query<{instrument_id: string}>("SELECT DISTINCT instrument_id FROM real_candles ORDER BY instrument_id")).rows.map(x => x.instrument_id).sort()).toEqual([newId, normalId].sort());
  });

  it("resolves page-local collisions deterministically and preserves identifiers on concurrent pages", async () => {
    const a = await setup(); const b = await setup();
    const raw = await page(["DCOM_", "DCOM"]);
    expect(raw.items.map(i => i.instrument.id)).toEqual([normalId, normalId]);
    const resolved = await a.repository.upsertProviderPageResolved(raw, null);
    const reversed = await b.repository.upsertProviderPageResolved(await page(["DCOM", "DCOM_"]), null);
    const mapping = (p: ProviderPage) => Object.fromEntries(p.items.map(i => [i.instrument.providerSecId, i.instrument.id]));
    expect(mapping(resolved)).toEqual(mapping(reversed));
    expect(new Set(resolved.items.map(i => i.instrument.id)).size).toBe(2);
    for (const i of resolved.items) expect(i.quote?.instrumentId).toBe(i.instrument.id);
    await Promise.all([a.repository.upsertProviderPage(await page(["DCOM_"] , 2), null), a.repository.upsertProviderPage(await page(["DCOM"], 3), null)]);
    expect((await ids(a.client)).map(i => i.id).sort()).toEqual(Object.values(mapping(resolved)).sort());
    const stored = await a.client.query<{id: string; instrument_id: string}>("SELECT i.id, q.instrument_id FROM real_instruments i JOIN real_quotes q ON q.instrument_id=i.id ORDER BY i.id");
    expect(stored.rows).toHaveLength(2);
    expect(stored.rows.every(x => x.id === x.instrument_id)).toBe(true);
  });

  it("reuses a pre-existing noncanonical ID for the same provider identity", async () => {
    const {client, repository} = await setup();
    const input = await page(["DCOM_"]);
    const item = input.items[0]!;
    item.instrument.id = "historical-custom-id";
    item.quote!.instrumentId = item.instrument.id;
    await repository.upsertProviderPage(input, null);
    const restarted = await RealMarketRepository.create(client);
    const resolved = await restarted.upsertProviderPageResolved(await page(["DCOM_"]), null);
    expect(resolved.items[0]!.instrument.id).toBe("historical-custom-id");
    expect(resolved.items[0]!.quote?.instrumentId).toBe("historical-custom-id");
    expect(await ids(client)).toEqual([{id: "historical-custom-id", provider_sec_id: "106.DCOM_", is_active: true}]);
  });

  it("never reuses an existing quote for the other colliding identity", async () => {
    const {repository} = await setup();
    await repository.upsertProviderPage(await page(["DCOM"]), null);
    const incoming = await page(["DCOM_"], 2);
    incoming.items[0]!.quote = null;
    incoming.items[0]!.instrument.isTradable = false;
    const resolved = await repository.upsertProviderPageResolved(incoming, null);
    const id = resolved.items[0]!.instrument.id;
    expect(id).not.toBe(normalId);
    expect(repository.getInstrumentById(id)?.isTradable).toBe(false);
    expect(repository.getQuote(id)).toBeUndefined();
    expect(repository.getQuote(normalId)?.currentPrice).toBe(10);
  });

  it("rejects a stale second repository without ever redirecting the stored ID", async () => {
    const {client, repository} = await setup();
    const stale = await RealMarketRepository.create(client);
    await repository.upsertProviderPage(await page(["DCOM_"]), null);
    await expect(stale.upsertProviderPage(await page(["DCOM"]), null)).rejects.toThrow();
    expect(await ids(client)).toEqual([{id: normalId, provider_sec_id: "106.DCOM_", is_active: true}]);
    expect(stale.instrumentCount).toBe(0);
    const reloaded = await RealMarketRepository.create(client);
    await reloaded.upsertProviderPage(await page(["DCOM"]), null);
    expect(await ids(client)).toHaveLength(2);
  });

  it("does not publish tentative mappings after a failed transaction and avoids occupied fallback IDs", async () => {
    const {client, repository} = await setup();
    const bad = await page(["DCOM_", "DCOM"]);
    bad.items[1]!.instrument.lotSize = 0;
    await expect(repository.upsertProviderPage(bad, null)).rejects.toThrow();
    expect(await ids(client)).toEqual([]);
    expect(repository.instrumentCount).toBe(0);
    await repository.upsertProviderPage(await page(["DCOM_"]), null);
    const base = `${normalId}--secid-${Buffer.from("106.DCOM", "utf16le").toString("hex")}`;
    await client.query(`INSERT INTO real_instruments (id,provider_sec_id,symbol,name,market,source_currency,quote_currency,exchange_code,lot_size,settlement_cycle,source_page,source_rank,source_updated_at) VALUES ($1,'legacy.other','OTHER','OTHER','US','USD','USD','106',1,'T0',1,0,$2)`, [base, now]);
    const reloaded = await RealMarketRepository.create(client);
    const result = await reloaded.upsertProviderPageResolved(await page(["DCOM"]), null);
    expect(result.items[0]!.instrument.id).toBe(`${base}-1`);
    expect((await ids(client)).find(i => i.id === base)?.provider_sec_id).toBe("legacy.other");
  });

  it.each(["primary", "supplemental"] as const)("emits the resolved %s identity rather than the colliding raw ID", async (mode) => {
    const {repository} = await setup();
    await repository.upsertProviderPage(await page(["DCOM_"]), null);
    const incoming = await page(["DCOM"]);
    if (mode === "supplemental") { incoming.items[0]!.quote = null; incoming.items[0]!.instrument.isTradable = false; }
    const fetchQuotes = vi.fn(async (items: typeof incoming.items[number]["instrument"][]) => items.map(instrument => ({
      instrumentId: instrument.id, symbol: instrument.symbol, market: instrument.market, quoteCurrency: instrument.quoteCurrency,
      currentPrice: 12, previousClose: 10, openPrice: 11, highPrice: 12, lowPrice: 10, volume: 100, amount: 1000,
      changeAmount: 2, changePercent: 20, updatedAt: now, receivedAt: now, rawCurrentPrice: 12, rawPreviousClose: 10,
      rawOpenPrice: 11, rawHighPrice: 12, rawLowPrice: 10, dataProvider: "TENCENT" as const,
    })));
    const fake = { fetchPage: async (market: ProviderPage["market"], pageNumber: number) => market === "US" ? incoming : { ...incoming, market, page: pageNumber, providerTotal: 0, items: [] } } as unknown as EastmoneyProvider;
    const runtime = new RealMarketRuntime(repository, fake, { ...REAL_MARKET_CONFIG, enabled: true, pageSize: 10, concurrency: 2, fullSweepTargetMs: 10000, hotRefreshIntervalMs: 60000, hotPagesPerRound: 1 }, async () => new Map(), () => new Date(now), undefined, { fetchQuotes, fetchHistory: async () => [], fetchOrderBook: async () => ({ asks: [], bids: [], updatedAt: now }) });
    const emitted: string[] = []; runtime.subscribe(quotes => emitted.push(...quotes.map(q => q.instrumentId)));
    await runtime.initialize(); runtime.start();
    try {
      const deadline = Date.now() + 10000;
      while (!runtime.getStatus().lastCompletedSweepAt && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
      expect(runtime.getStatus().lastCompletedSweepAt).not.toBeNull();
      const resolved = repository.listInstruments().find(i => i.providerSecId === "106.DCOM")!;
      expect(resolved.id).not.toBe(normalId);
      if (mode === "supplemental") {
        expect(fetchQuotes).toHaveBeenCalledWith([expect.objectContaining({ id: resolved.id, providerSecId: "106.DCOM" })], expect.any(AbortSignal));
      } else expect(fetchQuotes).not.toHaveBeenCalled();
      expect(repository.getQuote(resolved.id)?.dataProvider).toBe(mode === "supplemental" ? "TENCENT" : "EASTMONEY");
      expect(emitted).toContain(resolved.id);
      expect(emitted).not.toContain(normalId);
    } finally { runtime.stop(); await runtime.waitForStop(); }
  });
});
