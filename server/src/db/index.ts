import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 数据库文件路径
const dbPath = process.env.DB_PATH || './data/stock_simulator.db';

// 确保目录存在
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// better-sqlite3 数据库实例
let db: Database.Database | null = null;

// 表创建 SQL
const createTableSQLs = [
  `CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_login_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    cash REAL NOT NULL DEFAULT 1000000,
    initial_cash REAL NOT NULL DEFAULT 1000000,
    total_assets REAL NOT NULL DEFAULT 1000000,
    trading_day INTEGER NOT NULL DEFAULT 1,
    is_paused INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS positions (
    id TEXT PRIMARY KEY,
    player_id TEXT NOT NULL,
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
    player_id TEXT NOT NULL,
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
    player_id TEXT NOT NULL,
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
    player_id TEXT NOT NULL,
    principal REAL NOT NULL,
    interest REAL NOT NULL DEFAULT 0,
    annual_rate REAL NOT NULL DEFAULT 0.17,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    borrow_date INTEGER NOT NULL,
    last_interest_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS achievements (
    id TEXT PRIMARY KEY,
    player_id TEXT NOT NULL,
    achievement_id TEXT NOT NULL,
    unlocked_at INTEGER NOT NULL,
    UNIQUE(player_id, achievement_id)
  )`,
  `CREATE TABLE IF NOT EXISTS gift_code_usage (
    player_id TEXT NOT NULL,
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
    trader_id TEXT NOT NULL,
    stock_code TEXT NOT NULL,
    stock_name TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    average_cost REAL NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_orders_player ON orders(player_id)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_player ON transactions(player_id)`,
  `CREATE INDEX IF NOT EXISTS idx_loans_player ON loans(player_id)`,
  `CREATE INDEX IF NOT EXISTS idx_positions_player ON positions(player_id)`,
  `CREATE INDEX IF NOT EXISTS idx_achievements_player ON achievements(player_id)`,
];

// 初始化数据库（同步）
export function initDatabase(): void {
  // 打开数据库文件（不存在则创建）
  db = new Database(dbPath);
  
  // 启用 WAL 模式，提升并发性能
  db.pragma('journal_mode = WAL');
  
  // 创建表
  for (const sql of createTableSQLs) {
    try {
      db.exec(sql);
    } catch (error) {
      // 忽略已存在的表错误
    }
  }
  
  console.log('✅ Database initialized (better-sqlite3)');
}

// 兼容旧的异步接口
export async function initDatabaseAsync(): Promise<Database.Database> {
  initDatabase();
  return db!;
}

// 获取数据库实例
export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

// 保存数据库（better-sqlite3 自动持久化，此函数保留用于兼容）
export function saveDatabase() {
  // better-sqlite3 自动持久化，无需手动保存
  // 执行 checkpoint 确保 WAL 文件写入主数据库
  if (db) {
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
      // 忽略 checkpoint 错误
    }
  }
}

// 关闭数据库
export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}

// 数据库查询工具函数
export const dbUtils = {
  // 执行 SQL 并返回结果
  query: <T>(sql: string, params: any[] = []): T[] => {
    if (!db) throw new Error('Database not initialized');
    
    const stmt = db.prepare(sql);
    return stmt.all(...params) as T[];
  },

  // 执行 SQL 并返回单个结果
  queryOne: <T>(sql: string, params: any[] = []): T | null => {
    if (!db) throw new Error('Database not initialized');
    
    const stmt = db.prepare(sql);
    return stmt.get(...params) as T | null;
  },

  // 执行 INSERT/UPDATE/DELETE
  run: (sql: string, params: any[] = []): { changes: number } => {
    if (!db) throw new Error('Database not initialized');
    
    const stmt = db.prepare(sql);
    const result = stmt.run(...params);
    return { changes: result.changes };
  },

  // 执行多个 SQL（事务）
  transaction: (fn: () => void) => {
    if (!db) throw new Error('Database not initialized');
    
    const transaction = db.transaction(fn);
    transaction();
  },
};

export default dbUtils;