/**
 * AI交易者数据模型定义
 */

import type { Position } from './Position'
import type { Transaction } from './Transaction'

// AI性格类型
export enum AIPersonality {
  AGGRESSIVE = 'AGGRESSIVE',     // 激进型 - 追涨杀跌，重仓操作
  CONSERVATIVE = 'CONSERVATIVE', // 保守型 - 稳健投资，轻仓操作
  RANDOM = 'RANDOM',             // 随机型 - 随机买卖，无明确策略
  TREND_FOLLOWER = 'TREND_FOLLOWER', // 趋势跟踪 - 顺势而为
  VALUE_INVESTOR = 'VALUE_INVESTOR', // 价值投资 - 低估买入，高估卖出
  PANIC_SELLER = 'PANIC_SELLER', // 恐慌型 - 大跌时卖出，大涨时追高
  SWING_TRADER = 'SWING_TRADER', // 短线交易 - 频繁买卖
  LONG_TERM = 'LONG_TERM',       // 长线持有 - 少操作，长期持有
  NOVICE_TRADER = 'NOVICE_TRADER',     // 新手交易者 - 追涨杀跌、频繁交易
  EMOTIONAL_TRADER = 'EMOTIONAL_TRADER', // 情绪化交易者 - 受情绪影响大
  VALUE_FOLLOWER = 'VALUE_FOLLOWER',   // 价值跟随者 - 模仿价值投资
  MOMENTUM_TRADER = 'MOMENTUM_TRADER', // 动量交易者 - 追涨杀跌
}

// 投资者类型（基于资金规模）
export enum TraderType {
  NOVICE = 'NOVICE',           // 新股民 10-50万
  RETAIL = 'RETAIL',           // 老散户 50-200万
  MEDIUM = 'MEDIUM',           // 中等散户 200-500万
  LARGE = 'LARGE',             // 大户 500-2000万
  WHALE = 'WHALE',             // 资金雄厚 2000万+
}

// 心理/情绪状态
export enum EmotionState {
  GREED = 'GREED',             // 贪婪 - 连续盈利后
  FEAR = 'FEAR',               // 恐惧 - 连续亏损后
  CONFIDENT = 'CONFIDENT',     // 自信 - 大赚后
  CAUTIOUS = 'CAUTIOUS',       // 谨慎 - 大亏后
  CALM = 'CALM',               // 平静 - 正常状态
  EXCITED = 'EXCITED',         // 兴奋 - 市场大涨
  PANIC = 'PANIC',             // 恐慌 - 市场大跌
}

// 行为偏差权重
export interface BehavioralBiases {
  lossAversion: number        // 损失厌恶程度 (0-1)
  dispositionEffect: number   // 处置效应 - 拿住亏损股 (0-1)
  overconfidence: number      // 过度自信 (0-1)
  herding: number             // 羊群效应 (0-1)
  anchoring: number           // 锚定效应 - 固守买入价 (0-1)
  confirmation: number        // 确认偏误 (0-1)
  hotHand: number             // 热手谬误 (0-1)
}

// 交易统计
export interface TraderStats {
  consecutiveWins: number     // 连续盈利次数
  consecutiveLosses: number    // 连续亏损次数
  totalWins: number            // 总盈利次数
  totalLosses: number          // 总亏损次数
  avgHoldingPeriod: number    // 平均持仓周期(天)
  lastTradeProfit: number     // 上次交易盈亏
  recentProfits: number[]      // 最近10次盈亏记录
  tradeDates: number[]         // 交易日期记录
}

// 投资者类型配置
export interface TraderTypeConfig {
  minFunds: number
  maxFunds: number
  riskTolerance: number        // 风险承受力 (0-100)
  experienceLevel: number      // 经验等级 (0-100)
  maxPositionRatio: number     // 最大持仓比例
  defaultTradeRatio: number    // 默认单笔交易比例
  tradeFrequency: number       // 交易频率 (0-1)
}

