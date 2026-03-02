/**
 * 成就列表常量定义
 */

import { AchievementConditionType, AchievementDefinition } from '../models/Achievement'

/**
 * 成就列表定义
 */
export const ACHIEVEMENT_LIST: AchievementDefinition[] = [
  // ========== 交易成就 ==========
  {
    id: 'first_trade',
    name: '初出茅庐',
    description: '完成第一笔交易',
    icon: '📈',
    condition: {
      type: AchievementConditionType.TRADE_COUNT,
      value: 1,
    },
  },
  {
    id: 'trade_10',
    name: '小试牛刀',
    description: '完成10笔交易',
    icon: '💹',
    condition: {
      type: AchievementConditionType.TRADE_COUNT,
      value: 10,
    },
  },
  {
    id: 'trade_50',
    name: '交易老手',
    description: '完成50笔交易',
    icon: '📊',
    condition: {
      type: AchievementConditionType.TRADE_COUNT,
      value: 50,
    },
  },
  {
    id: 'trade_100',
    name: '交易高手',
    description: '完成100笔交易',
    icon: '🏆',
    condition: {
      type: AchievementConditionType.TRADE_COUNT,
      value: 100,
    },
  },
  {
    id: 'trade_500',
    name: '交易大师',
    description: '完成500笔交易',
    icon: '👑',
    condition: {
      type: AchievementConditionType.TRADE_COUNT,
      value: 500,
    },
  },

  // ========== 盈利成就 ==========
  {
    id: 'first_profit',
    name: '首战告捷',
    description: '首次实现单笔盈利',
    icon: '🎯',
    condition: {
      type: AchievementConditionType.SINGLE_PROFIT,
      value: 1,
    },
    reward: 100000,
  },
  {
    id: 'profit_10k',
    name: '小有斩获',
    description: '单笔盈利达到1万元',
    icon: '💰',
    condition: {
      type: AchievementConditionType.SINGLE_PROFIT,
      value: 10000,
    },
  },
  {
    id: 'profit_100k',
    name: '盆满钵满',
    description: '单笔盈利达到10万元',
    icon: '💎',
    condition: {
      type: AchievementConditionType.SINGLE_PROFIT,
      value: 100000,
    },
  },
  {
    id: 'profit_1m',
    name: '日进斗金',
    description: '单笔盈利达到100万元',
    icon: '🌟',
    condition: {
      type: AchievementConditionType.SINGLE_PROFIT,
      value: 1000000,
    },
  },

  // ========== 资产成就 ==========
  {
    id: 'assets_2x',
    name: '资金翻倍',
    description: '总资产达到初始资金的2倍',
    icon: '📈',
    condition: {
      type: AchievementConditionType.ASSETS_REACH,
      value: 2,
    },
    reward: 500000,
  },
  {
    id: 'assets_5x',
    name: '资产爆发',
    description: '总资产达到初始资金的5倍',
    icon: '🚀',
    condition: {
      type: AchievementConditionType.ASSETS_REACH,
      value: 5,
    },
    reward: 1000000,
  },
  {
    id: 'assets_10x',
    name: '财富传奇',
    description: '总资产达到初始资金的10倍',
    icon: '🏦',
    condition: {
      type: AchievementConditionType.ASSETS_REACH,
      value: 10,
    },
    reward: 5000000,
  },
  {
    id: 'millionaire',
    name: '百万富翁',
    description: '总资产达到100万元',
    icon: '💵',
    condition: {
      type: AchievementConditionType.ASSETS_REACH,
      value: 1000000,
    },
  },
  {
    id: 'ten_million',
    name: '千万富翁',
    description: '总资产达到1000万元',
    icon: '🏰',
    condition: {
      type: AchievementConditionType.ASSETS_REACH,
      value: 10000000,
    },
  },
  {
    id: 'hundred_million',
    name: '亿万富翁',
    description: '总资产达到1亿元',
    icon: '🌈',
    condition: {
      type: AchievementConditionType.ASSETS_REACH,
      value: 100000000,
    },
  },

  // ========== 持仓成就 ==========
  {
    id: 'diversified',
    name: '分散投资',
    description: '同时持有5只以上股票',
    icon: '🎨',
    condition: {
      type: AchievementConditionType.HOLD_STOCK_COUNT,
      value: 5,
    },
  },
  {
    id: 'highly_diversified',
    name: '多元化',
    description: '同时持有10只以上股票',
    icon: '🌈',
    condition: {
      type: AchievementConditionType.HOLD_STOCK_COUNT,
      value: 10,
    },
  },
  {
    id: 'highly_diversified_20',
    name: '超级分散',
    description: '同时持有20只以上股票',
    icon: '🎭',
    condition: {
      type: AchievementConditionType.HOLD_STOCK_COUNT,
      value: 20,
    },
  },

  // ========== 亏损成就（反向激励） ==========
  {
    id: 'first_loss',
    name: '初尝败绩',
    description: '首次出现单笔亏损',
    icon: '📉',
    condition: {
      type: AchievementConditionType.SINGLE_LOSS,
      value: 1,
    },
  },
  {
    id: 'loss_10k',
    name: '小亏怡情',
    description: '单笔亏损达到1万元',
    icon: '🔻',
    condition: {
      type: AchievementConditionType.SINGLE_LOSS,
      value: 10000,
    },
  },
  {
    id: 'loss_100k',
    name: '大幅回撤',
    description: '单笔亏损达到10万元',
    icon: '⬇️',
    condition: {
      type: AchievementConditionType.SINGLE_LOSS,
      value: 100000,
    },
  },

  // ========== 借贷成就 ==========
  {
    id: 'first_borrow',
    name: '资金杠杆',
    description: '首次使用借款功能',
    icon: '🏦',
    condition: {
      type: AchievementConditionType.BORROW_COUNT,
      value: 1,
    },
  },
  {
    id: 'borrow_5',
    name: '杠杆老手',
    description: '使用借款功能5次',
    icon: '💳',
    condition: {
      type: AchievementConditionType.BORROW_COUNT,
      value: 5,
    },
  },

  // ========== 礼包码成就 ==========
  {
    id: 'use_gift_code',
    name: '礼包达人',
    description: '首次使用礼包码',
    icon: '🎁',
    condition: {
      type: AchievementConditionType.USE_GIFT_CODE,
      value: 1,
    },
  },
]

