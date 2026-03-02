/**
 * 游戏配置常量
 */

export const GameConfig = {
  // ========== 初始资金 ==========
  INITIAL_CASH: 1000000, // 初始资金 100 万

  // ========== 手续费 ==========
  BUY_FEE_RATE: 0.005,   // 买入手续费 5‰ (0.5%)
  SELL_FEE_RATE: 0.003,  // 卖出手续费 3‰ (0.3%)

  // ========== 交易限制 ==========
  MIN_TRADE_AMOUNT: 100,   // 最小交易金额
  PRICE_TICK: 0.01,       // 价格最小变动单位

  // ========== AI 配置 ==========
  AI_TRADER_COUNT: 1000,      // AI 交易者数量
  AI_SMART_TRADER_COUNT: 50,  // 智能AI（LLM）交易者数量
  AI_MIN_FUNDS: 500000,      // AI 最小资金 50 万
  AI_MAX_FUNDS: 50000000,    // AI 最大资金 5000 万
  AI_REFILL_MIN: 500000,     // AI 资金补充最小值
  AI_REFILL_MAX: 50000000,   // AI 资金补充最大值
  AI_TRADE_INTERVAL: 60000,  // AI 交易间隔 1 分钟
  AI_ACTIVE_MIN: 20,         // 每轮最少激活AI数量
  AI_ACTIVE_MAX: 50,         // 每轮最多激活AI数量

  // ========== 借贷配置 ==========
  LOAN_MULTIPLIER: 3,      // 借款上限 = 本金 * 3
  LOAN_ANNUAL_RATE: 0.17,  // 年利率 17%

  // ========== 数据刷新 ==========
  PRICE_UPDATE_INTERVAL: 5000,  // 价格更新间隔 5 秒
  AUTO_SAVE_INTERVAL: 300000,   // 自动保存间隔 5 分钟
  SAVE_THROTTLE_INTERVAL: 30000, // 保存节流间隔 30 秒

  // ========== 市场配置 ==========
  PRICE_VOLATILITY: 0.02,      // 基础波动率 2%
  VOLUME_IMPACT_FACTOR: 0.0001, // 成交量对价格影响系数
  MAX_PRICE_CHANGE: 0.10,       // 单日最大涨跌幅 10%
  PRICE_UPDATE_RATIO: 0.25,      // 每 tick 更新股票比例 25%
  AI_PRICE_IMPACT: 0.0000001,   // AI 价格影响系数

  // ========== 游戏设置 ==========
  INITIAL_STOCK_COUNT: 50,      // 初始股票数量
  MAX_ORDERS_PER_STOCK: 100,    // 每只股票最大挂单数

  // ========== 数据限制 ==========
  MAX_PRICE_HISTORY_POINTS: 480,   // 价格历史最大点数
  MAX_TRANSACTION_RECORDS: 1000,    // 交易记录最大条数

  // ========== T+1 配置 ==========
  T1_DAYS: 1,                   // T+1 天数
} as const

export type GameConfig = typeof GameConfig
