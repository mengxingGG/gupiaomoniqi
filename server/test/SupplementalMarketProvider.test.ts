import { describe, expect, it, vi } from "vitest";
import { SupplementalMarketProvider, sinaCode } from "../src/real-market/SupplementalMarketProvider.js";
import type { RealInstrumentRecord } from "../src/real-market/types.js";

const now = new Date("2026-10-27T11:14:00.000Z");

function instrument(market: "HK" | "US"): RealInstrumentRecord {
  if (market === "HK") {
    return {
      id: "real-hk-116-00700",
      providerSecId: "116.00700",
      symbol: "00700",
      name: "Tencent",
      market,
      sourceCurrency: "HKD",
      quoteCurrency: "CNY",
      type: "STOCK_REAL",
      industry: "Technology",
      isTradable: true,
      lotSize: 100,
      settlementCycle: "T0",
      exchangeCode: "116",
      sourcePage: 1,
      sourceRank: 0,
      sourceUpdatedAt: now.toISOString(),
      isActive: true,
    };
  }
  return {
    id: "real-us-105-nvda",
    providerSecId: "105.NVDA",
    symbol: "NVDA",
    name: "Nvidia",
    market,
    sourceCurrency: "USD",
    quoteCurrency: "USD",
    type: "STOCK_REAL",
    industry: "Technology",
    isTradable: true,
    lotSize: 1,
    settlementCycle: "T0",
    exchangeCode: "105",
    sourcePage: 1,
    sourceRank: 0,
    sourceUpdatedAt: now.toISOString(),
    isActive: true,
  };
}

