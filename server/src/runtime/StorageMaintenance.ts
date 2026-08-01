import type { PGlite } from "@electric-sql/pglite";

const VIRTUAL_MINUTE_RETENTION_DAYS = 3;
const AI_TRANSACTION_RETENTION_DAYS = 30;
const SETTLED_LOT_RETENTION_DAYS = 7;
const IMPORT_BATCH_RETENTION_DAYS = 14;
const REAL_SWEEP_RETENTION_DAYS = 14;
const REAL_MINUTE_CANDLE_LIMIT = 390;
const REAL_DAY_CANDLE_LIMIT = 800;

export interface StorageMaintenanceResult {
  virtual?: {
    deletedExpiredSessions: number;
    deletedOldAiTransactions: number;
    deletedOldMinuteCandles: number;
    deletedSettledLots: number;
    deletedOldImportBatches: number;
    vacuumed: boolean;
    checkpointed: boolean;
  };
  real?: {
    deletedMinuteCandles: number;
    deletedDayCandles: number;
    deletedSettledLots: number;
    deletedOldSyncSweeps: number;
    vacuumed: boolean;
    checkpointed: boolean;
  };
}

export async function runStorageMaintenance(input: {
  virtualClient?: PGlite;
  realClient?: PGlite;
  now?: Date;
  deep?: boolean;
}): Promise<StorageMaintenanceResult> {
  const now = input.now ?? new Date();
  const deep = input.deep ?? false;
  const result: StorageMaintenanceResult = {};

  if (input.virtualClient) {
    result.virtual = await pruneVirtualStorage(input.virtualClient, now, deep);
  }
  if (input.realClient) {
    result.real = await pruneRealStorage(input.realClient, now, deep);
  }

  return result;
}

async function pruneVirtualStorage(
  client: PGlite,
  now: Date,
  deep = false,
): Promise<NonNullable<StorageMaintenanceResult["virtual"]>> {
  const result = {
    deletedExpiredSessions: await deleteCount(
      client,
      `DELETE FROM sessions
        WHERE expires_at < $1`,
      [toIso(now)],
    ),
    deletedSettledLots: await deleteCount(
      client,
      `DELETE FROM position_settlement_lots
        WHERE settled_at IS NOT NULL
          AND settled_at < $1`,
      [toIso(addDays(now, -SETTLED_LOT_RETENTION_DAYS))],
    ),
    deletedOldAiTransactions: await deleteCount(
      client,
      `DELETE FROM transactions
        WHERE actor_type = 'AI'
          AND created_at < $1
          AND EXISTS (
            SELECT 1
              FROM portfolios
             WHERE portfolios.id = transactions.portfolio_id
               AND portfolios.account_id IS NULL
          )`,
      [toIso(addDays(now, -AI_TRANSACTION_RETENTION_DAYS))],
    ),
    deletedOldMinuteCandles: await deleteCount(
      client,
      `DELETE FROM candles
        WHERE interval = 'MINUTE'
          AND bucket_start < $1`,
      [toIso(addDays(now, -VIRTUAL_MINUTE_RETENTION_DAYS))],
    ),
    deletedOldImportBatches: await deleteCount(
      client,
      `DELETE FROM market_import_batches
        WHERE imported_at < $1
          AND NOT EXISTS (
            SELECT 1
              FROM instruments
             WHERE instruments.import_batch_id = market_import_batches.id
          )`,
      [toIso(addDays(now, -IMPORT_BATCH_RETENTION_DAYS))],
    ),
    vacuumed: false,
    checkpointed: false,
  };
  const compacted = await compactDatabase(client, deep);
  result.vacuumed = compacted.vacuumed;
  result.checkpointed = compacted.checkpointed;
  return result;
}

async function pruneRealStorage(
  client: PGlite,
  now: Date,
  deep = false,
): Promise<NonNullable<StorageMaintenanceResult["real"]>> {
  const result = {
    deletedMinuteCandles: await trimRealCandles(
      client,
      "MINUTE",
      REAL_MINUTE_CANDLE_LIMIT,
    ),
    deletedDayCandles: await trimRealCandles(
      client,
      "DAY",
      REAL_DAY_CANDLE_LIMIT,
    ),
    deletedSettledLots: await deleteCount(
      client,
      `DELETE FROM real_position_settlement_lots
        WHERE settled_at IS NOT NULL
          AND settled_at < $1`,
      [toIso(addDays(now, -SETTLED_LOT_RETENTION_DAYS))],
    ),
    deletedOldSyncSweeps: await deleteCount(
      client,
      `DELETE FROM real_sync_sweeps
        WHERE state IN ('COMPLETED', 'DEGRADED')
          AND started_at < $1`,
      [toIso(addDays(now, -REAL_SWEEP_RETENTION_DAYS))],
    ),
    vacuumed: false,
    checkpointed: false,
  };
  const compacted = await compactDatabase(client, deep);
  result.vacuumed = compacted.vacuumed;
  result.checkpointed = compacted.checkpointed;
  return result;
}

async function trimRealCandles(
  client: PGlite,
  interval: "MINUTE" | "DAY",
  limit: number,
): Promise<number> {
  return deleteCount(
    client,
    `WITH ranked AS (
       SELECT instrument_id, interval, bucket_start,
              row_number() OVER (
                PARTITION BY instrument_id, interval
                ORDER BY bucket_start DESC
              ) AS rn
         FROM real_candles
        WHERE interval = $1
     )
     DELETE FROM real_candles
      WHERE EXISTS (
        SELECT 1
          FROM ranked
         WHERE ranked.instrument_id = real_candles.instrument_id
           AND ranked.interval = real_candles.interval
           AND ranked.bucket_start = real_candles.bucket_start
           AND ranked.rn > $2
      )`,
    [interval, limit],
  );
}

async function deleteCount(
  client: PGlite,
  sql: string,
  params: readonly unknown[],
): Promise<number> {
  const result = await client.query<{ deleted_count: number }>(
    `${sql} RETURNING 1`,
    [...params],
  );
  return result.rows.length;
}

async function compactDatabase(client: PGlite, deep = false): Promise<{
  vacuumed: boolean;
  checkpointed: boolean;
}> {
  let vacuumed = false;
  let checkpointed = false;

  try {
    await client.exec(deep ? "VACUUM FULL" : "VACUUM");
    vacuumed = true;
  } catch {
    // VACUUM FULL can fail if disk space is low; fall back to plain VACUUM
    if (deep) {
      try {
        await client.exec("VACUUM");
        vacuumed = true;
      } catch {
        vacuumed = false;
      }
    } else {
      vacuumed = false;
    }
  }

  try {
    await client.exec("CHECKPOINT");
    checkpointed = true;
  } catch {
    checkpointed = false;
  }

  return {
    vacuumed,
    checkpointed,
  };
}

function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function toIso(value: Date): string {
  return value.toISOString();
}
