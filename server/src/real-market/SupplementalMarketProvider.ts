import type { ChartRange } from "@gupiaomoniqi/shared";
import { IMPORT_FX_RATES } from "../db/constants.js";
import type { ProviderCandle, ProviderOrderBook, RealInstrumentRecord, RealQuoteRecord } from "./types.js";

interface Options { fetchImplementation?: typeof fetch; requestTimeoutMs?: number; clock?: () => Date }
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
    const wanted = [...new Map(instruments.filter(i => tencentCode(i)).map(i => [i.id, i])).values()];
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
        if (cached.value) result.push(cached.value); return false;
      }
      return true;
    });
    for (let start = 0; start < missing.length; start += 50) {
      signal?.throwIfAborted();
      const batch = missing.slice(start, start + 50);
      let rows = new Map<string, string[]>();
      try { rows = quoteRows(await this.request(`https://qt.gtimg.cn/q=${batch.map(tencentCode).join(",")}`, "tencent-quote", signal), "~"); }
      catch { signal?.throwIfAborted(); }
      const unresolved: RealInstrumentRecord[] = [];
      for (const item of batch) {
        const quote = parseTencentQuote(item, rows.get(tencentCode(item)!), this.clock());
        if (quote) { result.push(quote); this.quotes.set(item.id, { at: Date.now(), value: quote }); }
        else unresolved.push(item);
      }
      // 新浪仅用于腾讯仍未补齐的 A 股，不重复请求已成功的股票。
      const china = unresolved.filter(i => i.market === "CN" && /^(sh|sz)/.test(tencentCode(i)!));
      let sina = new Map<string, string[]>();
      if (china.length) {
        try { sina = quoteRows(await this.request(`https://hq.sinajs.cn/list=${china.map(tencentCode).join(",")}`, "sina-quote", signal), ","); }
        catch { signal?.throwIfAborted(); }
      }
      for (const item of unresolved) {
        const quote = parseSinaQuote(item, sina.get(tencentCode(item)!), this.clock());
        this.quotes.set(item.id, { at: Date.now(), value: quote }); if (quote) result.push(quote);
      }
    }
    // 股票池虽有界，仍定期去掉冷缓存。
    if (this.quotes.size > 20000) for (const [id, entry] of this.quotes) if (Date.now() - entry.at > 60000) this.quotes.delete(id);
    return result;
  }
  async fetchHistory(instrument: RealInstrumentRecord, range: ChartRange, signal?: AbortSignal): Promise<ProviderCandle[]> {
    const code = tencentCode(instrument);
    // 港股接口对 qfq 参数返回 day，不能假定已复权；未经核验的能力不伪装为支持。
    if (instrument.market !== "CN" || !code || (range !== "DAY" && range !== "MONTH")) throw new Error("备用源暂不支持该市场/周期的同口径历史");
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
      if (!validPrices(open!, close!, high!, low!) || !Number.isFinite(volume) || volume! < 0 || date > today) throw new Error("备用历史包含无效价格或成交量");
      candles.push({ instrumentId: instrument.id, interval: range, time: `${range === "MONTH" ? date.slice(0, 7) + "-01" : date}T00:00:00.000Z`,
        open: open!, close: close!, high: high!, low: low!, volume: volume!, source: "REAL_TENCENT_HISTORY",
        isPartial: range === "MONTH" ? date.slice(0, 7) === today.slice(0, 7) : date === today, updatedAt });
    }
    return [...new Map(candles.map(c => [c.time, c])).values()].sort((a, b) => a.time.localeCompare(b.time));
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
      const body = new TextDecoder(route === "tencent-history" ? "utf-8" : "gb18030").decode(buffer);
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
  const target = Date.UTC(y!, m! - 1, d, h, min, sec); let instant = target;
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  for (let n = 0; n < 2; n++) {
    const p = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(x => [x.type, x.value]));
    instant += target - Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  }
  // 周末/休市保留原始交易时间，未来时间或超过两周的停更数据不当作补齐。
  return instant > now.getTime() + 120000 || now.getTime() - instant > 14 * 86400000 ? null : new Date(instant).toISOString();
}
function quote(i: RealInstrumentRecord, raw: number[], volume: number, amount: number, time: string | null, now: Date, provider: "TENCENT" | "SINA"): RealQuoteRecord | null {
  const [current, previous, open, high, low] = raw;
  if (!time || !validPrices(open!, current!, high!, low!) || !Number.isFinite(previous) || previous! <= 0 || !Number.isFinite(volume) || volume < 0 || !Number.isFinite(amount) || amount < 0) return null;
  const factor = i.market === "HK" ? IMPORT_FX_RATES.HKD_CNY : 1;
  return { instrumentId: i.id, symbol: i.symbol, market: i.market, quoteCurrency: i.quoteCurrency,
    currentPrice: current! * factor, previousClose: previous! * factor, openPrice: open! * factor, highPrice: high! * factor, lowPrice: low! * factor,
    volume, amount, changeAmount: (current! - previous!) * factor, changePercent: (current! / previous! - 1) * 100,
    rawCurrentPrice: current!, rawPreviousClose: previous!, rawOpenPrice: open!, rawHighPrice: high!, rawLowPrice: low!,
    updatedAt: time, receivedAt: now.toISOString(), dataProvider: provider };
}
export function parseTencentQuote(i: RealInstrumentRecord, row: string[] | undefined, now: Date): RealQuoteRecord | null {
  if (!row || row.length < 38) return null;
  const symbol = row[2]!.replace(/\.(OQ|N|NYS|AM|ASE|O)$/, ""); if (symbol !== i.symbol) return null;
  if (i.market === "US" && row[35] !== "USD" || i.market === "HK" && !row.includes("HKD")) return null;
  const time = timestamp(row[30]!, i.market === "US" ? "America/New_York" : "Asia/Shanghai", now);
  return quote(i, [3, 4, 5, 33, 34].map(n => number(row[n])), number(row[6]), number(row[37]) * (i.market === "CN" ? 10000 : 1), time, now, "TENCENT");
}
function parseSinaQuote(i: RealInstrumentRecord, row: string[] | undefined, now: Date): RealQuoteRecord | null {
  if (i.market !== "CN" || !row || row.length < 32) return null;
  return quote(i, [3, 2, 1, 4, 5].map(n => number(row[n])), number(row[8]) / 100, number(row[9]), timestamp(`${row[30]} ${row[31]}`, "Asia/Shanghai", now), now, "SINA");
}
