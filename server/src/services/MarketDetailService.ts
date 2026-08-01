import type {
  ChartRange,
  ChartSeries,
  OrderBookLevel,
  OrderBookSnapshot,
} from "@gupiaomoniqi/shared";
import { roundUnitPrice } from "../domain/money.js";
import type { GameRepository } from "../repositories/GameRepository.js";
import type { CandleService } from "./CandleService.js";

export class MarketDetailService {
  constructor(
    private readonly repository: GameRepository,
    private readonly orderFlow?: {
      getNetOrderFlow(instrumentId: string): number;
    },
    private readonly candleService?: CandleService,
  ) {}

  getChart(
    instrumentId: string,
    range: ChartRange,
  ): ChartSeries | undefined {
    return this.candleService?.getChart(instrumentId, range);
  }

  getOrderBook(instrumentId: string): OrderBookSnapshot | undefined {
    const instrument = this.repository.getInstrumentById(instrumentId);
    const quote = this.repository.getQuote(instrumentId);

    if (!instrument || !quote) {
      return undefined;
    }

    const random = seededRandom(
      `${instrument.id}:${quote.updatedAt}:${quote.currentPrice}`,
    );
    const tickSize =
      quote.currentPrice < 1
        ? 0.0001
        : quote.currentPrice < 100
          ? 0.01
          : 0.1;
    const baseQuantity = Math.max(
      instrument.lotSize,
      Math.round(instrument.liquidity / instrument.lotSize) *
        instrument.lotSize,
    );
    const netOrderFlow =
      this.orderFlow?.getNetOrderFlow(instrumentId) ?? 0;
    const flowRatio = Math.max(
      -0.65,
      Math.min(
        0.65,
        netOrderFlow / Math.max(instrument.liquidity * 5, 1),
      ),
    );
    const askScale = 1 - flowRatio * 0.55;
    const bidScale = 1 + flowRatio * 0.55;
    const asks: OrderBookLevel[] = [];
    const bids: OrderBookLevel[] = [];

    for (let level = 1; level <= 5; level += 1) {
      asks.push(
        buildLevel(
          quote.currentPrice + tickSize * level,
          baseQuantity,
          instrument.lotSize,
          random,
          askScale,
        ),
      );
      bids.push(
        buildLevel(
          Math.max(0.0001, quote.currentPrice - tickSize * level),
          baseQuantity,
          instrument.lotSize,
          random,
          bidScale,
        ),
      );
    }
    const openOrders = this.repository.listOpenOrders([instrumentId]);
    const mergedAsks = mergeOrderLevels(
      asks,
      openOrders
        .filter((order) => order.side === "SELL" && order.limitPrice !== null)
        .map((order) => ({
          price: order.limitPrice!,
          quantity: order.quantity - order.filledQuantity,
        })),
      "ASC",
    );
    const mergedBids = mergeOrderLevels(
      bids,
      openOrders
        .filter((order) => order.side === "BUY" && order.limitPrice !== null)
        .map((order) => ({
          price: order.limitPrice!,
          quantity: order.quantity - order.filledQuantity,
        })),
      "DESC",
    );

    return {
      instrumentId,
      quoteCurrency: quote.quoteCurrency,
      mode: "VIRTUAL",
      asks: mergedAsks,
      bids: mergedBids,
      updatedAt: quote.updatedAt,
    };
  }
}

function mergeOrderLevels(
  generated: OrderBookLevel[],
  pending: Array<{ price: number; quantity: number }>,
  direction: "ASC" | "DESC",
): OrderBookLevel[] {
  const levels = new Map<number, OrderBookLevel>();
  for (const level of generated) {
    levels.set(level.price, { ...level });
  }
  for (const order of pending) {
    const price = roundUnitPrice(order.price);
    const existing = levels.get(price);
    levels.set(price, {
      price,
      quantity: (existing?.quantity ?? 0) + order.quantity,
      orderCount: (existing?.orderCount ?? 0) + 1,
    });
  }
  return [...levels.values()]
    .sort((left, right) =>
      direction === "ASC"
        ? left.price - right.price
        : right.price - left.price,
    )
    .slice(0, 5);
}

function buildLevel(
  price: number,
  baseQuantity: number,
  lotSize: number,
  random: () => number,
  scale = 1,
): OrderBookLevel {
  const quantity = Math.max(
    lotSize,
    Math.round(
      (baseQuantity * scale * (0.35 + random() * 1.65)) /
        lotSize,
    ) * lotSize,
  );

  return {
    price: roundUnitPrice(price),
    quantity,
    orderCount: Math.max(1, Math.round(2 + random() * 28)),
  };
}

function seededRandom(seedText: string): () => number {
  let state = 2_166_136_261;

  for (let index = 0; index < seedText.length; index += 1) {
    state ^= seedText.charCodeAt(index);
    state = Math.imul(state, 16_777_619);
  }

  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}
