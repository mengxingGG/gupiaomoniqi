import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey(),
    username: text("username").notNull(),
    usernameNormalized: text("username_normalized").notNull(),
    email: text("email"),
    emailNormalized: text("email_normalized"),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name").notNull(),
    displayCurrency: text("display_currency").notNull().default("USD"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
    lastLoginAt: timestamp("last_login_at", {
      withTimezone: true,
      mode: "date",
    }),
  },
  (table) => [
    uniqueIndex("accounts_username_normalized_unique").on(
      table.usernameNormalized,
    ),
    uniqueIndex("accounts_email_normalized_unique").on(
      table.emailNormalized,
    ),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("sessions_account_index").on(table.accountId)],
);

export const marketImportBatches = pgTable("market_import_batches", {
  id: uuid("id").primaryKey(),
  source: text("source").notNull(),
  sourceHost: text("source_host").notNull(),
  sourceFetchedAt: timestamp("source_fetched_at", {
    withTimezone: true,
    mode: "date",
  }).notNull(),
  importedAt: timestamp("imported_at", {
    withTimezone: true,
    mode: "date",
  })
    .notNull()
    .defaultNow(),
  selection: text("selection").notNull(),
  requestedPerMarket: integer("requested_per_market").notNull(),
  instrumentCount: integer("instrument_count").notNull(),
  marketCounts: jsonb("market_counts")
    .$type<Record<string, number>>()
    .notNull(),
  fxRates: jsonb("fx_rates")
    .$type<{
      asOf: string;
      source: string;
      HKD_CNY: number;
      GBP_USD: number;
    }>()
    .notNull(),
  snapshotSha256: text("snapshot_sha256").notNull(),
});

export const instruments = pgTable(
  "instruments",
  {
    id: text("id").primaryKey(),
    symbol: text("symbol").notNull(),
    name: text("name").notNull(),
    market: text("market").notNull(),
    type: text("type").notNull().default("STOCK_VIRTUAL"),
    industry: text("industry").notNull(),
    sourceCurrency: text("source_currency").notNull(),
    quoteCurrency: text("settlement_currency").notNull(),
    sourceMarketCode: integer("source_market_code"),
    sourceSecid: text("source_secid").notNull(),
    sourcePriceUnit: text("source_price_unit").notNull(),
    sourceInitialPrice: numeric("source_initial_price", {
      precision: 24,
      scale: 4,
      mode: "number",
    }).notNull(),
    sourcePreviousClose: numeric("source_previous_close", {
      precision: 24,
      scale: 4,
      mode: "number",
    }).notNull(),
    initialPrice: numeric("initial_price", {
      precision: 24,
      scale: 4,
      mode: "number",
    }).notNull(),
    lotSize: integer("lot_size").notNull(),
    settlementCycle: text("settlement_cycle")
      .notNull()
      .default("T0"),
    volatility: numeric("volatility", {
      precision: 10,
      scale: 8,
      mode: "number",
    }).notNull(),
    liquidity: integer("liquidity").notNull(),
    sourceVolume: bigint("source_volume", { mode: "number" })
      .notNull()
      .default(0),
    sourceTurnover: numeric("source_turnover", {
      precision: 28,
      scale: 2,
      mode: "number",
    })
      .notNull()
      .default(0),
    totalMarketCap: numeric("total_market_cap", {
      precision: 28,
      scale: 2,
      mode: "number",
    }),
    circulatingMarketCap: numeric("circulating_market_cap", {
      precision: 28,
      scale: 2,
      mode: "number",
    }),
    isTradable: boolean("is_tradable").notNull().default(true),
    importBatchId: uuid("import_batch_id")
      .notNull()
      .references(() => marketImportBatches.id),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("instruments_market_symbol_unique").on(
      table.market,
      table.symbol,
    ),
    index("instruments_market_index").on(table.market),
    index("instruments_settlement_currency_index").on(
      table.quoteCurrency,
    ),
  ],
);