// 投资者类型配置映射
export const TRADER_TYPE_CONFIGS: Record<TraderType, TraderTypeConfig> = {
  [TraderType.NOVICE]: {
    minFunds: 100000,
    maxFunds: 500000,
    riskTolerance: 80,        // 新手风险承受力高（因为无知）
    experienceLevel: 20,      // 经验低
    maxPositionRatio: 0.9,     // 仓位高
    defaultTradeRatio: 0.3,   // 单笔交易比例
    tradeFrequency: 0.8,      // 频繁交易
  },
  [TraderType.RETAIL]: {
    minFunds: 500000,
    maxFunds: 2000000,
    riskTolerance: 60,
    experienceLevel: 50,
    maxPositionRatio: 0.7,
    defaultTradeRatio: 0.2,
    tradeFrequency: 0.5,
  },
  [TraderType.MEDIUM]: {
    minFunds: 2000000,
    maxFunds: 5000000,
    riskTolerance: 50,
    experienceLevel: 65,
    maxPositionRatio: 0.6,
    defaultTradeRatio: 0.15,
    tradeFrequency: 0.4,
  },
  [TraderType.LARGE]: {
    minFunds: 5000000,
    maxFunds: 20000000,
    riskTolerance: 40,
    experienceLevel: 80,
    maxPositionRatio: 0.5,
    defaultTradeRatio: 0.1,
    tradeFrequency: 0.3,
  },
  [TraderType.WHALE]: {
    minFunds: 20000000,
    maxFunds: 100000000,
    riskTolerance: 30,
    experienceLevel: 95,
    maxPositionRatio: 0.4,
    defaultTradeRatio: 0.05,
    tradeFrequency: 0.15,
  },
}

// AI交易者数据接口（扩展版）
export interface AITrader {
  id: string
  name: string                         // AI名称
  personality: AIPersonality           // 交易性格
  traderType?: TraderType              // 投资者类型（基于资金规模）
  cash: number                         // 可用资金
  positions: Position[]                // 持仓
  totalAssets: number                  // 总资产
  tradingHistory: Transaction[]        // 交易历史
  createdAt: number                    // 创建时间
  lastTradeTime: number                // 最后交易时间
  tradeCount: number                   // 交易次数
  profitLoss: number                   // 累计盈亏

  // 扩展字段
  experienceLevel?: number             // 经验等级 (0-100)
  riskTolerance?: number               // 风险承受力 (0-100)
  emotionState?: EmotionState          // 当前心理状态
  biases?: BehavioralBiases            // 行为偏差
  stats?: TraderStats                  // 交易统计
  preferredStocks?: string[]           // 偏好的股票代码
  lastMarketState?: 'bull' | 'bear' | 'neutral' // 上次市场状态
}

// AI决策结果
export interface AIDecision {
  action: 'BUY' | 'SELL' | 'HOLD'      // 交易动作
  stockCode?: string                   // 股票代码
  quantity?: number                    // 数量
  price?: number                       // 价格
  reason?: string                      // 决策原因
  confidence?: number                   // 决策置信度 (0-1)
  stopLoss?: number                    // 止损价格
  takeProfit?: number                  // 止盈价格
}

// AI交易统计
export interface AITraderStats {
  traderId: string
  totalTrades: number                  // 总交易次数
  buyCount: number                     // 买入次数
  sellCount: number                    // 卖出次数
  winCount: number                     // 盈利次数
  lossCount: number                    // 亏损次数
  totalProfit: number                  // 累计盈利
  totalLoss: number                    // 累计亏损
  maxProfit: number                    // 单笔最大盈利
  maxLoss: number                      // 单笔最大亏损
  currentWinRate: number               // 当前胜率
  avgHoldDays: number                  // 平均持仓天数
}

// AI配置
export interface AIConfig {
  traderCount: number                  // AI交易者数量
  minFunds: number                     // 最小资金
  maxFunds: number                     // 最大资金
  refillMin: number                    // 资金补充最小值
  refillMax: number                    // 资金补充最大值
  tradeInterval: number                // 交易间隔（毫秒）
  tradeProbability: number             // 每次周期交易的概率
  maxPositionRatio: number             // 最大持仓比例
  maxSingleTradeRatio: number          // 单笔最大交易比例
}

