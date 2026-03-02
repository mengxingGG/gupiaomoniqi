import { sqliteTable, text, integer, real, uniqueIndex } from 'drizzle-orm/sqlite-core';

// 账户表（登录凭据）
export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  username: text('username').unique().notNull(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name').notNull(),
  createdAt: integer('created_at').notNull(),
  lastLoginAt: integer('last_login_at'),
});

// 玩家档案（1:1 绑定账户）
export const players = sqliteTable('players', {
  id: text('id').primaryKey().references(() => accounts.id, { onDelete: 'cascade' }),
  cash: real('cash').notNull().default(1000000),
  initialCash: real('initial_cash').notNull().default(1000000),
  totalAssets: real('total_assets').notNull().default(1000000),
  tradingDay: integer('trading_day').notNull().default(1),
  isPaused: integer('is_paused').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
});

// 持仓表
export const positions = sqliteTable('positions', {
  id: text('id').primaryKey(),
  playerId: text('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  stockCode: text('stock_code').notNull(),
  stockName: text('stock_name').notNull(),
  market: text('market').notNull(),
  quantity: integer('quantity').notNull(),
  availableQuantity: integer('available_quantity').notNull().default(0),
  averageCost: real('average_cost').notNull(),
  totalCost: real('total_cost').notNull(),
  buyDate: integer('buy_date').notNull(),
}, (table) => ({
  playerStockIdx: uniqueIndex('player_stock_idx').on(table.playerId, table.stockCode),
}));

// 订单表
export const orders = sqliteTable('orders', {
  id: text('id').primaryKey(),
  playerId: text('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  stockCode: text('stock_code').notNull(),
  stockName: text('stock_name').notNull(),
  type: text('type').notNull(), // 'BUY' | 'SELL'
  orderMode: text('order_mode').notNull(), // 'MARKET' | 'LIMIT'
  quantity: integer('quantity').notNull(),
  price: real('price'),
  executedPrice: real('executed_price'),
  status: text('status').notNull().default('PENDING'), // 'PENDING' | 'EXECUTED' | 'CANCELLED'
  fee: real('fee').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  executedAt: integer('executed_at'),
});

// 交易记录表
export const transactions = sqliteTable('transactions', {
  id: text('id').primaryKey(),
  playerId: text('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  stockCode: text('stock_code').notNull(),
  stockName: text('stock_name').notNull(),
  type: text('type').notNull(), // 'BUY' | 'SELL'
  quantity: integer('quantity').notNull(),
  price: real('price').notNull(),
  total: real('total').notNull(),
  fee: real('fee').notNull().default(0),
  createdAt: integer('created_at').notNull(),
});

// 借贷表
export const loans = sqliteTable('loans', {
  id: text('id').primaryKey(),
  playerId: text('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  principal: real('principal').notNull(),
  interest: real('interest').notNull().default(0),
  annualRate: real('annual_rate').notNull().default(0.17),
  status: text('status').notNull().default('ACTIVE'), // 'ACTIVE' | 'REPAID'
  borrowDate: integer('borrow_date').notNull(),
  lastInterestAt: integer('last_interest_at').notNull(),
});

// 成就表
export const achievements = sqliteTable('achievements', {
  id: text('id').primaryKey(),
  playerId: text('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  achievementId: text('achievement_id').notNull(),
  unlockedAt: integer('unlocked_at').notNull(),
}, (table) => ({
  playerAchievementIdx: uniqueIndex('player_achievement_idx').on(table.playerId, table.achievementId),
}));

// 礼包码使用记录
export const giftCodeUsage = sqliteTable('gift_code_usage', {
  playerId: text('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  code: text('code').notNull(),
  usedAt: integer('used_at').notNull(),
}, (table) => ({
  playerCodeIdx: uniqueIndex('player_code_idx').on(table.playerId, table.code),
}));

// 股票价格表（服务端维护）
export const stocks = sqliteTable('stocks', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  market: text('market').notNull(),
  industry: text('industry'),
  currentPrice: real('current_price').notNull(),
  previousClose: real('previous_close').notNull(),
  openPrice: real('open_price').notNull(),
  highPrice: real('high_price').notNull(),
  lowPrice: real('low_price').notNull(),
  volume: integer('volume').notNull().default(0),
  turnover: real('turnover').notNull().default(0),
  changePercent: real('change_percent').notNull().default(0),
  changeAmount: real('change_amount').notNull().default(0),
  priceHistory: text('price_history').notNull().default('[]'),
  updatedAt: integer('updated_at').notNull(),
});

// AI 交易者表
export const aiTraders = sqliteTable('ai_traders', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  cash: real('cash').notNull(),
  totalAssets: real('total_assets').notNull(),
  strategyType: text('strategy_type').notNull(),
  psychologyType: text('psychology_type'),
  isSmart: integer('is_smart').notNull().default(0), // 1 = LLM驱动
  lastDecisionAt: integer('last_decision_at'),
});

// AI 持仓表
export const aiPositions = sqliteTable('ai_positions', {
  id: text('id').primaryKey(),
  traderId: text('trader_id').notNull().references(() => aiTraders.id, { onDelete: 'cascade' }),
  stockCode: text('stock_code').notNull(),
  stockName: text('stock_name').notNull(),
  quantity: integer('quantity').notNull(),
  averageCost: real('average_cost').notNull(),
});

// 类型导出
export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Player = typeof players.$inferSelect;
export type NewPlayer = typeof players.$inferInsert;
export type Position = typeof positions.$inferSelect;
export type NewPosition = typeof positions.$inferInsert;
export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type Loan = typeof loans.$inferSelect;
export type NewLoan = typeof loans.$inferInsert;
export type Achievement = typeof achievements.$inferSelect;
export type NewAchievement = typeof achievements.$inferInsert;
export type GiftCodeUsageRecord = typeof giftCodeUsage.$inferSelect;
export type Stock = typeof stocks.$inferSelect;
export type NewStock = typeof stocks.$inferInsert;
export type AITrader = typeof aiTraders.$inferSelect;
export type NewAITrader = typeof aiTraders.$inferInsert;
export type AIPosition = typeof aiPositions.$inferSelect;
export type NewAIPosition = typeof aiPositions.$inferInsert;