export const quotes = pgTable("quotes", {
  instrumentId: text("instrument_id")
    .primaryKey()
    .references(() => instruments.id, { onDelete: "cascade" }),
  currentPrice: numeric("current_price", {
    precision: 24,
    scale: 4,
    mode: "number",
  }).notNull(),
  previousClose: numeric("previous_close", {
    precision: 24,
    scale: 4,
    mode: "number",
  }).notNull(),
  openPrice: numeric("open_price", {
    precision: 24,
    scale: 4,
    mode: "number",
  }).notNull(),
  highPrice: numeric("high_price", {
    precision: 24,
    scale: 4,
    mode: "number",
  }).notNull(),
  lowPrice: numeric("low_price", {
    precision: 24,
    scale: 4,
    mode: "number",
  }).notNull(),
  volume: bigint("volume", { mode: "number" }).notNull().default(0),
  changeAmount: numeric("change_amount", {
    precision: 24,
    scale: 4,
    mode: "number",
  })
    .notNull()
    .default(0),
  changePercent: numeric("change_percent", {
    precision: 12,
    scale: 6,
    mode: "number",
  })
    .notNull()
    .default(0),
  updatedAt: timestamp("updated_at", {
    withTimezone: true,
    mode: "date",
  })
    .notNull()
    .defaultNow(),
});

export const candles = pgTable(
  "candles",
  {
    instrumentId: text("instrument_id")
      .notNull()
      .references(() => instruments.id, { onDelete: "cascade" }),
    interval: text("interval").notNull(),
    bucketStart: timestamp("bucket_start", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    open: numeric("open", {
      precision: 24,
      scale: 4,
      mode: "number",
    }).notNull(),
    high: numeric("high", {
      precision: 24,
      scale: 4,
      mode: "number",
    }).notNull(),
    low: numeric("low", {
      precision: 24,
      scale: 4,
      mode: "number",
    }).notNull(),
    close: numeric("close", {
      precision: 24,
      scale: 4,
      mode: "number",
    }).notNull(),
    volume: bigint("volume", { mode: "number" }).notNull().default(0),
    source: text("source").notNull(),
    isPartial: boolean("is_partial").notNull().default(true),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "candles_primary_key",
      columns: [table.instrumentId, table.interval, table.bucketStart],
    }),
    index("candles_instrument_interval_time_index").on(
      table.instrumentId,
      table.interval,
      table.bucketStart,
    ),
  ],
);

export const portfolios = pgTable("portfolios", {
  id: uuid("id").primaryKey(),
  accountId: uuid("account_id").references(() => accounts.id, {
    onDelete: "cascade",
  }),
  name: text("name").notNull(),
  mode: text("mode").notNull().default("VIRTUAL"),
  activeCurrency: text("active_currency").notNull().default("CNY"),
  initialCashUsd: numeric("initial_cash_usd", {
    precision: 24,
    scale: 2,
    mode: "number",
  })
    .notNull()
    .default(0),
  availableCashUsd: numeric("available_cash_usd", {
    precision: 24,
    scale: 2,
    mode: "number",
  })
    .notNull()
    .default(0),
  frozenCashUsd: numeric("frozen_cash_usd", {
    precision: 24,
    scale: 2,
    mode: "number",
  })
    .notNull()
    .default(0),
  createdAt: timestamp("created_at", {
    withTimezone: true,
    mode: "date",
  })
    .notNull()
    .defaultNow(),
}, (table) => [
  uniqueIndex("portfolios_account_unique").on(table.accountId),
]);

export const portfolioBalances = pgTable(
  "portfolio_balances",
  {
    portfolioId: uuid("portfolio_id")
      .notNull()
      .references(() => portfolios.id, { onDelete: "cascade" }),
    currency: text("currency").notNull(),
    initialCash: numeric("initial_cash", {
      precision: 24,
      scale: 2,
      mode: "number",
    }).notNull(),
    cash: numeric("cash", {
      precision: 24,
      scale: 2,
      mode: "number",
    }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.portfolioId, table.currency],
      name: "portfolio_balances_primary_key",
    }),
  ],
);

