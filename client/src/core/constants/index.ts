/**
 * 常量模块导出
 */

// 游戏配置
export { GameConfig } from './GameConfig'
export type { GameConfig as GameConfigType } from './GameConfig'

// 市场类型
export {
  MarketType,
  MarketTypeConfig,
  getMarketGroup,
  getMarketName,
  getMarketFeeRate,
  T0_MARKETS,
  T1_MARKETS,
} from './MarketType'
export type { MarketGroup } from './MarketType'

// 订单类型
export {
  OrderType,
  OrderMode,
  OrderStatus,
  OrderTypeNames,
  OrderModeNames,
  OrderStatusNames,
  OrderTypeColors,
  OrderStatusColors,
} from './OrderType'

// 成就列表
export {
  ACHIEVEMENT_LIST,
  AchievementCategories,
  getAchievementById,
  getAchievementsByConditionType,
} from './AchievementList'
