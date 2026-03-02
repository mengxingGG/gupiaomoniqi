/**
 * 交易记录数据模型定义
 */

import type { OrderType } from './Order';

// 交易记录数据接口
export interface Transaction {
  id: string;
  playerId: string;
  stockCode: string;
  stockName?: string;
  type: OrderType;       // 买入/卖出
  quantity: number;     // 成交数量
  price: number;        // 成交价格
  total: number;        // 成交金额
  fee: number;          // 手续费
  createdAt: number;
}

// 交易汇总
export interface TransactionSummary {
  totalBuyCount: number;      // 买入次数
  totalSellCount: number;     // 卖出次数
  totalBuyAmount: number;    // 买入总额
  totalSellAmount: number;   // 卖出总额
  totalFee: number;          // 总手续费
  totalProfit: number;       // 总盈亏
}
