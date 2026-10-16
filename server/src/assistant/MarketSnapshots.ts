import { z } from "zod";
import type { Quote } from "@gupiaomoniqi/shared";
import { AssistantError } from "./AssistantStore.js";

type Mode = "REAL" | "VIRTUAL";
interface Stock { id: string; name: string; symbol: string; market: string; industry?: string }
interface Day { time: string; close: number; source?: string; isPartial?: boolean }
export interface SnapshotSource {
  stocks(mode: Mode): Stock[];
  quote(mode: Mode, id: string): Quote | undefined;
  days(mode: Mode, id: string): Promise<Day[]>;
}
export const snapshotQuery = z.object({ mode: z.enum(["REAL", "VIRTUAL"]), after: z.string().max(120).default(""),
  limit: z.coerce.number().int().min(1).max(50).default(50), query: z.string().trim().max(100).optional(),
  market: z.enum(["CN", "HK", "US", "UK"]).optional(), ids: z.array(z.string().max(120)).max(20).optional() });
type SnapshotQuery = z.input<typeof snapshotQuery>;

/** 只读服务器已记录的日快照；快查不触发全市场外部历史补拉。 */
export class MarketSnapshots {
  private readonly cache = new Map<string, { at: number; rows: Day[] }>();
  private readonly inFlight = new Map<string, Promise<Day[]>>();
  private readonly queue: (() => void)[] = [];
  private active = 0;
  constructor(private readonly source: SnapshotSource, private readonly clock = () => new Date()) {}
  private async days(mode: Mode, id: string) {
    const key = `${mode}:${id}`, now = this.clock().getTime(), cached = this.cache.get(key);
    if (cached && now - cached.at < 5 * 60_000) return cached.rows;
    const running = this.inFlight.get(key); if (running) return running;
    if (this.queue.length >= 200) throw new AssistantError("快照正在同步，请稍后重试", 429);
    const promise = (async () => {
      if (this.active >= 4) await new Promise<void>(resolve => this.queue.push(resolve));
      else this.active++;
      try {
        const rows = await this.source.days(mode, id);
        // 缓存仅保留最近访问的日数据，避免全市场长期驻留内存。
        if (this.cache.size >= 6000) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(key, { at: this.clock().getTime(), rows }); return rows;
      } finally { const next = this.queue.shift(); if (next) next(); else this.active--; }
    })();
    this.inFlight.set(key, promise);
    try { return await promise; } finally { this.inFlight.delete(key); }
  }
  async page(input: SnapshotQuery) {
    const options = snapshotQuery.parse(input), now = this.clock();
    // 近7个自然日（含今天），缺失交易日保持缺失，不插值或复制前收。
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 6)).toISOString();
    const stocks = this.source.stocks(options.mode).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const matching = stocks.filter(s => (!options.ids || options.ids.includes(s.id)) && (!options.market || s.market === options.market) &&
      (!options.query || `${s.name} ${s.symbol} ${s.id}`.toLowerCase().includes(options.query.toLowerCase())));
    const remaining = matching.filter(s => s.id > options.after), selected = remaining.slice(0, options.limit);
    const items = [];
    // 单批串行，跨批最多4个历史查询；报价从内存取，避免抢占前台数据库队列。
    for (const stock of selected) {
      const quote = this.source.quote(options.mode, stock.id);
      let historyError: string | undefined;
      const daily = await this.days(options.mode, stock.id).catch(() => { historyError = "日快照暂不可用"; return []; });
      const days = daily.filter(d => d.time >= start && d.time <= now.toISOString() && Number.isFinite(d.close) && d.close > 0)
        .map(d => ({ time: d.time, close: d.close, source: d.source ?? "DATABASE_RECORDED", isPartial: d.isPartial ?? false })).sort((a,b) => a.time.localeCompare(b.time));
      items.push({ id: stock.id, name: stock.name, symbol: stock.symbol, market: stock.market, industry: stock.industry,
        quote: quote ? { price: quote.currentPrice, changePercent: quote.changePercent, volume: quote.volume,
        currency: quote.quoteCurrency, time: quote.updatedAt, source: quote.dataProvider ?? (options.mode === "VIRTUAL" ? "VIRTUAL_ENGINE" : "REAL_MARKET_RECORDED") } : null, days, historyError });
    }
    return { mode: options.mode, asOf: now.toISOString(), windowStart: start, universe: stocks.length, matched: matching.length,
      items, nextAfter: remaining.length > selected.length ? selected.at(-1)!.id : null,
      notice: "近7个自然日已记录的日快照，可能不足7天；不补造缺失价格。报价时间以每只股票为准，交易前需读取最新个股详情。" };
  }
}
