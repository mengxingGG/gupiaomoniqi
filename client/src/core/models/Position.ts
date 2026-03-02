/**
 * 持仓数据模型定义
 */

// 持仓数据接口
export interface Position {
  id: string;
  playerId: string;
  stockCode: string;
  stockName?: string;
  quantity: number;            // 持仓数量
  availableQuantity: number;  // 可卖数量（T+1考虑）
  averageCost: number;        // 持仓成本（平均价）
  totalCost: number;         // 总成本
  buyDate: number;           // 买入日期（用于T+1判断）
  market: string;            // 市场类型
}

// 持仓盈亏
export interface PositionProfit {
  positionId: string;
  stockCode: string;
  quantity: number;
  currentValue: number;   // 当前市值
  cost: number;          // 成本
  profit: number;        // 盈亏金额
  profitPercent: number; // 盈亏比例
}
