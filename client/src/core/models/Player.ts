import type { Position as PlayerPosition } from './Position'

// 玩家数据接口
export interface Player {
  id: string
  name: string // 玩家名称
  cash: number // 可用资金
  initialCash: number // 初始资金
  totalAssets: number // 总资产
  positions: PlayerPosition[] // 持仓列表
  createdAt: number // 创建时间
  usedGiftCodes: string[] // 已使用的礼包码
}

// 玩家统计信息
export interface PlayerStats {
  playerId: string
  totalTrades: number // 总交易次数
  buyCount: number // 买入次数
  sellCount: number // 卖出次数
  totalFee: number // 累计手续费
  currentWinRate: number // 胜率
  bestTrade: number // 最佳单笔交易
  worstTrade: number // 最差单笔交易
  holdingDays: number // 持仓天数
}

// 玩家设置
export interface PlayerSettings {
  playerId: string
  theme: 'light' | 'dark' // 主题
  soundEnabled: boolean // 声音开关
  notifications: boolean // 通知开关
  autoSave: boolean // 自动保存
  showProfit: boolean // 显示盈亏
  defaultOrderMode: 'MARKET' | 'LIMIT' // 默认下单模式
}
