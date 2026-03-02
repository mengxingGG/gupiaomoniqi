/**
 * 成就数据模型定义
 */

// 成就解锁记录
export interface Achievement {
  id: string;           // 成就ID
  unlockedAt: number;   // 解锁时间
}

// 成就定义
export interface AchievementDefinition {
  id: string;
  name: string;
  description: string;
  icon?: string;
  condition: AchievementCondition;
  reward?: number;       // 奖励金额
}

// 成就条件
export interface AchievementCondition {
  type: AchievementConditionType;
  value: number;
}

// 成就条件类型
export enum AchievementConditionType {
  TRADE_COUNT = 'TRADE_COUNT',       // 交易次数
  TOTAL_PROFIT = 'TOTAL_PROFIT',     // 总盈利
  ASSETS_REACH = 'ASSETS_REACH',    // 资产达到
  HOLD_STOCK_COUNT = 'HOLD_STOCK_COUNT', // 持仓股票数量
  SINGLE_PROFIT = 'SINGLE_PROFIT',  // 单笔盈利
  SINGLE_LOSS = 'SINGLE_LOSS',      // 单笔亏损
  BORROW_COUNT = 'BORROW_COUNT',    // 借款次数
  USE_GIFT_CODE = 'USE_GIFT_CODE',  // 使用礼包码
}

// 成就进度
export interface AchievementProgress {
  definition: AchievementDefinition;
  progress: number;     // 当前进度
  target: number;       // 目标值
  isUnlocked: boolean;  // 是否已解锁
}
