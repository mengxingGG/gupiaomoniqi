import { createHash, randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import {
  instruments,
  marketImportBatches,
  quotes,
} from "./schema.js";
import {
  openDatabase,
  type DatabaseConnection,
} from "./client.js";
import { IMPORT_FX_RATES } from "./constants.js";
import { migrateDatabase } from "./migrations.js";

type Market = "CN" | "HK" | "US" | "UK";
type SourceCurrency = "CNY" | "HKD" | "USD" | "GBP";
type SettlementCurrency = "CNY" | "USD";

interface SnapshotInstrument {
  id: string;
  symbol: string;
  name: string;
  market: Market;
  currency: SourceCurrency;
  industry: string;
  sourceMarketCode: number | null;
  sourceSecid: string;
  sourcePriceUnit: string;
  sourceInitialPrice: number | null;
  initialPrice: number;
  previousClose: number;
  volume: number;
  turnover: number;
  totalMarketCap: number | null;
  circulatingMarketCap: number | null;
}

interface MarketSeedSnapshot {
  schemaVersion: number;
  source: string;
  sourceHost: string;
  fetchedAt: string;
  selection: string;
  requestedPerMarket: number;
  markets: Record<Market, { count: number }>;
  instruments: SnapshotInstrument[];
}

const EXPECTED_MARKETS: Market[] = ["CN", "HK", "US", "UK"];
const MARKET_RULES: Record<
  Market,
  {
    quoteCurrency: SettlementCurrency;
    conversionRate: number;
    lotSize: number;
    settlementCycle: "T0" | "T1";
    volatility: number;
  }
> = {
  CN: {
    quoteCurrency: "CNY",
    conversionRate: 1,
    lotSize: 100,
    settlementCycle: "T1",
    volatility: 0.0018,
  },
  HK: {
    quoteCurrency: "CNY",
    conversionRate: IMPORT_FX_RATES.HKD_CNY,
    lotSize: 100,
    settlementCycle: "T0",
    volatility: 0.002,
  },
  US: {
    quoteCurrency: "USD",
    conversionRate: 1,
    lotSize: 1,
    settlementCycle: "T0",
    volatility: 0.0017,
  },
  UK: {
    quoteCurrency: "USD",
    conversionRate: IMPORT_FX_RATES.GBP_USD,
    lotSize: 1,
    settlementCycle: "T0",
    volatility: 0.0016,
  },
};

export function getDefaultMarketSeedPath(): string {
  return fileURLToPath(new URL("../../data/market-seeds.json", import.meta.url));
}

export async function importMarketSeeds(
  snapshotPath = process.env.MARKET_SEED_PATH ?? getDefaultMarketSeedPath(),
  options: {
    deleteSnapshotAfterImport?: boolean;
    databaseConnection?: DatabaseConnection;
    expectedPerMarket?: number;
  } = {},
): Promise<{
  batchId: string;
  snapshotPath: string;
  instrumentCount: number;
  requestedPerMarket: number;
}> {
  const snapshotBytes = await readFile(snapshotPath);
  const snapshot = JSON.parse(snapshotBytes.toString("utf8")) as MarketSeedSnapshot;
  const marketCounts = validateSnapshot(
    snapshot,
    options.expectedPerMarket,
  );
  const snapshotSha256 = createHash("sha256")
    .update(snapshotBytes)
    .digest("hex");
  const batchId = randomUUID();
  const importedAt = new Date();
  const connection =
    options.databaseConnection ?? (await openDatabase());
  const { client, db } = connection;
  const ownsConnection = !options.databaseConnection;
  let verified = false;

  try {
    await migrateDatabase(client);

    await db.transaction(async (transaction) => {
      await transaction.insert(marketImportBatches).values({
        id: batchId,
        source: snapshot.source,
        sourceHost: snapshot.sourceHost,
        sourceFetchedAt: new Date(snapshot.fetchedAt),
        importedAt,
        selection: snapshot.selection,
        requestedPerMarket: snapshot.requestedPerMarket,
        instrumentCount: snapshot.instruments.length,
        marketCounts,
        fxRates: {
          asOf: IMPORT_FX_RATES.asOf,
          source: IMPORT_FX_RATES.source,
          HKD_CNY: IMPORT_FX_RATES.HKD_CNY,
          GBP_USD: IMPORT_FX_RATES.GBP_USD,
        },
        snapshotSha256,
      });

      for (const chunk of chunked(snapshot.instruments, 100)) {
        const instrumentRows = chunk.map((instrument) => {
          const rules = MARKET_RULES[instrument.market];

          return {
            id: instrument.id,
            symbol: instrument.symbol,
            name: instrument.name,
            market: instrument.market,
            type: "STOCK_VIRTUAL",
            industry: instrument.industry,
            sourceCurrency: instrument.currency,
            quoteCurrency: rules.quoteCurrency,
            sourceMarketCode: instrument.sourceMarketCode,
            sourceSecid: instrument.sourceSecid,
            sourcePriceUnit: instrument.sourcePriceUnit,
            sourceInitialPrice:
              instrument.sourceInitialPrice ?? instrument.initialPrice,
            sourcePreviousClose: instrument.previousClose,
            initialPrice: convertPrice(
              instrument.initialPrice,
              rules.conversionRate,
            ),
            lotSize: rules.lotSize,
            settlementCycle: rules.settlementCycle,
            volatility: rules.volatility,
            liquidity: calculateLiquidity(instrument.volume),
            sourceVolume: Math.max(0, Math.round(instrument.volume)),
            sourceTurnover: Math.max(0, instrument.turnover),
            totalMarketCap: instrument.totalMarketCap,
            circulatingMarketCap: instrument.circulatingMarketCap,
            isTradable: true,
            importBatchId: batchId,
            updatedAt: importedAt,
          };
        });

        await transaction
          .insert(instruments)
          .values(instrumentRows)
          .onConflictDoUpdate({
            target: instruments.id,
            set: {
              symbol: sql`excluded.symbol`,
              name: sql`excluded.name`,
              market: sql`excluded.market`,
              type: sql`excluded.type`,
              industry: sql`excluded.industry`,
              sourceCurrency: sql`excluded.source_currency`,
              quoteCurrency: sql`excluded.settlement_currency`,
              sourceMarketCode: sql`excluded.source_market_code`,
              sourceSecid: sql`excluded.source_secid`,
              sourcePriceUnit: sql`excluded.source_price_unit`,
              sourceInitialPrice: sql`excluded.source_initial_price`,
              sourcePreviousClose: sql`excluded.source_previous_close`,
              initialPrice: sql`excluded.initial_price`,
              lotSize: sql`excluded.lot_size`,
              settlementCycle: sql`excluded.settlement_cycle`,
              volatility: sql`excluded.volatility`,
              liquidity: sql`excluded.liquidity`,
              sourceVolume: sql`excluded.source_volume`,
              sourceTurnover: sql`excluded.source_turnover`,
              totalMarketCap: sql`excluded.total_market_cap`,
              circulatingMarketCap: sql`excluded.circulating_market_cap`,
              isTradable: sql`excluded.is_tradable`,
              importBatchId: sql`excluded.import_batch_id`,
              updatedAt: sql`excluded.updated_at`,
            },
          });

        const quoteRows = instrumentRows.map((instrument) => ({
          instrumentId: instrument.id,
          currentPrice: instrument.initialPrice,
          previousClose: instrument.initialPrice,
          openPrice: instrument.initialPrice,
          highPrice: instrument.initialPrice,
          lowPrice: instrument.initialPrice,
          volume: 0,
          changeAmount: 0,
          changePercent: 0,
          updatedAt: importedAt,
        }));

        await transaction
          .insert(quotes)
          .values(quoteRows)
          .onConflictDoUpdate({
            target: quotes.instrumentId,
            set: {
              currentPrice: sql`excluded.current_price`,
              previousClose: sql`excluded.previous_close`,
              openPrice: sql`excluded.open_price`,
              highPrice: sql`excluded.high_price`,
              lowPrice: sql`excluded.low_price`,
              volume: sql`excluded.volume`,
              changeAmount: sql`excluded.change_amount`,
              changePercent: sql`excluded.change_percent`,
              updatedAt: sql`excluded.updated_at`,
            },
          });
      }
    });

    const countResult = await client.query<{
      market: Market;
      count: number;
    }>(
      `SELECT market, count(*)::int AS count
         FROM instruments
        WHERE import_batch_id = $1
        GROUP BY market
        ORDER BY market`,
      [batchId],
    );
    const verifiedCounts = Object.fromEntries(
      countResult.rows.map((row) => [row.market, row.count]),
    ) as Partial<Record<Market, number>>;

    for (const market of EXPECTED_MARKETS) {
      if (verifiedCounts[market] !== snapshot.requestedPerMarket) {
        throw new Error(
          `数据库复核失败：${market}=${verifiedCounts[market] ?? 0}，预期 ${snapshot.requestedPerMarket}`,
        );
      }
    }

    const quoteCount = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM quotes q
         JOIN instruments i ON i.id = q.instrument_id
        WHERE i.import_batch_id = $1`,
      [batchId],
    );

    if (quoteCount.rows[0]?.count !== snapshot.instruments.length) {
      throw new Error(
        `数据库复核失败：quotes=${quoteCount.rows[0]?.count ?? 0}，预期 ${snapshot.instruments.length}`,
      );
    }

    verified = true;
    console.log(
      `数据库导入完成：批次 ${batchId}，CN/HK/US/UK 各 ${snapshot.requestedPerMarket} 只，共 ${snapshot.instruments.length} 只`,
    );
  } finally {
    if (ownsConnection) {
      await client.close();
    }
  }

  if (verified) {
    const deleteSnapshotAfterImport =
      options.deleteSnapshotAfterImport ??
      process.env.DELETE_IMPORTED_MARKET_SEED === "true";
    if (deleteSnapshotAfterImport) {
      try {
        await rm(snapshotPath);
        console.log(`数据库复核成功，已删除临时快照：${snapshotPath}`);
      } catch (error) {
        console.warn(
          `数据库已复核成功，但临时快照删除失败：${snapshotPath}（${errorMessage(error)}）`,
        );
      }
    } else {
      console.log(`数据库复核成功，保留快照文件：${snapshotPath}`);
    }
  }

  return {
    batchId,
    snapshotPath,
    instrumentCount: snapshot.instruments.length,
    requestedPerMarket: snapshot.requestedPerMarket,
  };
}

function validateSnapshot(
  value: MarketSeedSnapshot,
  expectedPerMarket?: number,
): Record<Market, number> {
  if (
    value.schemaVersion !== 1 ||
    !Number.isSafeInteger(value.requestedPerMarket) ||
    value.requestedPerMarket <= 0 ||
    !Array.isArray(value.instruments)
  ) {
    throw new Error("快照格式无效");
  }
  if (
    expectedPerMarket !== undefined &&
    value.requestedPerMarket !== expectedPerMarket
  ) {
    throw new Error(
      `快照数量不符合初始化要求：每个市场 ${value.requestedPerMarket} 只，预期 ${expectedPerMarket} 只`,
    );
  }

  const ids = new Set<string>();
  const keys = new Set<string>();
  const counts = Object.fromEntries(
    EXPECTED_MARKETS.map((market) => [market, 0]),
  ) as Record<Market, number>;

  for (const instrument of value.instruments) {
    if (!EXPECTED_MARKETS.includes(instrument.market)) {
      throw new Error(`未知市场：${instrument.market}`);
    }

    if (
      !instrument.id ||
      !instrument.symbol ||
      !instrument.name ||
      !Number.isFinite(instrument.initialPrice) ||
      instrument.initialPrice <= 0
    ) {
      throw new Error(`股票记录无效：${JSON.stringify(instrument).slice(0, 200)}`);
    }

    const key = `${instrument.market}:${instrument.symbol}`;

    if (ids.has(instrument.id) || keys.has(key)) {
      throw new Error(`股票记录重复：${instrument.id} / ${key}`);
    }

    ids.add(instrument.id);
    keys.add(key);
    counts[instrument.market] += 1;
  }

  for (const market of EXPECTED_MARKETS) {
    if (counts[market] !== value.requestedPerMarket) {
      throw new Error(
        `快照校验失败：${market}=${counts[market]}，预期 ${value.requestedPerMarket}`,
      );
    }
  }

  return counts;
}

function convertPrice(price: number, rate: number): number {
  return Math.round((price * rate + Number.EPSILON) * 10_000) / 10_000;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function calculateLiquidity(volume: number): number {
  return Math.max(
    800,
    Math.min(
      40_000,
      Math.round(Math.sqrt(Math.max(volume, 100)) * 20),
    ),
  );
}

function chunked<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await importMarketSeeds();
}
