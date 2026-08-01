import type { PGlite } from "@electric-sql/pglite";

const INITIAL_SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY,
  username text NOT NULL,
  username_normalized text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  display_currency text NOT NULL DEFAULT 'USD'
    CHECK (display_currency IN ('CNY', 'USD')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_account_index
  ON sessions (account_id);

CREATE TABLE IF NOT EXISTS market_import_batches (
  id uuid PRIMARY KEY,
  source text NOT NULL,
  source_host text NOT NULL,
  source_fetched_at timestamptz NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  selection text NOT NULL,
  requested_per_market integer NOT NULL,
  instrument_count integer NOT NULL,
  market_counts jsonb NOT NULL,
  fx_rates jsonb NOT NULL,
  snapshot_sha256 text NOT NULL
);

CREATE TABLE IF NOT EXISTS instruments (
  id text PRIMARY KEY,
  symbol text NOT NULL,
  name text NOT NULL,
  market text NOT NULL CHECK (market IN ('CN', 'HK', 'US', 'UK')),
  type text NOT NULL DEFAULT 'STOCK_VIRTUAL',
  industry text NOT NULL,
  source_currency text NOT NULL CHECK (source_currency IN ('CNY', 'HKD', 'USD', 'GBP')),
  settlement_currency text NOT NULL CHECK (settlement_currency IN ('CNY', 'USD')),
  source_market_code integer,
  source_secid text NOT NULL,
  source_price_unit text NOT NULL,
  source_initial_price numeric(24, 4) NOT NULL,
  source_previous_close numeric(24, 4) NOT NULL,
  initial_price numeric(24, 4) NOT NULL,
  lot_size integer NOT NULL CHECK (lot_size > 0),
  settlement_cycle text NOT NULL DEFAULT 'T0'
    CHECK (settlement_cycle IN ('T0', 'T1')),
  volatility numeric(10, 8) NOT NULL,
  liquidity integer NOT NULL,
  source_volume bigint NOT NULL DEFAULT 0,
  source_turnover numeric(28, 2) NOT NULL DEFAULT 0,
  total_market_cap numeric(28, 2),
  circulating_market_cap numeric(28, 2),
  is_tradable boolean NOT NULL DEFAULT true,
  import_batch_id uuid NOT NULL REFERENCES market_import_batches(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (market, symbol)
);

CREATE INDEX IF NOT EXISTS instruments_market_index
  ON instruments (market);
CREATE INDEX IF NOT EXISTS instruments_settlement_currency_index
  ON instruments (settlement_currency);

CREATE TABLE IF NOT EXISTS quotes (
  instrument_id text PRIMARY KEY REFERENCES instruments(id) ON DELETE CASCADE,
  current_price numeric(24, 4) NOT NULL,
  previous_close numeric(24, 4) NOT NULL,
  open_price numeric(24, 4) NOT NULL,
  high_price numeric(24, 4) NOT NULL,
  low_price numeric(24, 4) NOT NULL,
  volume bigint NOT NULL DEFAULT 0,
  change_amount numeric(24, 4) NOT NULL DEFAULT 0,
  change_percent numeric(12, 6) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS candles (
  instrument_id text NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  interval text NOT NULL CHECK (interval IN ('MINUTE', 'DAY')),
  bucket_start timestamptz NOT NULL,
  open numeric(24, 4) NOT NULL,
  high numeric(24, 4) NOT NULL,
  low numeric(24, 4) NOT NULL,
  close numeric(24, 4) NOT NULL,
  volume bigint NOT NULL DEFAULT 0,
  source text NOT NULL,
  is_partial boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT candles_primary_key
    PRIMARY KEY (instrument_id, interval, bucket_start)
);

CREATE INDEX IF NOT EXISTS candles_instrument_interval_time_index
  ON candles (instrument_id, interval, bucket_start);

CREATE TABLE IF NOT EXISTS portfolios (
  id uuid PRIMARY KEY,
  account_id uuid REFERENCES accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  mode text NOT NULL DEFAULT 'VIRTUAL',
  active_currency text NOT NULL DEFAULT 'CNY'
    CHECK (active_currency IN ('CNY', 'USD')),
  initial_cash_usd numeric(24, 2) NOT NULL DEFAULT 0,
  available_cash_usd numeric(24, 2) NOT NULL DEFAULT 0,
  frozen_cash_usd numeric(24, 2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS portfolio_balances (
  portfolio_id uuid NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  currency text NOT NULL CHECK (currency IN ('CNY', 'USD')),
  initial_cash numeric(24, 2) NOT NULL,
  cash numeric(24, 2) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT portfolio_balances_primary_key PRIMARY KEY (portfolio_id, currency)
);

CREATE TABLE IF NOT EXISTS ai_traders (
  id uuid PRIMARY KEY,
  portfolio_id uuid NOT NULL UNIQUE
    REFERENCES portfolios(id) ON DELETE CASCADE,
  name text NOT NULL,
  strategy text NOT NULL,
  psychology text NOT NULL,
  risk_level integer NOT NULL CHECK (risk_level BETWEEN 1 AND 10),
  activity_level integer NOT NULL CHECK (activity_level BETWEEN 1 AND 10),
  preferred_market text NOT NULL
    CHECK (preferred_market IN ('CN', 'HK', 'US', 'UK')),
  trader_kind text NOT NULL DEFAULT 'RULE'
    CHECK (trader_kind IN ('RULE', 'LLM')),
  persona_key text,
  is_active boolean NOT NULL DEFAULT true,
  last_action_at timestamptz,
  next_action_at timestamptz NOT NULL,
  total_trades integer NOT NULL DEFAULT 0,
  win_count integer NOT NULL DEFAULT 0,
  loss_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_traders_next_action_index
  ON ai_traders (is_active, next_action_at);
CREATE UNIQUE INDEX IF NOT EXISTS ai_traders_persona_key_unique
  ON ai_traders (persona_key)
  WHERE persona_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS ai_trader_decisions (
  id uuid PRIMARY KEY,
  trader_id uuid NOT NULL REFERENCES ai_traders(id) ON DELETE CASCADE,
  decided_at timestamptz NOT NULL,
  action text NOT NULL,
  instrument_id text,
  result text NOT NULL,
  reason text,
  model_id text NOT NULL,
  detail text
);
CREATE INDEX IF NOT EXISTS ai_trader_decisions_trader_time_index
  ON ai_trader_decisions (trader_id, decided_at DESC);

CREATE TABLE IF NOT EXISTS positions (
  id uuid PRIMARY KEY,
  portfolio_id uuid NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  instrument_id text NOT NULL REFERENCES instruments(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  available_quantity integer NOT NULL CHECK (available_quantity >= 0),
  frozen_quantity integer NOT NULL DEFAULT 0 CHECK (frozen_quantity >= 0),
  average_cost numeric(24, 4) NOT NULL,
  average_cost_usd numeric(24, 4) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (portfolio_id, instrument_id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id uuid PRIMARY KEY,
  portfolio_id uuid NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  instrument_id text NOT NULL REFERENCES instruments(id),
  currency text NOT NULL CHECK (currency IN ('CNY', 'USD')),
  side text NOT NULL CHECK (side IN ('BUY', 'SELL')),
  quantity integer NOT NULL CHECK (quantity > 0),
  price numeric(24, 4) NOT NULL,
  gross_amount numeric(24, 2) NOT NULL,
  fee numeric(24, 2) NOT NULL,
  net_amount numeric(24, 2) NOT NULL,
  realized_profit numeric(24, 2),
  quote_price numeric(24, 4),
  quote_currency text CHECK (quote_currency IN ('CNY', 'USD')),
  fx_rate_to_usd numeric(18, 10),
  price_usd numeric(24, 4),
  gross_amount_usd numeric(24, 2),
  fee_usd numeric(24, 2),
  net_amount_usd numeric(24, 2),
  realized_profit_usd numeric(24, 2),
  actor_type text NOT NULL DEFAULT 'USER'
    CHECK (actor_type IN ('USER', 'AI')),
  actor_id text,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS transactions_portfolio_created_index
  ON transactions (portfolio_id, created_at DESC);

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY,
  portfolio_id uuid NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  instrument_id text NOT NULL REFERENCES instruments(id),
  side text NOT NULL CHECK (side IN ('BUY', 'SELL')),
  order_mode text NOT NULL CHECK (order_mode IN ('MARKET', 'LIMIT')),
  status text NOT NULL CHECK (status IN ('OPEN', 'FILLED', 'CANCELLED')),
  quantity integer NOT NULL CHECK (quantity > 0),
  filled_quantity integer NOT NULL DEFAULT 0 CHECK (filled_quantity >= 0),
  limit_price numeric(24, 4),
  quote_currency text NOT NULL CHECK (quote_currency IN ('CNY', 'USD')),
  reserved_cash_usd numeric(24, 2) NOT NULL DEFAULT 0,
  reserved_quantity integer NOT NULL DEFAULT 0,
  actor_type text NOT NULL DEFAULT 'USER' CHECK (actor_type IN ('USER', 'AI')),
  actor_id text NOT NULL,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  filled_at timestamptz,
  cancelled_at timestamptz,
  transaction_id uuid REFERENCES transactions(id) ON DELETE SET NULL,
  CHECK (
    (order_mode = 'MARKET' AND limit_price IS NULL) OR
    (order_mode = 'LIMIT' AND limit_price IS NOT NULL AND limit_price > 0)
  ),
  CHECK (filled_quantity <= quantity)
);

CREATE INDEX IF NOT EXISTS orders_portfolio_created_index
  ON orders (portfolio_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_open_instrument_index
  ON orders (status, instrument_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS orders_portfolio_idempotency_unique
  ON orders (portfolio_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS position_settlement_lots (
  id uuid PRIMARY KEY,
  portfolio_id uuid NOT NULL
    REFERENCES portfolios(id) ON DELETE CASCADE,
  instrument_id text NOT NULL REFERENCES instruments(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  unlock_at timestamptz NOT NULL,
  settled_at timestamptz,
  source_transaction_id uuid UNIQUE
    REFERENCES transactions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS position_settlement_due_index
  ON position_settlement_lots (settled_at, unlock_at);
CREATE INDEX IF NOT EXISTS position_settlement_position_index
  ON position_settlement_lots (portfolio_id, instrument_id);
`;

const ACCOUNT_LEDGER_MIGRATION = [
  `CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY,
  username text NOT NULL,
  username_normalized text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  display_currency text NOT NULL DEFAULT 'USD'
    CHECK (display_currency IN ('CNY', 'USD')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
)`,
  `CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
)`,
  `CREATE INDEX IF NOT EXISTS sessions_account_index
  ON sessions (account_id)`,
  `ALTER TABLE portfolios
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES accounts(id) ON DELETE CASCADE`,
  `ALTER TABLE portfolios
  ADD COLUMN IF NOT EXISTS initial_cash_usd numeric(24, 2) NOT NULL DEFAULT 0`,
  `ALTER TABLE portfolios
  ADD COLUMN IF NOT EXISTS available_cash_usd numeric(24, 2) NOT NULL DEFAULT 0`,
  `ALTER TABLE portfolios
  ADD COLUMN IF NOT EXISTS frozen_cash_usd numeric(24, 2) NOT NULL DEFAULT 0`,
  `CREATE UNIQUE INDEX IF NOT EXISTS portfolios_account_unique
  ON portfolios (account_id)
  WHERE account_id IS NOT NULL`,
  `ALTER TABLE positions
  ADD COLUMN IF NOT EXISTS frozen_quantity integer NOT NULL DEFAULT 0`,
  `ALTER TABLE positions
  ADD COLUMN IF NOT EXISTS average_cost_usd numeric(24, 4) NOT NULL DEFAULT 0`,
  `ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS quote_price numeric(24, 4)`,
  `ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS quote_currency text`,
  `ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS fx_rate_to_usd numeric(18, 10)`,
  `ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS price_usd numeric(24, 4)`,
  `ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS gross_amount_usd numeric(24, 2)`,
  `ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS fee_usd numeric(24, 2)`,
  `ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS net_amount_usd numeric(24, 2)`,
  `ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS realized_profit_usd numeric(24, 2)`,
  `ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS idempotency_key text`,
  `CREATE UNIQUE INDEX IF NOT EXISTS transactions_portfolio_idempotency_unique
  ON transactions (portfolio_id, idempotency_key)`,
];

const AI_AND_SETTLEMENT_MIGRATION = [
  `ALTER TABLE instruments
  ADD COLUMN IF NOT EXISTS settlement_cycle text NOT NULL DEFAULT 'T0'`,
  `UPDATE instruments
      SET settlement_cycle = CASE WHEN market = 'CN' THEN 'T1' ELSE 'T0' END`,
  `ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS actor_type text NOT NULL DEFAULT 'USER'`,
  `ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS actor_id text`,
  `CREATE TABLE IF NOT EXISTS ai_traders (
  id uuid PRIMARY KEY,
  portfolio_id uuid NOT NULL UNIQUE
    REFERENCES portfolios(id) ON DELETE CASCADE,
  name text NOT NULL,
  strategy text NOT NULL,
  psychology text NOT NULL,
  risk_level integer NOT NULL CHECK (risk_level BETWEEN 1 AND 10),
  activity_level integer NOT NULL CHECK (activity_level BETWEEN 1 AND 10),
  preferred_market text NOT NULL
    CHECK (preferred_market IN ('CN', 'HK', 'US', 'UK')),
  is_active boolean NOT NULL DEFAULT true,
  last_action_at timestamptz,
  next_action_at timestamptz NOT NULL,
  total_trades integer NOT NULL DEFAULT 0,
  win_count integer NOT NULL DEFAULT 0,
  loss_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
)`,
  `CREATE INDEX IF NOT EXISTS ai_traders_next_action_index
  ON ai_traders (is_active, next_action_at)`,
  `CREATE TABLE IF NOT EXISTS position_settlement_lots (
  id uuid PRIMARY KEY,
  portfolio_id uuid NOT NULL
    REFERENCES portfolios(id) ON DELETE CASCADE,
  instrument_id text NOT NULL REFERENCES instruments(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  unlock_at timestamptz NOT NULL,
  settled_at timestamptz,
  source_transaction_id uuid UNIQUE
    REFERENCES transactions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
)`,
  `CREATE INDEX IF NOT EXISTS position_settlement_due_index
  ON position_settlement_lots (settled_at, unlock_at)`,
  `CREATE INDEX IF NOT EXISTS position_settlement_position_index
  ON position_settlement_lots (portfolio_id, instrument_id)`,
];

const MARKET_HISTORY_MIGRATION = [
  `CREATE TABLE IF NOT EXISTS candles (
  instrument_id text NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  interval text NOT NULL CHECK (interval IN ('MINUTE', 'DAY')),
  bucket_start timestamptz NOT NULL,
  open numeric(24, 4) NOT NULL,
  high numeric(24, 4) NOT NULL,
  low numeric(24, 4) NOT NULL,
  close numeric(24, 4) NOT NULL,
  volume bigint NOT NULL DEFAULT 0,
  source text NOT NULL,
  is_partial boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT candles_primary_key
    PRIMARY KEY (instrument_id, interval, bucket_start)
)`,
  `CREATE INDEX IF NOT EXISTS candles_instrument_interval_time_index
  ON candles (instrument_id, interval, bucket_start)`,
  `INSERT INTO candles (
     instrument_id, interval, bucket_start,
     open, high, low, close, volume,
     source, is_partial, updated_at
   )
   SELECT instrument_id,
          'MINUTE',
          date_trunc('minute', created_at),
          (array_agg(COALESCE(quote_price, price)
             ORDER BY created_at ASC))[1],
          MAX(COALESCE(quote_price, price)),
          MIN(COALESCE(quote_price, price)),
          (array_agg(COALESCE(quote_price, price)
             ORDER BY created_at DESC))[1],
          SUM(quantity),
          'TRANSACTION_BACKFILL',
          false,
          MAX(created_at)
     FROM transactions
    GROUP BY instrument_id, date_trunc('minute', created_at)
   ON CONFLICT (instrument_id, interval, bucket_start) DO NOTHING`,
  `INSERT INTO candles (
     instrument_id, interval, bucket_start,
     open, high, low, close, volume,
     source, is_partial, updated_at
   )
   SELECT instrument_id,
          'MINUTE',
          date_trunc('minute', updated_at),
          current_price,
          current_price,
          current_price,
          current_price,
          0,
          'DATABASE_SNAPSHOT',
          true,
          updated_at
     FROM quotes
   ON CONFLICT (instrument_id, interval, bucket_start) DO NOTHING`,
  `INSERT INTO candles (
     instrument_id, interval, bucket_start,
     open, high, low, close, volume,
     source, is_partial, updated_at
   )
   SELECT instrument_id,
          'DAY',
          date_trunc('day', updated_at AT TIME ZONE 'UTC')
            AT TIME ZONE 'UTC',
          open_price,
          high_price,
          low_price,
          current_price,
          volume,
          'DATABASE_SNAPSHOT',
          true,
          updated_at
     FROM quotes
   ON CONFLICT (instrument_id, interval, bucket_start) DO NOTHING`,
];

const MARKET_DAY_BACKFILL_MIGRATION = `INSERT INTO candles (
     instrument_id, interval, bucket_start,
     open, high, low, close, volume,
     source, is_partial, updated_at
   )
   SELECT instrument_id,
          'DAY',
          date_trunc('day', created_at AT TIME ZONE 'UTC')
            AT TIME ZONE 'UTC',
          (array_agg(COALESCE(quote_price, price)
             ORDER BY created_at ASC))[1],
          MAX(COALESCE(quote_price, price)),
          MIN(COALESCE(quote_price, price)),
          (array_agg(COALESCE(quote_price, price)
             ORDER BY created_at DESC))[1],
          SUM(quantity),
          'TRANSACTION_BACKFILL',
          false,
          MAX(created_at)
     FROM transactions
    GROUP BY instrument_id,
             date_trunc('day', created_at AT TIME ZONE 'UTC')
               AT TIME ZONE 'UTC'
   ON CONFLICT (instrument_id, interval, bucket_start) DO NOTHING`;

const DAY_BUCKET_CANONICALIZATION_MIGRATION = [
  `DELETE FROM candles
    WHERE interval = 'DAY'
      AND source = 'DATABASE_SNAPSHOT'
      AND bucket_start <>
          date_trunc('day', updated_at AT TIME ZONE 'UTC')
            AT TIME ZONE 'UTC'`,
  `DELETE FROM candles
    WHERE interval = 'DAY'
      AND source = 'TRANSACTION_BACKFILL'`,
  `INSERT INTO candles (
     instrument_id, interval, bucket_start,
     open, high, low, close, volume,
     source, is_partial, updated_at
   )
   SELECT instrument_id,
          'DAY',
          date_trunc('day', updated_at AT TIME ZONE 'UTC')
            AT TIME ZONE 'UTC',
          open_price,
          high_price,
          low_price,
          current_price,
          volume,
          'DATABASE_SNAPSHOT',
          true,
          updated_at
     FROM quotes
   ON CONFLICT (instrument_id, interval, bucket_start) DO NOTHING`,
  MARKET_DAY_BACKFILL_MIGRATION,
];

const ACCOUNT_FEATURES_MIGRATION = [
  `CREATE TABLE IF NOT EXISTS watchlist_items (
    account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    mode text NOT NULL CHECK (mode IN ('VIRTUAL', 'REAL')),
    instrument_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, mode, instrument_id)
  )`,
  `CREATE INDEX IF NOT EXISTS watchlist_mode_instrument_index
    ON watchlist_items (mode, instrument_id)`,
  `CREATE TABLE IF NOT EXISTS gift_codes (
    code text PRIMARY KEY,
    amount_usd numeric(24, 2) NOT NULL CHECK (amount_usd > 0),
    repeatable boolean NOT NULL DEFAULT false,
    active boolean NOT NULL DEFAULT true,
    description text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS reward_claims (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('CHECK_IN', 'GIFT_CODE')),
    mode text NOT NULL CHECK (mode IN ('VIRTUAL', 'REAL')),
    natural_key text NOT NULL,
    gift_code text REFERENCES gift_codes(code),
    amount_usd numeric(24, 2) NOT NULL CHECK (amount_usd > 0),
    state text NOT NULL DEFAULT 'PENDING'
      CHECK (state IN ('PENDING', 'COMPLETED')),
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    UNIQUE (account_id, kind, natural_key)
  )`,
  `CREATE INDEX IF NOT EXISTS reward_claims_account_time_index
    ON reward_claims (account_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS cash_adjustments (
    id uuid PRIMARY KEY,
    portfolio_id uuid NOT NULL
      REFERENCES portfolios(id) ON DELETE CASCADE,
    claim_id text NOT NULL UNIQUE,
    amount_usd numeric(24, 2) NOT NULL CHECK (amount_usd > 0),
    reason text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `INSERT INTO gift_codes
     (code, amount_usd, repeatable, active, description)
   VALUES
     ('666666', 100000, false, true, '普通礼包'),
     ('888888', 500000, false, true, '高级礼包'),
     ('#1161125922', 1000000, true, true, '开发者特权礼包')
   ON CONFLICT (code) DO NOTHING`,
];

const AI_TRANSACTIONLESS_SETTLEMENT_MIGRATION = [
  `ALTER TABLE position_settlement_lots
    ALTER COLUMN source_transaction_id DROP NOT NULL`,
];

const LIMIT_ORDERS_MIGRATION = [
  `CREATE TABLE IF NOT EXISTS orders (
    id uuid PRIMARY KEY,
    portfolio_id uuid NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
    instrument_id text NOT NULL REFERENCES instruments(id),
    side text NOT NULL CHECK (side IN ('BUY', 'SELL')),
    order_mode text NOT NULL CHECK (order_mode IN ('MARKET', 'LIMIT')),
    status text NOT NULL CHECK (status IN ('OPEN', 'FILLED', 'CANCELLED')),
    quantity integer NOT NULL CHECK (quantity > 0),
    filled_quantity integer NOT NULL DEFAULT 0 CHECK (filled_quantity >= 0),
    limit_price numeric(24, 4),
    quote_currency text NOT NULL CHECK (quote_currency IN ('CNY', 'USD')),
    reserved_cash_usd numeric(24, 2) NOT NULL DEFAULT 0,
    reserved_quantity integer NOT NULL DEFAULT 0,
    actor_type text NOT NULL DEFAULT 'USER' CHECK (actor_type IN ('USER', 'AI')),
    actor_id text NOT NULL,
    idempotency_key text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    filled_at timestamptz,
    cancelled_at timestamptz,
    transaction_id uuid REFERENCES transactions(id) ON DELETE SET NULL,
    CHECK (
      (order_mode = 'MARKET' AND limit_price IS NULL) OR
      (order_mode = 'LIMIT' AND limit_price IS NOT NULL AND limit_price > 0)
    ),
    CHECK (filled_quantity <= quantity)
  )`,
  `CREATE INDEX IF NOT EXISTS orders_portfolio_created_index
    ON orders (portfolio_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS orders_open_instrument_index
    ON orders (status, instrument_id, created_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS orders_portfolio_idempotency_unique
    ON orders (portfolio_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL`,
];

const LLM_TRADERS_MIGRATION = [
  `ALTER TABLE ai_traders
    ADD COLUMN IF NOT EXISTS trader_kind text NOT NULL DEFAULT 'RULE'`,
  `ALTER TABLE ai_traders
    ADD COLUMN IF NOT EXISTS persona_key text`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ai_traders_persona_key_unique
    ON ai_traders (persona_key)
    WHERE persona_key IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS ai_trader_decisions (
    id uuid PRIMARY KEY,
    trader_id uuid NOT NULL REFERENCES ai_traders(id) ON DELETE CASCADE,
    decided_at timestamptz NOT NULL,
    action text NOT NULL,
    instrument_id text,
    result text NOT NULL,
    reason text,
    model_id text NOT NULL,
    detail text
  )`,
  `CREATE INDEX IF NOT EXISTS ai_trader_decisions_trader_time_index
    ON ai_trader_decisions (trader_id, decided_at DESC)`,
];

export async function migrateDatabase(client: PGlite): Promise<void> {
  await client.exec(INITIAL_SCHEMA);
  for (const statement of ACCOUNT_LEDGER_MIGRATION) {
    await client.exec(statement);
  }
  for (const statement of AI_AND_SETTLEMENT_MIGRATION) {
    await client.exec(statement);
  }
  await runVersionedMigration(client, 5, MARKET_HISTORY_MIGRATION);
  await runVersionedMigration(client, 6, [MARKET_DAY_BACKFILL_MIGRATION]);
  await runVersionedMigration(
    client,
    7,
    DAY_BUCKET_CANONICALIZATION_MIGRATION,
  );
  await runVersionedMigration(client, 8, ACCOUNT_FEATURES_MIGRATION);
  await runVersionedMigration(
    client,
    9,
    AI_TRANSACTIONLESS_SETTLEMENT_MIGRATION,
  );
  await runVersionedMigration(client, 10, LIMIT_ORDERS_MIGRATION);
  await runVersionedMigration(client, 11, LLM_TRADERS_MIGRATION);
  await client.query(
    `INSERT INTO schema_migrations (version)
     VALUES (1)
     ON CONFLICT (version) DO NOTHING`,
  );
  await client.query(
    `INSERT INTO schema_migrations (version)
     VALUES (2)
     ON CONFLICT (version) DO NOTHING`,
  );
  await client.query(
    `INSERT INTO schema_migrations (version)
     VALUES (3)
     ON CONFLICT (version) DO NOTHING`,
  );
  await client.query(
    `INSERT INTO schema_migrations (version)
     VALUES (4)
     ON CONFLICT (version) DO NOTHING`,
  );
}

async function runVersionedMigration(
  client: PGlite,
  version: number,
  statements: readonly string[],
): Promise<void> {
  await client.transaction(async (transaction) => {
    const applied = await transaction.query<{ version: number }>(
      `SELECT version FROM schema_migrations WHERE version = $1`,
      [version],
    );
    if (applied.rows.length > 0) {
      return;
    }
    for (const statement of statements) {
      await transaction.exec(statement);
    }
    await transaction.query(
      `INSERT INTO schema_migrations (version) VALUES ($1)`,
      [version],
    );
  });
}