export const aiTraders = pgTable(
  "ai_traders",
  {
    id: uuid("id").primaryKey(),
    portfolioId: uuid("portfolio_id")
      .notNull()
      .references(() => portfolios.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    strategy: text("strategy").notNull(),
    psychology: text("psychology").notNull(),
    riskLevel: integer("risk_level").notNull(),
    activityLevel: integer("activity_level").notNull(),
    preferredMarket: text("preferred_market").notNull(),
    traderKind: text("trader_kind").notNull().default("RULE"),
    personaKey: text("persona_key"),
    isActive: boolean("is_active").notNull().default(true),
    lastActionAt: timestamp("last_action_at", {
      withTimezone: true,
      mode: "date",
    }),
    nextActionAt: timestamp("next_action_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    totalTrades: integer("total_trades").notNull().default(0),
    winCount: integer("win_count").notNull().default(0),
    lossCount: integer("loss_count").notNull().default(0),
    investmentHorizon: text("investment_horizon")
      .notNull()
      .default("SWING"),
    conviction: numeric("conviction", {
      precision: 8,
      scale: 6,
      mode: "number",
    })
      .notNull()
      .default(0),
    thesisInstrumentId: text("thesis_instrument_id").references(
      () => instruments.id,
      { onDelete: "set null" },
    ),
    thesisScore: numeric("thesis_score", {
      precision: 12,
      scale: 8,
      mode: "number",
    })
      .notNull()
      .default(0),
    thesisStartedAt: timestamp("thesis_started_at", {
      withTimezone: true,
      mode: "date",
    }),
    minimumHoldUntil: timestamp("minimum_hold_until", {
      withTimezone: true,
      mode: "date",
    }),
    lastSignalVersion: text("last_signal_version"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("ai_traders_portfolio_unique").on(table.portfolioId),
    index("ai_traders_next_action_index").on(
      table.isActive,
      table.nextActionAt,
    ),
    uniqueIndex("ai_traders_persona_key_unique").on(table.personaKey),
  ],
);

export const passwordResetChallenges = pgTable(
  "password_reset_challenges",
  {
    id: uuid("id").primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    attemptsRemaining: integer("attempts_remaining").notNull().default(5),
    consumedAt: timestamp("consumed_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("password_reset_account_created_index").on(
      table.accountId,
      table.createdAt,
    ),
    index("password_reset_expiry_index").on(table.expiresAt),
  ],
);

export const emailVerificationChallenges = pgTable(
  "email_verification_challenges",
  {
    id: uuid("id").primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    emailNormalized: text("email_normalized").notNull(),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    attemptsRemaining: integer("attempts_remaining").notNull().default(5),
    consumedAt: timestamp("consumed_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("email_verification_account_created_index").on(
      table.accountId,
      table.createdAt,
    ),
    index("email_verification_expiry_index").on(table.expiresAt),
  ],
);

export const registrationEmailChallenges = pgTable(
  "registration_email_challenges",
  {
    id: uuid("id").primaryKey(),
    email: text("email").notNull(),
    emailNormalized: text("email_normalized").notNull(),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    attemptsRemaining: integer("attempts_remaining").notNull().default(5),
    verifiedAt: timestamp("verified_at", {
      withTimezone: true,
      mode: "date",
    }),
    consumedAt: timestamp("consumed_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("registration_email_created_index").on(
      table.emailNormalized,
      table.createdAt,
    ),
    index("registration_email_expiry_index").on(table.expiresAt),
  ],
);

export const aiTraderDecisions = pgTable(
  "ai_trader_decisions",
  {
    id: uuid("id").primaryKey(),
    traderId: uuid("trader_id")
      .notNull()
      .references(() => aiTraders.id, { onDelete: "cascade" }),
    decidedAt: timestamp("decided_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    action: text("action").notNull(),
    instrumentId: text("instrument_id"),
    result: text("result").notNull(),
    reason: text("reason"),
    modelId: text("model_id").notNull(),
    detail: text("detail"),
  },
  (table) => [
    index("ai_trader_decisions_trader_time_index").on(
      table.traderId,
      table.decidedAt,
    ),
  ],
);

export const positions = pgTable(
  "positions",
  {
    id: uuid("id").primaryKey(),
    portfolioId: uuid("portfolio_id")
      .notNull()
      .references(() => portfolios.id, { onDelete: "cascade" }),
    instrumentId: text("instrument_id")
      .notNull()
      .references(() => instruments.id),
    quantity: integer("quantity").notNull(),
    availableQuantity: integer("available_quantity").notNull(),
    frozenQuantity: integer("frozen_quantity").notNull().default(0),
    averageCost: numeric("average_cost", {
      precision: 24,
      scale: 4,
      mode: "number",
    }).notNull(),
    averageCostUsd: numeric("average_cost_usd", {
      precision: 24,
      scale: 4,
      mode: "number",
    })
      .notNull()
      .default(0),
    openedAt: timestamp("opened_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("positions_portfolio_instrument_unique").on(
      table.portfolioId,
      table.instrumentId,
    ),
  ],
);

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey(),
    portfolioId: uuid("portfolio_id")
      .notNull()
      .references(() => portfolios.id, { onDelete: "cascade" }),
    instrumentId: text("instrument_id")
      .notNull()
      .references(() => instruments.id),
    currency: text("currency").notNull(),
    side: text("side").notNull(),
    quantity: integer("quantity").notNull(),
    price: numeric("price", {
      precision: 24,
      scale: 4,
      mode: "number",
    }).notNull(),
    grossAmount: numeric("gross_amount", {
      precision: 24,
      scale: 2,
      mode: "number",
    }).notNull(),
    fee: numeric("fee", {
      precision: 24,
      scale: 2,
      mode: "number",
    }).notNull(),
    netAmount: numeric("net_amount", {
      precision: 24,
      scale: 2,
      mode: "number",
    }).notNull(),
    realizedProfit: numeric("realized_profit", {
      precision: 24,
      scale: 2,
      mode: "number",
    }),
    quotePrice: numeric("quote_price", {
      precision: 24,
      scale: 4,
      mode: "number",
    }),
    quoteCurrency: text("quote_currency"),
    fxRateToUsd: numeric("fx_rate_to_usd", {
      precision: 18,
      scale: 10,
      mode: "number",
    }),
    priceUsd: numeric("price_usd", {
      precision: 24,
      scale: 4,
      mode: "number",
    }),
    grossAmountUsd: numeric("gross_amount_usd", {
      precision: 24,
      scale: 2,
      mode: "number",
    }),
    feeUsd: numeric("fee_usd", {
      precision: 24,
      scale: 2,
      mode: "number",
    }),
    netAmountUsd: numeric("net_amount_usd", {
      precision: 24,
      scale: 2,
      mode: "number",
    }),
    realizedProfitUsd: numeric("realized_profit_usd", {
      precision: 24,
      scale: 2,
      mode: "number",
    }),
    actorType: text("actor_type").notNull().default("USER"),
    actorId: text("actor_id"),
    idempotencyKey: text("idempotency_key"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("transactions_portfolio_created_index").on(
      table.portfolioId,
      table.createdAt,
    ),
    uniqueIndex("transactions_portfolio_idempotency_unique").on(
      table.portfolioId,
      table.idempotencyKey,
    ),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey(),
    portfolioId: uuid("portfolio_id")
      .notNull()
      .references(() => portfolios.id, { onDelete: "cascade" }),
    instrumentId: text("instrument_id")
      .notNull()
      .references(() => instruments.id),
    side: text("side").notNull(),
    orderMode: text("order_mode").notNull(),
    status: text("status").notNull(),
    quantity: integer("quantity").notNull(),
    filledQuantity: integer("filled_quantity").notNull().default(0),
    limitPrice: numeric("limit_price", {
      precision: 24,
      scale: 4,
      mode: "number",
    }),
    quoteCurrency: text("quote_currency").notNull(),
    reservedCashUsd: numeric("reserved_cash_usd", {
      precision: 24,
      scale: 2,
      mode: "number",
    })
      .notNull()
      .default(0),
    reservedQuantity: integer("reserved_quantity").notNull().default(0),
    actorType: text("actor_type").notNull().default("USER"),
    actorId: text("actor_id").notNull(),
    idempotencyKey: text("idempotency_key"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
    filledAt: timestamp("filled_at", {
      withTimezone: true,
      mode: "date",
    }),
    cancelledAt: timestamp("cancelled_at", {
      withTimezone: true,
      mode: "date",
    }),
    transactionId: uuid("transaction_id").references(
      () => transactions.id,
      { onDelete: "set null" },
    ),
  },
  (table) => [
    index("orders_portfolio_created_index").on(
      table.portfolioId,
      table.createdAt,
    ),
    index("orders_open_instrument_index").on(
      table.status,
      table.instrumentId,
      table.createdAt,
    ),
    uniqueIndex("orders_portfolio_idempotency_unique").on(
      table.portfolioId,
      table.idempotencyKey,
    ),
  ],
);

export const virtualInstrumentStates = pgTable(
  "virtual_instrument_states",
  {
    instrumentId: text("instrument_id")
      .primaryKey()
      .references(() => instruments.id, { onDelete: "cascade" }),
    fundamentalValue: numeric("fundamental_value", {
      precision: 24,
      scale: 8,
      mode: "number",
    }).notNull(),
    qualityScore: numeric("quality_score", {
      precision: 8,
      scale: 6,
      mode: "number",
    }).notNull(),
    growthScore: numeric("growth_score", {
      precision: 8,
      scale: 6,
      mode: "number",
    }).notNull(),
    leverageRisk: numeric("leverage_risk", {
      precision: 8,
      scale: 6,
      mode: "number",
    }).notNull(),
    cyclicality: numeric("cyclicality", {
      precision: 8,
      scale: 6,
      mode: "number",
    }).notNull(),
    floatShares: numeric("float_shares", {
      precision: 28,
      scale: 4,
      mode: "number",
    }).notNull(),
    ownershipPremium: numeric("ownership_premium", {
      precision: 12,
      scale: 8,
      mode: "number",
    })
      .notNull()
      .default(0),
    ownershipConcentration: numeric("ownership_concentration", {
      precision: 12,
      scale: 8,
      mode: "number",
    })
      .notNull()
      .default(0),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("virtual_instrument_states_updated_index").on(table.updatedAt)],
);

export const virtualMarketRegimes = pgTable(
  "virtual_market_regimes",
  {
    scopeType: text("scope_type").notNull(),
    scopeKey: text("scope_key").notNull(),
    phase: text("phase").notNull(),
    driftPerDay: numeric("drift_per_day", {
      precision: 12,
      scale: 8,
      mode: "number",
    }).notNull(),
    volatilityMultiplier: numeric("volatility_multiplier", {
      precision: 8,
      scale: 6,
      mode: "number",
    }).notNull(),
    startedAt: timestamp("started_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    nextTransitionAt: timestamp("next_transition_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "virtual_market_regimes_primary_key",
      columns: [table.scopeType, table.scopeKey],
    }),
  ],
);

export const virtualMarketEvents = pgTable(
  "virtual_market_events",
  {
    id: uuid("id").primaryKey(),
    kind: text("kind").notNull(),
    scopeType: text("scope_type").notNull(),
    scopeKey: text("scope_key").notNull(),
    headline: text("headline").notNull(),
    fundamentalImpact: numeric("fundamental_impact", {
      precision: 12,
      scale: 8,
      mode: "number",
    }).notNull(),
    sentimentImpact: numeric("sentiment_impact", {
      precision: 12,
      scale: 8,
      mode: "number",
    }).notNull(),
    volatilityMultiplier: numeric("volatility_multiplier", {
      precision: 8,
      scale: 6,
      mode: "number",
    }).notNull(),
    startsAt: timestamp("starts_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    endsAt: timestamp("ends_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    decayHalfLifeMs: bigint("decay_half_life_ms", { mode: "number" }).notNull(),
    appliedFraction: numeric("applied_fraction", {
      precision: 8,
      scale: 6,
      mode: "number",
    })
      .notNull()
      .default(0),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("virtual_market_events_lifecycle_index").on(
      table.startsAt,
      table.endsAt,
    ),
    index("virtual_market_events_scope_index").on(
      table.scopeType,
      table.scopeKey,
    ),
  ],
);

export const positionSettlementLots = pgTable(
  "position_settlement_lots",
  {
    id: uuid("id").primaryKey(),
    portfolioId: uuid("portfolio_id")
      .notNull()
      .references(() => portfolios.id, { onDelete: "cascade" }),
    instrumentId: text("instrument_id")
      .notNull()
      .references(() => instruments.id),
    quantity: integer("quantity").notNull(),
    unlockAt: timestamp("unlock_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    settledAt: timestamp("settled_at", {
      withTimezone: true,
      mode: "date",
    }),
    sourceTransactionId: uuid("source_transaction_id").references(
      () => transactions.id,
      { onDelete: "cascade" },
    ),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("position_settlement_transaction_unique").on(
      table.sourceTransactionId,
    ),
    index("position_settlement_due_index").on(
      table.settledAt,
      table.unlockAt,
    ),
    index("position_settlement_position_index").on(
      table.portfolioId,
      table.instrumentId,
    ),
  ],
);
