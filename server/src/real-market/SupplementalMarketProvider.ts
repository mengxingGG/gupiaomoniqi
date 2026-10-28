import type { ChartRange } from "@gupiaomoniqi/shared";
import { IMPORT_FX_RATES } from "../db/constants.js";
import { quoteMaximumAgeMs } from "./tradingHours.js";
import type { ProviderCandle, ProviderOrderBook, RealInstrumentRecord, RealQuoteRecord } from "./types.js";

interface Options {
  fetchImplementation?: typeof fetch;
  requestTimeoutMs?: number;
  clock?: () => Date;
  quoteMaximumReceiveAgeMs?: number;
  quoteMaximumReceiveAgeOffHoursMs?: number;
}
/** 只接收已识别的缺失标的。一个标的一份完整快照，不将不同供应商字段拼接。 */
export class SupplementalMarketProvider {
  private readonly fetcher: typeof fetch;
  private readonly clock: () => Date;
  private readonly circuits = new Map<string, { failures: number; until: number }>();
  private readonly quotes = new Map<string, { at: number; value: RealQuoteRecord | null }>();
  private readonly pending = new Map<string, Promise<RealQuoteRecord[]>>();
  constructor(private readonly options: Options = {}) {
    this.fetcher = options.fetchImplementation ?? fetch; this.clock = options.clock ?? (() => new Date());
  }
  async fetchQuotes(instruments: RealInstrumentRecord[], signal?: AbortSignal): Promise<RealQuoteRecord[]> {
    signal?.throwIfAborted();
    const wanted = [...new Map(instruments.filter(i => tencentCode(i) || sinaCode(i)).map(i => [i.id, i])).values()];
    const key = wanted.map(i => i.id).sort().join(",");
    const running = this.pending.get(key); if (running) return running;
    const task = this.loadQuotes(wanted, signal).finally(() => this.pending.delete(key));
    this.pending.set(key, task); return task;
  }
  private async loadQuotes(wanted: RealInstrumentRecord[], signal?: AbortSignal) {
    const result: RealQuoteRecord[] = [];
    const missing = wanted.filter(i => {
      const cached = this.quotes.get(i.id);
      if (cached && Date.now() - cached.at < (cached.value ? 5000 : 15000)) {
        if (cached.value) result.push(cached.value);
        return false;
      }
      return true;
    });
    for (let start = 0; start < missing.length; start += 50) {
      signal?.throwIfAborted();
      const batch = missing.slice(start, start + 50);
      let rows = new Map<string, string[]>();
      const tencentItems = batch.filter(i => tencentCode(i));
      if (tencentItems.length) {
        try { rows = quoteRows(await this.request(`https://qt.gtimg.cn/q=${tencentItems.map(i => tencentCode(i)!).join(",")}`, "tencent-quote", signal), "~"); }
        catch { signal?.throwIfAborted(); }
      }
      const unresolved: RealInstrumentRecord[] = [];
      const retained = new Map<string, RealQuoteRecord>();
      for (const item of batch) {
        const code = tencentCode(item);
        const quote = code ? parseTencentQuote(item, rows.get(code), this.clock()) : null;
        if (quote && this.isFreshQuote(quote)) { result.push(quote); this.quotes.set(item.id, { at: Date.now(), value: quote }); }
        else {
          if (quote) retained.set(item.id, quote);
          unresolved.push(item);
        }
      }
      // 新浪补腾讯仍未补齐的 CN/HK/US 标的；不重复请求已成功的股票。
      const sinaItems = unresolved.filter(i => sinaCode(i));
      let sina = new Map<string, string[]>();
      if (sinaItems.length) {
        try { sina = quoteRows(await this.request(`https://hq.sinajs.cn/list=${sinaItems.map(i => sinaCode(i)!).join(",")}`, "sina-quote", signal), ","); }
        catch { signal?.throwIfAborted(); }
      }
      for (const item of unresolved) {
        const code = sinaCode(item);
        const sinaQuote = code ? parseSinaQuote(item, sina.get(code), this.clock()) : null;
        const tencentQuote = retained.get(item.id);
        // 休市和长假允许使用最后有效价；优先较新的完整供应商快照，不修改源时间。
        const quote = sinaQuote && (!tencentQuote || sinaQuote.updatedAt > tencentQuote.updatedAt)
          ? sinaQuote : tencentQuote ?? sinaQuote;
        this.quotes.set(item.id, { at: Date.now(), value: quote ?? null });
        if (quote) result.push(quote);
      }
    }
    // 股票池虽有界，仍定期去掉冷缓存。
    if (this.quotes.size > 20000) for (const [id, entry] of this.quotes) if (Date.now() - entry.at > 60000) this.quotes.delete(id);
    return result;
  }
  private isFreshQuote(quote: RealQuoteRecord): boolean {
    const now = this.clock();
    const updatedAt = Date.parse(quote.updatedAt);
    if (!Number.isFinite(updatedAt)) return false;
    const maximumAge = quoteMaximumAgeMs(
      quote.market,
      now,
      this.options.quoteMaximumReceiveAgeMs ?? 120_000,
      this.options.quoteMaximumReceiveAgeOffHoursMs ?? 30 * 60_000,
    );
    return now.getTime() - updatedAt <= maximumAge;
  }
  async fetchHistory(instrument: RealInstrumentRecord, range: ChartRange, signal?: AbortSignal): Promise<ProviderCandle[]> {
    const code = tencentCode(instrument);
    // 港股接口对 qfq 参数返回 day，不能假定已复权；未经核验的能力不伪装为支持。
    if (instrument.market !== "CN" || !code) throw new Error("备用源暂不支持该市场/周期的同口径历史");
    if (range === "INTRADAY") return this.fetchChinaMinuteHistory(instrument, code, signal);
    if (range !== "DAY" && range !== "MONTH") throw new Error("备用源暂不支持该市场/周期的同口径历史");
    const period = range === "DAY" ? "day" : "month";
    const payload = JSON.parse(await this.request(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${code},${period},,,${range === "DAY" ? 160 : 60},qfq`, "tencent-history", signal));
    const data = payload?.data?.[code];
    const rows: unknown = data?.[`qfq${period}`];
    if (!Array.isArray(rows) || !rows.length) throw new Error("备用源未返回明确的前复权历史");
    const updatedAt = this.clock().toISOString();
    const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(this.clock());
    const candles: ProviderCandle[] = [];
    for (const raw of rows) {
      if (!Array.isArray(raw) || !/^\d{4}-\d{2}-\d{2}$/.test(String(raw[0]))) throw new Error("备用历史日期格式无效");
      const date = String(raw[0]); const [open, close, high, low, volume] = raw.slice(1, 6).map(number);
      if (!timestamp(`${date}000000`, "Asia/Shanghai", this.clock()) || !validPrices(open!, close!, high!, low!) || !Number.isFinite(volume) || volume! < 0 || date > today) throw new Error("备用历史包含无效价格、日期或成交量");
      candles.push({ instrumentId: instrument.id, interval: range, time: `${range === "MONTH" ? date.slice(0, 7) + "-01" : date}T00:00:00.000Z`,
        open: open!, close: close!, high: high!, low: low!, volume: volume!, source: "REAL_TENCENT_HISTORY",
        isPartial: range === "MONTH" ? date.slice(0, 7) === today.slice(0, 7) : date === today, updatedAt });
    }
    return [...new Map(candles.map(c => [c.time, c])).values()].sort((a, b) => a.time.localeCompare(b.time));
  }
  private async fetchChinaMinuteHistory(instrument: RealInstrumentRecord, code: string, signal?: AbortSignal): Promise<ProviderCandle[]> {
    const payload = JSON.parse(await this.request(
      `https://ifzq.gtimg.cn/appstock/app/kline/mkline?param=${code},m1,,320`,
      "tencent-minute-history", signal,
    ));
    const rows: unknown = payload?.data?.[code]?.m1;
    if (!Array.isArray(rows) || !rows.length) throw new Error("备用源未返回分钟 OHLC");
    const now = this.clock();
    const updatedAt = now.toISOString();
    const parsed: Array<{ date: string; candle: ProviderCandle }> = [];
    for (const raw of rows) {
      if (!Array.isArray(raw) || !/^\d{12}$/.test(String(raw[0]))) throw new Error("备用分钟日期格式无效");
      const local = String(raw[0]);
      const time = timestamp(`${local}00`, "Asia/Shanghai", now);
      const [open, close, high, low, volume] = raw.slice(1, 6).map(number);
      if (!time || !validPrices(open!, close!, high!, low!) || !Number.isFinite(volume) || volume! < 0) {
        throw new Error("备用分钟历史包含无效价格、时间或成交量");
      }
      parsed.push({ date: local.slice(0, 8), candle: {
        instrumentId: instrument.id, interval: "MINUTE", time,
        open: open!, close: close!, high: high!, low: low!, volume: volume!,
        source: "REAL_TENCENT_HISTORY", isPartial: Date.parse(time) + 60_000 > now.getTime(), updatedAt,
      } });
    }
    const latestDate = parsed.map(x => x.date).sort().at(-1)!;
    return [...new Map(parsed.filter(x => x.date === latestDate).map(x => [x.candle.time, x.candle])).values()]
      .sort((a, b) => a.time.localeCompare(b.time));
  }
  async fetchOrderBook(instrument: RealInstrumentRecord, signal?: AbortSignal): Promise<ProviderOrderBook> {
    const code = tencentCode(instrument);
    if (instrument.market !== "CN" || !code) throw new Error("备用源暂不支持该市场的五档盘口");
    const row = quoteRows(await this.request(`https://qt.gtimg.cn/q=${code}`, "tencent-quote", signal), "~").get(code);
    const quote = parseTencentQuote(instrument, row, this.clock());
    if (!quote || !row) throw new Error("备用盘口的标的或时间无效");
    const side = (offset: number) => Array.from({ length: 5 }, (_, i) => ({ price: number(row[offset + i * 2]), quantity: number(row[offset + i * 2 + 1]) }))
      .filter(x => Number.isFinite(x.price) && Number.isFinite(x.quantity) && x.price > 0 && x.quantity > 0);
    const bids = side(9), asks = side(19);
    if (!bids.length && !asks.length) throw new Error("备用盘口没有有效档位");
    return { bids, asks, updatedAt: quote.updatedAt, dataProvider: "TENCENT" };
  }
  private async request(url: string, route: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const circuit = this.circuits.get(route);
    if (circuit && circuit.until > Date.now()) throw new Error("备用路线冷却中");
    try {
      const response = await this.fetcher(url, { signal: AbortSignal.any([AbortSignal.timeout(Math.min(this.options.requestTimeoutMs ?? 6000, 8000)), ...(signal ? [signal] : [])]),
        headers: { Referer: route.startsWith("sina") ? "https://finance.sina.com.cn/" : "https://gu.qq.com/", "User-Agent": "Mozilla/5.0" } });
      if (!response.ok) throw new Error(`备用接口 HTTP ${response.status}`);
      const buffer = await response.arrayBuffer(); if (buffer.byteLength > 4_000_000) throw new Error("备用响应过大");
      const body = new TextDecoder(route === "tencent-history" || route === "tencent-minute-history" ? "utf-8" : "gb18030").decode(buffer);
      if (!body.trim()) throw new Error("备用接口返回空响应");
      this.circuits.delete(route); return body;
    } catch (error) {
      signal?.throwIfAborted();
      const failures = (circuit?.failures ?? 0) + 1;
      this.circuits.set(route, { failures, until: failures >= 3 ? Date.now() + 30000 : 0 }); throw error;
    }
  }
}

