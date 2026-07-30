import { getRealDatabaseDirectory, openRealDatabase } from "./client.js";
import { migrateRealDatabase } from "./migrations.js";

const { client } = await openRealDatabase();

try {
  await migrateRealDatabase(client);

  const counts = await client.query<{
    instrument_count: number;
    quote_count: number;
    minute_candle_count: number;
    day_candle_count: number;
  }>(
    `SELECT
       (SELECT count(*)::int FROM real_instruments) AS instrument_count,
       (SELECT count(*)::int FROM real_quotes) AS quote_count,
       (SELECT count(*)::int
          FROM real_candles
         WHERE interval = 'MINUTE') AS minute_candle_count,
       (SELECT count(*)::int
          FROM real_candles
         WHERE interval = 'DAY') AS day_candle_count`,
  );

  console.log(
    JSON.stringify(
      {
        databaseDirectory: getRealDatabaseDirectory(),
        realMarket: counts.rows[0],
      },
      null,
      2,
    ),
  );
} finally {
  await client.close();
}