function mockFetcher(sinaBody: string, tencentBody = "") {
  const urls: string[] = [];
  const fetchImplementation = vi.fn(async (input: string | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.startsWith("https://qt.gtimg.cn/")) {
      return new Response(tencentBody, { status: 200 });
    }
    return new Response(sinaBody, { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchImplementation, urls };
}

describe("Sina supplemental quote mapping", () => {
  it.each(["DAY", "MONTH"] as const)("only accepts explicitly qfq China %s history and rejects unadjusted rows", async range => {
    const cn: RealInstrumentRecord = { ...instrument("US"), id: "real-cn-1-600519", providerSecId: "1.600519", symbol: "600519", market: "CN", exchangeCode: "1", sourceCurrency: "CNY", quoteCurrency: "CNY", lotSize: 100, settlementCycle: "T1" };
    const period = range === "DAY" ? "day" : "month";
    const rows = [["2026-10-26", "10", "11", "12", "9", "100"]];
    const fetchImplementation = vi.fn(async () => Response.json({data: {sh600519: {[`qfq${period}`]: rows}}})) as unknown as typeof fetch;
    const provider = new SupplementalMarketProvider({fetchImplementation, clock: () => now});
    const candles = await provider.fetchHistory(cn, range);
    expect(candles[0]).toMatchObject({source: "REAL_TENCENT_HISTORY", interval: range, close: 11});
    const plain = new SupplementalMarketProvider({clock: () => now, fetchImplementation: vi.fn(async () => Response.json({data: {sh600519: {[period]: rows}}})) as unknown as typeof fetch});
    await expect(plain.fetchHistory(cn, range)).rejects.toThrow("明确的前复权历史");
    await expect(provider.fetchHistory(instrument("US"), range)).rejects.toThrow("暂不支持");
  });

  it.each(["Feb 31 04:00PM EST", "Oct 27 00:00AM EDT", "Oct 27 04:75PM EDT", "Oct 27 04:00PM EST"])("rejects impossible US source timestamp %s", async sourceTime => {
    const row = Array(28).fill("");
    Object.assign(row, { 1: "216", 3: "2026-10-27 22:00:00", 5: "213", 6: "217", 7: "212", 10: "1000", 25: sourceTime, 26: "211" });
    const {fetchImplementation} = mockFetcher(`var hq_str_gb_nvda="${row.join(",")}";`);
    const provider = new SupplementalMarketProvider({fetchImplementation, clock: () => new Date("2026-10-27T14:00:00.000Z")});
    expect(await provider.fetchQuotes([instrument("US")])).toEqual([]);
  });

  it("does not infer a US quote year from the server clock when the source full date is missing", async () => {
    const row = Array(28).fill("");
    Object.assign(row, { 1: "216", 5: "213", 6: "217", 7: "212", 10: "1000", 25: "Oct 27 10:00AM EDT", 26: "211" });
    const {fetchImplementation} = mockFetcher(`var hq_str_gb_nvda="${row.join(",")}";`);
    const provider = new SupplementalMarketProvider({fetchImplementation, clock: () => new Date("2026-10-27T14:00:00.000Z")});
    expect(await provider.fetchQuotes([instrument("US")])).toEqual([]);
  });

  it("keeps Tencent as the first choice when its quote is valid", async () => {
    const row = Array(38).fill("0");
    Object.assign(row, {
      2: "NVDA.OQ",
      3: "216",
      4: "210.96",
      5: "213.11",
      6: "90829293",
      30: "2026-10-27 10:00:00",
      33: "217.75",
      34: "212.61",
      35: "USD",
      37: "19603973093",
    });
    const { fetchImplementation, urls } = mockFetcher("", `v_usNVDA="${row.join("~")}";`);
    const provider = new SupplementalMarketProvider({ fetchImplementation, clock: () => new Date("2026-10-27T14:00:00.000Z") });

    const [quote] = await provider.fetchQuotes([instrument("US")]);

    expect(urls).toEqual(["https://qt.gtimg.cn/q=usNVDA"]);
    expect(quote).toMatchObject({ dataProvider: "TENCENT", currentPrice: 216 });
  });

  it("falls through from a stale Tencent quote to a fresh Sina quote", async () => {
    const openNow = new Date("2026-10-27T14:00:00.000Z");
    const tencent = Array(38).fill("0");
    Object.assign(tencent, {
      2: "NVDA.OQ",
      3: "216",
      4: "210.96",
      5: "213.11",
      6: "90829293",
      30: "2026-10-27 09:30:00",
      33: "217.75",
      34: "212.61",
      35: "USD",
      37: "19603973093",
    });
    const sina = Array(28).fill("");
    Object.assign(sina, {
      0: "Nvidia",
      1: "216.10",
      2: "2.44",
      3: "2026-10-27 22:00:00",
      4: "5.14",
      5: "213.105",
      6: "217.75",
      7: "212.61",
      10: "90829300",
      24: "Oct 27 10:00AM EDT",
      25: "Oct 27 10:00AM EDT",
      26: "210.96",
    });
    const { fetchImplementation, urls } = mockFetcher(
      `var hq_str_gb_nvda="${sina.join(",")}";`,
      `v_usNVDA="${tencent.join("~")}";`,
    );
    const provider = new SupplementalMarketProvider({ fetchImplementation, clock: () => openNow });

    const [quote] = await provider.fetchQuotes([instrument("US")]);

    expect(urls).toEqual([
      "https://qt.gtimg.cn/q=usNVDA",
      "https://hq.sinajs.cn/list=gb_nvda",
    ]);
    expect(quote).toMatchObject({
      currentPrice: 216.1,
      dataProvider: "SINA",
      updatedAt: openNow.toISOString(),
    });
  });

  it("retains the last valid Tencent quote when Sina cannot supply one, even after a long closure", async () => {
    const tencent = Array(38).fill("0");
    Object.assign(tencent, {
      2: "NVDA.OQ", 3: "216", 4: "210.96", 5: "213.11", 6: "90829293",
      30: "2026-10-27 10:00:00", 33: "217.75", 34: "212.61",
      35: "USD", 37: "19603973093",
    });
    const clock = new Date("2026-11-20T15:00:00.000Z");
    const { fetchImplementation, urls } = mockFetcher("", `v_usNVDA="${tencent.join("~")}";`);
    const provider = new SupplementalMarketProvider({ fetchImplementation, clock: () => clock });

    const [quote] = await provider.fetchQuotes([instrument("US")]);

    expect(urls).toEqual(["https://qt.gtimg.cn/q=usNVDA", "https://hq.sinajs.cn/list=gb_nvda"]);
    expect(quote).toMatchObject({
      currentPrice: 216,
      dataProvider: "TENCENT",
      updatedAt: "2026-10-27T14:00:00.000Z",
      receivedAt: clock.toISOString(),
    });
  });

  it("maps HK quote fields and preserves the exchange timestamp", async () => {
    const body = 'var hq_str_hk00700="TENCENT,腾讯控股,387.000,386.400,390.600,383.600,385.200,-1.200,-0.311,385.20001,385.39999,6270746749,16230914,0.000,0.000,656.353,378.000,2026/10/27,16:08";';
    const { fetchImplementation, urls } = mockFetcher(body);
    const provider = new SupplementalMarketProvider({ fetchImplementation, clock: () => now });

    const [quote] = await provider.fetchQuotes([instrument("HK")]);

    expect(urls).toEqual([
      "https://qt.gtimg.cn/q=hk00700",
      "https://hq.sinajs.cn/list=hk00700",
    ]);
    expect(quote).toMatchObject({
      instrumentId: "real-hk-116-00700",
      market: "HK",
      currentPrice: expect.any(Number),
      dataProvider: "SINA",
      updatedAt: "2026-10-27T08:08:00.000Z",
      receivedAt: now.toISOString(),
    });
    expect(quote!.rawCurrentPrice).toBe(385.2);
    expect(quote!.currentPrice).toBeGreaterThan(0);
  });

  it("maps US fields and uses the regular-session timestamp, not the premarket timestamp", async () => {
    const us = Array(28).fill("");
    Object.assign(us, {
      0: "Nvidia",
      1: "216.0000",
      2: "2.39",
      3: "2026-10-27 19:14:46",
      4: "5.0400",
      5: "213.1050",
      6: "217.7500",
      7: "212.6100",
      10: "90829293",
      24: "Oct 27 07:14AM EDT",
      25: "Oct 26 04:00PM EDT",
      26: "210.9600",
    });
    const body = `var hq_str_gb_nvda="${us.join(",")}";`;
    const { fetchImplementation } = mockFetcher(body);
    const provider = new SupplementalMarketProvider({ fetchImplementation, clock: () => now });

    const [quote] = await provider.fetchQuotes([instrument("US")]);

    expect(quote).toMatchObject({
      instrumentId: "real-us-105-nvda",
      market: "US",
      currentPrice: 216,
      previousClose: 210.96,
      dataProvider: "SINA",
      updatedAt: "2026-10-26T20:00:00.000Z",
      receivedAt: now.toISOString(),
      amount: 0,
    });
  });

  it("uses complete Tencent A-share minute OHLC from the latest available trading day", async () => {
    const cn: RealInstrumentRecord = {
      ...instrument("US"), id: "real-cn-1-600519", providerSecId: "1.600519", symbol: "600519",
      market: "CN", exchangeCode: "1", sourceCurrency: "CNY", quoteCurrency: "CNY",
      lotSize: 100, settlementCycle: "T1",
    };
    const fetchImplementation = vi.fn(async () => Response.json({ code: 0, data: {
      sh600519: { m1: [
        ["202610271500", "1300", "1300", "1301", "1299", "10"],
        ["202610281459", "1330.71", "1330.71", "1330.71", "1330.71", "0"],
        ["202610281500", "1330.71", "1330.75", "1330.75", "1330.71", "1519"],
      ] },
    } })) as unknown as typeof fetch;
    const provider = new SupplementalMarketProvider({ fetchImplementation, clock: () => new Date("2026-10-28T08:10:00.000Z") });

    const candles = await provider.fetchHistory(cn, "INTRADAY");

    expect(candles).toHaveLength(2);
    expect(candles[1]).toMatchObject({ instrumentId: cn.id, interval: "MINUTE", time: "2026-10-28T07:00:00.000Z",
      open: 1330.71, close: 1330.75, high: 1330.75, low: 1330.71, volume: 1519, source: "REAL_TENCENT_HISTORY" });
    expect(candles[1]?.averagePrice).toBeUndefined();
    expect(vi.mocked(fetchImplementation).mock.calls[0]?.[0]).toBe("https://ifzq.gtimg.cn/appstock/app/kline/mkline?param=sh600519,m1,,320");
  });

  it("rejects malformed Tencent minute candle timestamps instead of inventing dates", async () => {
    const cn: RealInstrumentRecord = {
      ...instrument("US"), id: "real-cn-1-600519", providerSecId: "1.600519", symbol: "600519",
      market: "CN", exchangeCode: "1", sourceCurrency: "CNY", quoteCurrency: "CNY", lotSize: 100, settlementCycle: "T1",
    };
    const fetchImplementation = vi.fn(async () => Response.json({ data: { sh600519: { m1: [
      ["202609310930", "10", "10", "10", "10", "0"],
    ] } } })) as unknown as typeof fetch;
    const provider = new SupplementalMarketProvider({ fetchImplementation, clock: () => new Date("2026-10-28T08:10:00.000Z") });
    await expect(provider.fetchHistory(cn, "INTRADAY")).rejects.toThrow("无效价格、时间或成交量");
  });

  it("maps a verified London Tencent quote from GBX into the simulator USD quote", async () => {
    const uk: RealInstrumentRecord = { ...instrument("US"), id: "real-uk-155-vod", providerSecId: "155.VOD",
      market: "UK", symbol: "VOD", exchangeCode: "155", sourceCurrency: "GBP", quoteCurrency: "USD" };
    const row = Array(38).fill("0");
    Object.assign(row, { 2: "VOD", 3: "119.15", 4: "118.90", 5: "118.00", 6: "1870060",
      30: "2026-10-28 08:12:23", 33: "119.65", 34: "117.65", 35: "GBX", 37: "216170360" });
    const { fetchImplementation, urls } = mockFetcher("", `v_ukVOD="${row.join("~")}";`);
    const provider = new SupplementalMarketProvider({ fetchImplementation, clock: () => new Date("2026-10-28T08:14:00.000Z") });
    const [quote] = await provider.fetchQuotes([uk]);
    expect(urls).toEqual(["https://qt.gtimg.cn/q=ukVOD"]);
    expect(quote).toMatchObject({ instrumentId: uk.id, dataProvider: "TENCENT", updatedAt: "2026-10-28T08:12:23.000Z", rawCurrentPrice: 119.15 });
    expect(quote!.currentPrice).toBeCloseTo(119.15 * 0.01 * (9.0268 / 6.7771), 8);
  });

  it("rejects a UK quote whose ticker or pence currency does not match", async () => {
    const uk: RealInstrumentRecord = { ...instrument("US"), id: "real-uk-155-vod", providerSecId: "155.VOD",
      market: "UK", symbol: "VOD", exchangeCode: "155", sourceCurrency: "GBP", quoteCurrency: "USD" };
    const row = Array(38).fill("0");
    Object.assign(row, { 2: "VOD", 3: "119.15", 4: "118.90", 5: "118.00", 6: "1",
      30: "2026-10-28 08:12:23", 33: "119.65", 34: "117.65", 35: "GBP", 37: "1" });
    const { fetchImplementation } = mockFetcher("", `v_ukVOD="${row.join("~")}";`);
    const provider = new SupplementalMarketProvider({ fetchImplementation, clock: () => new Date("2026-10-28T08:14:00.000Z") });
    expect(await provider.fetchQuotes([uk])).toEqual([]);
  });

  it("does not claim a UK symbol mapping without a tested Sina code", () => {
    const uk = { ...instrument("US"), id: "real-uk-155-shel", market: "UK" as const, symbol: "SHEL", sourceCurrency: "GBP" as const };
    expect(sinaCode(uk)).toBeNull();
  });
});