// 预设AI名称
export const AI_NAMES = [
  // 激进型
  '追风少年', '激进小王', '涨停敢死队', '短线高手', '暴富梦想家',
  // 保守型
  '稳健老张', '保守投资者', '养老计划', '稳扎稳打', '风险厌恶者',
  // 随机型
  '随机漫步', '抛硬币大师', '运气选手', '随心所欲', '随机应变',
  // 趋势跟踪
  '趋势追踪者', '顺势而为', '趋势高手', '波浪理论', '均线大师',
  // 价值投资
  '价值挖掘者', '长线价值', '巴菲特门徒', '低估猎手', '估值专家',
  // 恐慌型
  '惊弓之鸟', '恐慌抛售', '逃顶专家', '止损达人', '风控优先',
  // 短线交易
  '日内交易', '高频选手', '秒进秒出', '抢帽子', 'T+0达人',
  // 长线持有
  '长期主义', '定投达人', '复利奇迹', '价值持有', '股东心态',
  // 新手交易者
  '新股民小李', '追涨杀跌', '股市新人', '跟风买入', '啥都不懂',
  // 情绪化交易者
  '心跳选手', '情绪波动', '追涨恐慌', '心态炸裂', '梭哈一把',
  // 价值跟随者
  '价值粉', '低估买入', '长期持有', '慢慢变富', '估值为准',
  // 动量交易者
  '追涨王', '杀跌王', '趋势为王', '顺势交易', '动量选手',
]

// 获取性格描述
export function getPersonalityDescription(personality: AIPersonality): string {
  switch (personality) {
    case AIPersonality.AGGRESSIVE:
      return '激进型 - 追求高收益，愿意承担高风险'
    case AIPersonality.CONSERVATIVE:
      return '保守型 - 稳健投资，风险控制优先'
    case AIPersonality.RANDOM:
      return '随机型 - 随机买卖，完全凭运气'
    case AIPersonality.TREND_FOLLOWER:
      return '趋势跟踪 - 顺势而为，追涨杀跌'
    case AIPersonality.VALUE_INVESTOR:
      return '价值投资 - 低估买入，高估卖出'
    case AIPersonality.PANIC_SELLER:
      return '恐慌型 - 大跌时恐慌卖出'
    case AIPersonality.SWING_TRADER:
      return '短线交易 - 频繁波段操作'
    case AIPersonality.LONG_TERM:
      return '长线持有 - 少操作，长期投资'
    case AIPersonality.NOVICE_TRADER:
      return '新手交易者 - 追涨杀跌，缺乏经验'
    case AIPersonality.EMOTIONAL_TRADER:
      return '情绪化交易者 - 受情绪影响大'
    case AIPersonality.VALUE_FOLLOWER:
      return '价值跟随者 - 模仿价值投资'
    case AIPersonality.MOMENTUM_TRADER:
      return '动量交易者 - 追涨杀跌'
    default:
      return '未知性格'
  }
}

// 获取性格对应的emoji
export function getPersonalityEmoji(personality: AIPersonality): string {
  switch (personality) {
    case AIPersonality.AGGRESSIVE:
      return '🔥'
    case AIPersonality.CONSERVATIVE:
      return '🛡️'
    case AIPersonality.RANDOM:
      return '🎲'
    case AIPersonality.TREND_FOLLOWER:
      return '📈'
    case AIPersonality.VALUE_INVESTOR:
      return '💎'
    case AIPersonality.PANIC_SELLER:
      return '😱'
    case AIPersonality.SWING_TRADER:
      return '⚡'
    case AIPersonality.LONG_TERM:
      return '🏔️'
    case AIPersonality.NOVICE_TRADER:
      return '🐣'
    case AIPersonality.EMOTIONAL_TRADER:
      return '🎢'
    case AIPersonality.VALUE_FOLLOWER:
      return '📚'
    case AIPersonality.MOMENTUM_TRADER:
      return '💨'
    default:
      return '🤖'
  }
}

// 默认AI配置
export const DEFAULT_AI_CONFIG: AIConfig = {
  traderCount: 1000,
  minFunds: 500000,
  maxFunds: 50000000,
  refillMin: 500000,
  refillMax: 50000000,
  tradeInterval: 5000,
  tradeProbability: 0.3,
  maxPositionRatio: 0.8,
  maxSingleTradeRatio: 0.2,
}