export function tencentCode(i: RealInstrumentRecord): string | null {
  if (i.market === "CN" && /^\d{6}$/.test(i.symbol)) {
    if (i.exchangeCode === "1") return `sh${i.symbol}`;
    if (i.exchangeCode === "0") return `${/^(4|8|92)/.test(i.symbol) ? "bj" : "sz"}${i.symbol}`;
  }
  if (i.market === "HK" && /^\d{5}$/.test(i.symbol) && i.sourceCurrency === "HKD") return `hk${i.symbol}`;
  if (i.market === "US" && /^[A-Z][A-Z0-9.\-]{0,15}$/.test(i.symbol) && i.sourceCurrency === "USD") return `us${i.symbol}`;
  // 仅覆盖已验证的伦敦普通股编码；其他英国市场代码不能假定与腾讯同一身份。
  if (i.market === "UK" && i.exchangeCode === "155" && /^[A-Z][A-Z0-9.\-]{0,15}$/.test(i.symbol) && i.sourceCurrency === "GBP") return `uk${i.symbol}`;
  return null;
}
export function sinaCode(i: RealInstrumentRecord): string | null {
  if (i.market === "CN" && /^(sh|sz)/.test(tencentCode(i) ?? "")) return tencentCode(i);
  if (i.market === "HK" && /^\d{5}$/.test(i.symbol) && i.sourceCurrency === "HKD") return `hk${i.symbol}`;
  if (i.market === "US" && /^[A-Z][A-Z0-9.\-]{0,15}$/.test(i.symbol) && i.sourceCurrency === "USD") return `gb_${i.symbol.toLowerCase()}`;
  return null;
}
function quoteRows(text: string, separator: string) {
  const rows = new Map<string, string[]>();
  for (const match of text.matchAll(/(?:var\s+)?(?:v_|hq_str_)([\w.\-]+)="([^"\r\n]*)"/g)) rows.set(match[1]!, match[2]!.split(separator));
  return rows;
}
function number(value: unknown) { return typeof value === "string" && value.trim() === "" ? NaN : Number(value); }
function validPrices(open: number, close: number, high: number, low: number) {
  return [open, close, high, low].every(x => Number.isFinite(x) && x > 0) && high >= Math.max(open, close) && low <= Math.min(open, close);
}
function timestamp(raw: string, zone: string, now: Date): string | null {
  const digits = raw.replace(/\D/g, ""); if (!/^\d{14}$/.test(digits)) return null;
  const [y, m, d, h, min, sec] = [digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8), digits.slice(8, 10), digits.slice(10, 12), digits.slice(12, 14)].map(Number);
  const target = Date.UTC(y!, m! - 1, d, h, min, sec);
  const wall = new Date(target);
  if (wall.getUTCFullYear() !== y || wall.getUTCMonth() + 1 !== m || wall.getUTCDate() !== d ||
      wall.getUTCHours() !== h || wall.getUTCMinutes() !== min || wall.getUTCSeconds() !== sec) return null;
  let instant = target;
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  for (let n = 0; n < 2; n++) {
    const p = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(x => [x.type, x.value]));
    instant += target - Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  }
  // 周末/长假保留真实源时间，未来时间不能作为有效报价。
  return instant > now.getTime() + 120000 ? null : new Date(instant).toISOString();
}
function quote(i: RealInstrumentRecord, raw: number[], volume: number, amount: number, time: string | null, now: Date, provider: "TENCENT" | "SINA"): RealQuoteRecord | null {
  const [current, previous, open, high, low] = raw;
  if (!time || !validPrices(open!, current!, high!, low!) || !Number.isFinite(previous) || previous! <= 0 || !Number.isFinite(volume) || volume < 0 || !Number.isFinite(amount) || amount < 0) return null;
  const factor = i.market === "HK" ? IMPORT_FX_RATES.HKD_CNY : i.market === "UK" ? IMPORT_FX_RATES.GBP_USD * 0.01 : 1;
  return { instrumentId: i.id, symbol: i.symbol, market: i.market, quoteCurrency: i.quoteCurrency,
    currentPrice: current! * factor, previousClose: previous! * factor, openPrice: open! * factor, highPrice: high! * factor, lowPrice: low! * factor,
    volume, amount, changeAmount: (current! - previous!) * factor, changePercent: (current! / previous! - 1) * 100,
    rawCurrentPrice: current!, rawPreviousClose: previous!, rawOpenPrice: open!, rawHighPrice: high!, rawLowPrice: low!,
    updatedAt: time, receivedAt: now.toISOString(), dataProvider: provider };
}
export function parseTencentQuote(i: RealInstrumentRecord, row: string[] | undefined, now: Date): RealQuoteRecord | null {
  if (!row || row.length < 38) return null;
  const symbol = row[2]!.replace(/\.(OQ|N|NYS|AM|ASE|O)$/, ""); if (symbol !== i.symbol) return null;
  if (i.market === "US" && row[35] !== "USD" || i.market === "HK" && !row.includes("HKD") ||
      i.market === "UK" && row[35] !== "GBX") return null;
  const zone = i.market === "US" ? "America/New_York" : i.market === "UK" ? "Europe/London" : "Asia/Shanghai";
  const time = timestamp(row[30]!, zone, now);
  return quote(i, [3, 4, 5, 33, 34].map(n => number(row[n])), number(row[6]), number(row[37]) * (i.market === "CN" ? 10000 : 1), time, now, "TENCENT");
}
function parseSinaQuote(i: RealInstrumentRecord, row: string[] | undefined, now: Date): RealQuoteRecord | null {
  if (!row) return null;
  if (i.market === "CN" && row.length >= 32) {
    return quote(i, [3, 2, 1, 4, 5].map(n => number(row[n])), number(row[8]) / 100, number(row[9]), timestamp(`${row[30]} ${row[31]}`, "Asia/Shanghai", now), now, "SINA");
  }
  if (i.market === "HK" && row.length >= 19) {
    const date = row[17]!.replace(/\D/g, "");
    const time = row[18]!.replace(/\D/g, "");
    const rawTimestamp = date + (time.length === 4 ? `${time}00` : time.padEnd(6, "0"));
    // Sina HK layout: open, previous close, high, low, current, ..., turnover, volume, ..., date, time.
    return quote(i, [6, 3, 2, 4, 5].map(n => number(row[n])), number(row[12]), number(row[11]), timestamp(rawTimestamp, "Asia/Hong_Kong", now), now, "SINA");
  }
  if (i.market === "US" && row.length >= 27) {
    // Field 25 is the regular-session update time; field 24 is the separate pre/post-market time.
    // Sina's US quote layout does not expose turnover in this endpoint, so keep amount=0 rather than inventing it.
    return quote(i, [1, 26, 5, 6, 7].map(n => number(row[n])), number(row[10]), 0, timestampUsSina(row[25]!, row[3]!, now), now, "SINA");
  }
  return null;
}
const SINA_MONTHS: Record<string, number> = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
function timestampUsSina(raw: string, observedRaw: string, now: Date): string | null {
  const match = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s+(\d{1,2}):(\d{2})(AM|PM)\s+(EDT|EST)$/.exec(raw.trim());
  // Field 25 omits the year. Use the source's own full-date observation (field
  // 3, Beijing time), never the server's current year. Ambiguous old rows fail.
  if (!match || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(observedRaw)) return null;
  const observed = timestamp(observedRaw, "Asia/Shanghai", now);
  if (!observed) return null;
  const observedMs = Date.parse(observed);
  let hour = Number(match[3]);
  const minute = Number(match[4]);
  if (hour < 1 || hour > 12 || minute > 59) return null;
  if (match[5] === "AM" && hour === 12) hour = 0;
  if (match[5] === "PM" && hour !== 12) hour += 12;
  const month = SINA_MONTHS[match[1]!]!;
  const day = Number(match[2]);
  const offsetMinutes = match[6] === "EDT" ? -4 * 60 : -5 * 60;
  const year = Number(observedRaw.slice(0, 4));
  const candidates = [year - 1, year].flatMap(candidateYear => {
    const wallMs = Date.UTC(candidateYear, month - 1, day, hour, minute);
    const wall = new Date(wallMs);
    if (wall.getUTCFullYear() !== candidateYear || wall.getUTCMonth() + 1 !== month || wall.getUTCDate() !== day) return [];
    const instant = wallMs - offsetMinutes * 60_000;
    const canonical = timestamp(`${candidateYear}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}${String(hour).padStart(2, "0")}${String(minute).padStart(2, "0")}00`, "America/New_York", now);
    return canonical && Date.parse(canonical) === instant && instant <= observedMs + 120_000 && observedMs - instant <= 7 * 86400000 ? [instant] : [];
  });
  if (candidates.length !== 1) return null;
  return new Date(candidates[0]!).toISOString();
}
