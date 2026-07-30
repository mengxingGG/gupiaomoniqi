import { getDatabaseDirectory, openDatabase } from "./client.js";
import { migrateDatabase } from "./migrations.js";

const { client } = await openDatabase();

try {
  await migrateDatabase(client);

  const counts = await client.query<{
    market: string;
    settlement_currency: string;
    settlement_cycle: string;
    count: number;
  }>(
    `SELECT market, settlement_currency, settlement_cycle,
            count(*)::int AS count
       FROM instruments
      GROUP BY market, settlement_currency, settlement_cycle
      ORDER BY market`,
  );
  const accounts = await client.query<{
    account_count: number;
    portfolio_count: number;
    initial_cash_usd: number;
    available_cash_usd: number;
  }>(
    `SELECT
       (SELECT count(*)::int FROM accounts) AS account_count,
       count(*)::int AS portfolio_count,
       COALESCE(sum(initial_cash_usd), 0)::float8 AS initial_cash_usd,
       COALESCE(sum(available_cash_usd), 0)::float8 AS available_cash_usd
       FROM portfolios
      WHERE account_id IS NOT NULL`,
  );
  const batches = await client.query<{
    id: string;
    source_fetched_at: string;
    imported_at: string;
    instrument_count: number;
    snapshot_sha256: string;
  }>(
    `SELECT id, source_fetched_at, imported_at, instrument_count,
            snapshot_sha256
       FROM market_import_batches
      ORDER BY imported_at DESC
      LIMIT 3`,
  );
  const ai = await client.query<{
    trader_count: number;
    ai_position_count: number;
    ai_transaction_count: number;
    pending_settlement_lot_count: number;
  }>(
    `SELECT
       (SELECT count(*)::int FROM ai_traders) AS trader_count,
       (SELECT count(*)::int
          FROM positions p
         WHERE EXISTS (
           SELECT 1
             FROM ai_traders a
            WHERE a.portfolio_id = p.portfolio_id
         )) AS ai_position_count,
       (SELECT count(*)::int
          FROM transactions
         WHERE actor_type = 'AI') AS ai_transaction_count,
       (SELECT count(*)::int
          FROM position_settlement_lots
         WHERE settled_at IS NULL) AS pending_settlement_lot_count`,
  );
  const history = await client.query<{
    interval: string;
    source: string;
    candle_count: number;
    instrument_count: number;
    earliest: string;
    latest: string;
  }>(
    `SELECT interval, source,
            count(*)::int AS candle_count,
            count(DISTINCT instrument_id)::int AS instrument_count,
            min(bucket_start)::text AS earliest,
            max(bucket_start)::text AS latest
       FROM candles
      GROUP BY interval, source
      ORDER BY interval, source`,
  );

  console.log(
    JSON.stringify(
      {
        databaseDirectory: getDatabaseDirectory(),
        counts: counts.rows,
        accountLedger: accounts.rows[0],
        aiTrading: ai.rows[0],
        marketHistory: history.rows,
        latestBatches: batches.rows,
      },
      null,
      2,
    ),
  );
} finally {
  await client.close();
}
