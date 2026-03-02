/**
 * 订单数据模型定义
 */

// 订单类型
export enum OrderType {
  BUY = 'BUY',
  SELL = 'SELL',
}

// 订单模式
export enum OrderMode {
  MARKET = 'MARKET', // 市价单
  LIMIT = 'LIMIT',   // 限价单
}

// 订单状态
export enum OrderStatus {
  PENDING = 'PENDING',   // 待执行
  EXECUTED = 'EXECUTED', // 已执行
  CANCELLED = 'CANCELLED', // 已撤销
  PARTIAL = 'PARTIAL',   // 部分成交
}

// 订单数据接口
export interface Order {
  id: string;
  playerId: string;
  stockCode: string;
  stockName?: string;
  type: OrderType;       // 买入/卖出
  orderMode: OrderMode;  // 市价/限价
  quantity: number;      // 委托数量
  price?: number;       // 限价单价格
  executedQuantity?: number; // 已成交数量
  executedPrice?: number;    // 成交价格
  status: OrderStatus;
  createdAt: number;
  executedAt?: number;
  fee: number;          // 手续费
}

// 限价单匹配结果
export interface OrderMatchResult {
  orderId: string;
  matched: boolean;
  executedQuantity: number;
  executedPrice: number;
  remainingQuantity: number;
}