/**
 * 成就分类
 */
export const AchievementCategories = {
  TRADE: {
    id: 'trade',
    name: '交易成就',
    achievements: ACHIEVEMENT_LIST.filter(a => a.id.startsWith('trade_') || a.id === 'first_trade'),
  },
  PROFIT: {
    id: 'profit',
    name: '盈利成就',
    achievements: ACHIEVEMENT_LIST.filter(a => a.id.startsWith('profit_') || a.id === 'first_profit'),
  },
  ASSETS: {
    id: 'assets',
    name: '资产成就',
    achievements: ACHIEVEMENT_LIST.filter(a => a.id.startsWith('assets_') || a.id === 'millionaire' || a.id === 'ten_million' || a.id === 'hundred_million'),
  },
  HOLDING: {
    id: 'holding',
    name: '持仓成就',
    achievements: ACHIEVEMENT_LIST.filter(a => a.id.startsWith('diversified') || a.id.startsWith('highly_diversified')),
  },
  LOSS: {
    id: 'loss',
    name: '亏损成就',
    achievements: ACHIEVEMENT_LIST.filter(a => a.id.startsWith('loss_') || a.id === 'first_loss'),
  },
  LOAN: {
    id: 'loan',
    name: '借贷成就',
    achievements: ACHIEVEMENT_LIST.filter(a => a.id.startsWith('borrow_') || a.id === 'first_borrow'),
  },
  GIFT: {
    id: 'gift',
    name: '礼包成就',
    achievements: ACHIEVEMENT_LIST.filter(a => a.id === 'use_gift_code'),
  },
} as const

/**
 * 根据ID获取成就定义
 */
export function getAchievementById(id: string): AchievementDefinition | undefined {
  return ACHIEVEMENT_LIST.find(a => a.id === id)
}

/**
 * 根据条件类型获取成就列表
 */
export function getAchievementsByConditionType(type: AchievementConditionType): AchievementDefinition[] {
  return ACHIEVEMENT_LIST.filter(a => a.condition.type === type)
}
