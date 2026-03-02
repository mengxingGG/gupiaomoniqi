import initSqlJs, { Database } from 'sql.js';
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

// SQL.js 数据库实例
let db: Database | null = null;

// 是否处于事务中（防止 saveDatabase 被事务内的 run 触发）
let inTransaction = false;

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

// 初始化数据库
export async function initDatabase(): Promise<Database> {
  // 显式指定 wasm 文件路径，避免在不同工作目录下找不到
  const wasmPath = path.resolve(__dirname, '../../node_modules/sql.js/dist/sql-wasm.wasm');
  const SQL = await initSqlJs({
    locateFile: () => wasmPath,
  });

  // 尝试加载现有数据库
  if (fs.existsSync(dbPath)) {
    try {
      const fileBuffer = fs.readFileSync(dbPath);
      db = new SQL.Database(fileBuffer);
      console.log('✅ Database loaded from file');
    } catch (error) {
      console.log('⚠️ Failed to load existing database, creating new one');
      db = new SQL.Database();
    }
  } else {
    db = new SQL.Database();
    console.log('✅ New database created');
  }

  // 创建表
  for (const sql of createTableSQLs) {
    try {
      db.run(sql);
    } catch (error) {
      // 忽略已存在的表错误
    }
  }

  // 保存数据库
  saveDatabase();

  return db;
}

// 获取数据库实例
export function getDb(): Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

// 保存数据库到文件
export function saveDatabase() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  }
}

// 关闭数据库
export function closeDatabase() {
  if (db) {
    saveDatabase();
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
    stmt.bind(params);
    const results: T[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as T;
      results.push(row);
    }
    stmt.free();
    return results;
  },

  // 执行 SQL 并返回单个结果
  queryOne: <T>(sql: string, params: any[] = []): T | null => {
    const results = dbUtils.query<T>(sql, params);
    return results.length > 0 ? results[0] : null;
  },

  // 执行 INSERT/UPDATE/DELETE
  run: (sql: string, params: any[] = []): { changes: number } => {
    if (!db) throw new Error('Database not initialized');

    db.run(sql, params);
    // 事务期间不调用 saveDatabase（db.export() 会隐式提交事务）
    if (!inTransaction) {
      saveDatabase();
    }
    return { changes: db.getRowsModified() };
  },

  // 执行多个 SQL（事务）
  transaction: (fn: () => void) => {
    if (!db) throw new Error('Database not initialized');

    inTransaction = true;
    db.run('BEGIN TRANSACTION');
    try {
      fn();
      db.run('COMMIT');
      inTransaction = false;
      saveDatabase();
    } catch (error) {
      db.run('ROLLBACK');
      inTransaction = false;
      throw error;
    }
  },
};

export default dbUtils;
