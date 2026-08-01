import type { PGlite } from "@electric-sql/pglite";

const REAL_MARKET_SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS real_instruments (
  id TEXT PRIMARY KEY,
  provider_sec_id TEXT NOT NULL UNIQUE,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  market TEXT NOT NULL CHECK (market IN ('CN', 'HK', 'US', 'UK')),
  source_currency TEXT NOT NULL
    CHECK (source_currency IN ('CNY', 'HKD', 'USD', 'GBP')),
  quote_currency TEXT NOT NULL
    CHECK (quote_currency IN ('CNY', 'USD')),
  exchange_code TEXT NOT NULL,
  industry TEXT NOT NULL DEFAULT '',
  lot_size INTEGER NOT NULL CHECK (lot_size > 0),
  settlement_cycle TEXT NOT NULL
    CHECK (settlement_cycle IN ('T0', 'T1')),
  is_tradable BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  source_page INTEGER NOT NULL CHECK (source_page > 0),
  source_rank INTEGER NOT NULL CHECK (source_rank >= 0),
  last_seen_sweep_id TEXT,
  source_updated_at TIMESTAMPTZ NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS real_instruments_market_symbol_idx
  ON real_instruments (market, symbol);
CREATE INDEX IF NOT EXISTS real_instruments_source_page_idx
  ON real_instruments (market, source_page);
CREATE INDEX IF NOT EXISTS real_instruments_seen_sweep_idx
  ON real_instruments (market, last_seen_sweep_id);

CREATE TABLE IF NOT EXISTS real_quotes (
  instrument_id TEXT PRIMARY KEY
    REFERENCES real_instruments(id) ON DELETE CASCADE,
  current_price DOUBLE PRECISION NOT NULL,
  previous_close DOUBLE PRECISION NOT NULL,
  open_price DOUBLE PRECISION NOT NULL,
  high_price DOUBLE PRECISION NOT NULL,
  low_price DOUBLE PRECISION NOT NULL,
  volume DOUBLE PRECISION NOT NULL,
  amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  change_amount DOUBLE PRECISION NOT NULL,
  change_percent DOUBLE PRECISION NOT NULL,
  raw_current_price DOUBLE PRECISION NOT NULL,
  raw_previous_close DOUBLE PRECISION NOT NULL,
  raw_open_price DOUBLE PRECISION NOT NULL,
  raw_high_price DOUBLE PRECISION NOT NULL,
  raw_low_price DOUBLE PRECISION NOT NULL,
  source_updated_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS real_quotes_received_at_idx
  ON real_quotes (received_at);

CREATE TABLE IF NOT EXISTS real_candles (
  instrument_id TEXT NOT NULL
    REFERENCES real_instruments(id) ON DELETE CASCADE,
  interval TEXT NOT NULL
    CHECK (interval IN ('MINUTE', 'DAY', 'MONTH', 'YEAR')),
  bucket_start TIMESTAMPTZ NOT NULL,
  open DOUBLE PRECISION NOT NULL,
  high DOUBLE PRECISION NOT NULL,
  low DOUBLE PRECISION NOT NULL,
  close DOUBLE PRECISION NOT NULL,
  volume DOUBLE PRECISION NOT NULL,
  average_price DOUBLE PRECISION,
  source TEXT NOT NULL,
  is_partial BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (instrument_id, interval, bucket_start)
);

CREATE INDEX IF NOT EXISTS real_candles_lookup_idx
  ON real_candles (instrument_id, interval, bucket_start DESC);

CREATE TABLE IF NOT EXISTS real_sync_sweeps (
  id TEXT PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  total_pages INTEGER NOT NULL DEFAULT 0,
  completed_pages INTEGER NOT NULL DEFAULT 0,
  failed_pages INTEGER NOT NULL DEFAULT 0,
  instrument_rows INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  state TEXT NOT NULL
    CHECK (state IN ('RUNNING', 'COMPLETED', 'DEGRADED'))
);

CREATE TABLE IF NOT EXISTS real_provider_pages (
  market TEXT NOT NULL CHECK (market IN ('CN', 'HK', 'US', 'UK')),
  page INTEGER NOT NULL CHECK (page > 0),
  page_size INTEGER NOT NULL CHECK (page_size > 0),
  provider_total INTEGER NOT NULL DEFAULT 0,
  row_count INTEGER NOT NULL DEFAULT 0,
  last_sweep_id TEXT,
  last_attempt_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_duration_ms INTEGER,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  PRIMARY KEY (market, page, page_size)
);

CREATE TABLE IF NOT EXISTS real_portfolios (
  id UUID PRIMARY KEY,
  account_id TEXT NOT NULL UNIQUE,
  initial_cash_usd DOUBLE PRECISION NOT NULL,
  available_cash_usd DOUBLE PRECISION NOT NULL,
  frozen_cash_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS real_positions (
  id UUID PRIMARY KEY,
  portfolio_id UUID NOT NULL
    REFERENCES real_portfolios(id) ON DELETE CASCADE,
  instrument_id TEXT NOT NULL
    REFERENCES real_instruments(id),
  quantity INTEGER NOT NULL CHECK (quantity >= 0),
  available_quantity INTEGER NOT NULL CHECK (available_quantity >= 0),
  frozen_quantity INTEGER NOT NULL CHECK (frozen_quantity >= 0),
  average_cost_usd DOUBLE PRECISION NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (portfolio_id, instrument_id)
);

CREATE TABLE IF NOT EXISTS real_transactions (
  id UUID PRIMARY KEY,
  portfolio_id UUID NOT NULL
    REFERENCES real_portfolios(id) ON DELETE CASCADE,
  instrument_id TEXT NOT NULL REFERENCES real_instruments(id),
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  market TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  quote_price DOUBLE PRECISION NOT NULL,
  quote_currency TEXT NOT NULL,
  fx_rate_to_usd DOUBLE PRECISION NOT NULL,
  price_usd DOUBLE PRECISION NOT NULL,
  gross_amount_usd DOUBLE PRECISION NOT NULL,
  fee_usd DOUBLE PRECISION NOT NULL,
  net_amount_usd DOUBLE PRECISION NOT NULL,
  realized_profit_usd DOUBLE PRECISION,
  actor_type TEXT NOT NULL DEFAULT 'USER',
  actor_id TEXT,
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS real_transactions_idempotency_idx
  ON real_transactions (portfolio_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS real_transactions_portfolio_time_idx
  ON real_transactions (portfolio_id, created_at DESC);

CREATE TABLE IF NOT EXISTS real_orders (
  id UUID PRIMARY KEY,
  portfolio_id UUID NOT NULL
    REFERENCES real_portfolios(id) ON DELETE CASCADE,
  instrument_id TEXT NOT NULL REFERENCES real_instruments(id),
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  order_mode TEXT NOT NULL CHECK (order_mode IN ('MARKET', 'LIMIT')),
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'FILLED', 'CANCELLED')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  filled_quantity INTEGER NOT NULL DEFAULT 0 CHECK (filled_quantity >= 0),
  limit_price DOUBLE PRECISION,
  quote_currency TEXT NOT NULL CHECK (quote_currency IN ('CNY', 'USD')),
  reserved_cash_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
  reserved_quantity INTEGER NOT NULL DEFAULT 0,
  actor_type TEXT NOT NULL DEFAULT 'USER' CHECK (actor_type IN ('USER', 'AI')),
  actor_id TEXT NOT NULL,
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  filled_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  transaction_id UUID REFERENCES real_transactions(id) ON DELETE SET NULL,
  CHECK (
    (order_mode = 'MARKET' AND limit_price IS NULL) OR
    (order_mode = 'LIMIT' AND limit_price IS NOT NULL AND limit_price > 0)
  ),
  CHECK (filled_quantity <= quantity)
);

CREATE UNIQUE INDEX IF NOT EXISTS real_orders_idempotency_idx
  ON real_orders (portfolio_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS real_orders_portfolio_time_idx
  ON real_orders (portfolio_id, created_at DESC);
CREATE INDEX IF NOT EXISTS real_orders_open_instrument_idx
  ON real_orders (status, instrument_id, created_at);

CREATE TABLE IF NOT EXISTS real_position_settlement_lots (
  id UUID PRIMARY KEY,
  portfolio_id UUID NOT NULL
    REFERENCES real_portfolios(id) ON DELETE CASCADE,
  instrument_id TEXT NOT NULL REFERENCES real_instruments(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unlock_at TIMESTAMPTZ NOT NULL,
  settled_at TIMESTAMPTZ,
  source_transaction_id UUID NOT NULL UNIQUE
    REFERENCES real_transactions(id)
);

CREATE INDEX IF NOT EXISTS real_settlement_due_idx
  ON real_position_settlement_lots (unlock_at)
  WHERE settled_at IS NULL;

CREATE TABLE IF NOT EXISTS real_cash_adjustments (
  id UUID PRIMARY KEY,
  portfolio_id UUID NOT NULL
    REFERENCES real_portfolios(id) ON DELETE CASCADE,
  claim_id TEXT NOT NULL UNIQUE,
  amount_usd DOUBLE PRECISION NOT NULL CHECK (amount_usd > 0),
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

const REAL_MARKET_MIGRATIONS = [
  {
    version: 2,
    sql: `
      ALTER TABLE real_candles
        ADD COLUMN IF NOT EXISTS average_price DOUBLE PRECISION;
      ALTER TABLE real_candles
        DROP CONSTRAINT IF EXISTS real_candles_interval_check;
      ALTER TABLE real_candles
        ADD CONSTRAINT real_candles_interval_check
        CHECK (interval IN ('MINUTE', 'DAY', 'MONTH', 'YEAR'));
    `,
  },
  {
    version: 3,
    sql: `
      CREATE TABLE IF NOT EXISTS real_orders (
        id UUID PRIMARY KEY,
        portfolio_id UUID NOT NULL
          REFERENCES real_portfolios(id) ON DELETE CASCADE,
        instrument_id TEXT NOT NULL REFERENCES real_instruments(id),
        side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
        order_mode TEXT NOT NULL CHECK (order_mode IN ('MARKET', 'LIMIT')),
        status TEXT NOT NULL CHECK (status IN ('OPEN', 'FILLED', 'CANCELLED')),
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        filled_quantity INTEGER NOT NULL DEFAULT 0
          CHECK (filled_quantity >= 0),
        limit_price DOUBLE PRECISION,
        quote_currency TEXT NOT NULL CHECK (quote_currency IN ('CNY', 'USD')),
        reserved_cash_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
        reserved_quantity INTEGER NOT NULL DEFAULT 0,
        actor_type TEXT NOT NULL DEFAULT 'USER'
          CHECK (actor_type IN ('USER', 'AI')),
        actor_id TEXT NOT NULL,
        idempotency_key TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        filled_at TIMESTAMPTZ,
        cancelled_at TIMESTAMPTZ,
        transaction_id UUID REFERENCES real_transactions(id) ON DELETE SET NULL,
        CHECK (
          (order_mode = 'MARKET' AND limit_price IS NULL) OR
          (order_mode = 'LIMIT' AND limit_price IS NOT NULL AND limit_price > 0)
        ),
        CHECK (filled_quantity <= quantity)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS real_orders_idempotency_idx
        ON real_orders (portfolio_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS real_orders_portfolio_time_idx
        ON real_orders (portfolio_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS real_orders_open_instrument_idx
        ON real_orders (status, instrument_id, created_at);
    `,
  },
  {
    version: 4,
    sql: `
      ALTER TABLE real_portfolios
        ADD COLUMN IF NOT EXISTS frozen_cash_usd DOUBLE PRECISION
        NOT NULL DEFAULT 0;
      ALTER TABLE real_positions
        ADD COLUMN IF NOT EXISTS frozen_quantity INTEGER
        NOT NULL DEFAULT 0 CHECK (frozen_quantity >= 0);
    `,
  },
] as const;

export async function migrateRealDatabase(
  client: PGlite,
): Promise<void> {
  await client.exec(REAL_MARKET_SCHEMA);
  await client.query(
    `INSERT INTO schema_migrations (version)
     VALUES (1)
     ON CONFLICT (version) DO NOTHING`,
  );

  for (const migration of REAL_MARKET_MIGRATIONS) {
    await client.transaction(async (transaction) => {
      const applied = await transaction.query<{ version: number }>(
        `SELECT version FROM schema_migrations WHERE version = $1`,
        [migration.version],
      );
      if (applied.rows.length > 0) {
        return;
      }

      await transaction.exec(migration.sql);
      await transaction.query(
        `INSERT INTO schema_migrations (version) VALUES ($1)`,
        [migration.version],
      );
    });
  }
}
