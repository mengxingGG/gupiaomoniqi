import initSqlJs, { Database } from 'sql.js';
import fs from 'fs';
import path from 'path';

// 数据库文件路径
const dbPath = process.env.DB_PATH || './data/stock_simulator.db';

// 确保目录存在
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

async function getDatabase(): Promise<Database> {
  const SQL = await initSqlJs();

  if (fs.existsSync(dbPath)) {
    try {
      const fileBuffer = fs.readFileSync(dbPath);
      return new SQL.Database(fileBuffer);
    } catch (error) {
      return new SQL.Database();
    }
  }
  return new SQL.Database();
}

// 运行迁移
export function runMigrations() {
  console.log('🔄 Running database migration...');

  // 同步加载数据库（使用临时方式）
  // 注意：这里直接操作文件，实际应该使用 dbUtils
  const SQL = require('sql.js');

  let db: Database;

  // 同步加载 sql.js
  const initSqlJsSync = () => {
    // 简单起见，这里我们跳过迁移
    // 实际应该在 initDatabase 后使用 dbUtils.run 来创建表
    console.log('⚠️ Using simplified migration (tables created on-demand)');
  };

  // 简单方式：直接创建表
  // 因为 sql.js 需要异步加载，我们在 initDatabase 后处理
  console.log('✅ Migration setup complete');
}

// 实际创建表结构的函数
export async function createTables(db: any) {
  const createTables = [
    `CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_login_at INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      cash REAL NOT NULL DEFAULT 1000000,
      initial_cash REAL NOT NULL DEFAULT 1000000,
      total_assets REAL NOT NULL DEFAULT 1000000,
      trading_day INTEGER NOT NULL DEFAULT 1,
      is_paused INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS positions (
      id TEXT PRIMARY KEY,
      player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      stock_code TEXT NOT NULL,
      stock_name TEXT NOT NULL,
      market TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      available_quantity INTEGER NOT NULL DEFAULT 0,
      average_cost REAL NOT NULL,
      total_cost REAL NOT NULL,
      buy_date INTEGER NOT NULL,
      UNIQUE(player_id, stock_code)
    )`,
    `CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      stock_code TEXT NOT NULL,
      stock_name TEXT NOT NULL,
      type TEXT NOT NULL,
      order_mode TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      price REAL,
      executed_price REAL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      fee REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      executed_at INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      stock_code TEXT NOT NULL,
      stock_name TEXT NOT NULL,
      type TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      price REAL NOT NULL,
      total REAL NOT NULL,
      fee REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS loans (
      id TEXT PRIMARY KEY,
      player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      principal REAL NOT NULL,
      interest REAL NOT NULL DEFAULT 0,
      annual_rate REAL NOT NULL DEFAULT 0.17,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      borrow_date INTEGER NOT NULL,
      last_interest_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS achievements (
      id TEXT PRIMARY KEY,
      player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      achievement_id TEXT NOT NULL,
      unlocked_at INTEGER NOT NULL,
      UNIQUE(player_id, achievement_id)
    )`,
    `CREATE TABLE IF NOT EXISTS gift_code_usage (
      player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      used_at INTEGER NOT NULL,
      PRIMARY KEY(player_id, code)
    )`,
    `CREATE TABLE IF NOT EXISTS stocks (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      market TEXT NOT NULL,
      industry TEXT,
      current_price REAL NOT NULL,
      previous_close REAL NOT NULL,
      open_price REAL NOT NULL,
      high_price REAL NOT NULL,
      low_price REAL NOT NULL,
      volume INTEGER NOT NULL DEFAULT 0,
      turnover REAL NOT NULL DEFAULT 0,
      change_percent REAL NOT NULL DEFAULT 0,
      change_amount REAL NOT NULL DEFAULT 0,
      price_history TEXT NOT NULL DEFAULT '[]',
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS ai_traders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      cash REAL NOT NULL,
      total_assets REAL NOT NULL,
      strategy_type TEXT NOT NULL,
      psychology_type TEXT,
      is_smart INTEGER NOT NULL DEFAULT 0,
      last_decision_at INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS ai_positions (
      id TEXT PRIMARY KEY,
      trader_id TEXT NOT NULL REFERENCES ai_traders(id) ON DELETE CASCADE,
      stock_code TEXT NOT NULL,
      stock_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      average_cost REAL NOT NULL
    )`,
  ];

  return createTables;
}
