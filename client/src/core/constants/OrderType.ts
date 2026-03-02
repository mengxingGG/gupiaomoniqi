/**
 * 订单类型常量定义
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
  PENDING = 'PENDING',     // 待执行
  EXECUTED = 'EXECUTED',   // 已执行
  CANCELLED = 'CANCELLED', // 已撤销
  PARTIAL = 'PARTIAL',     // 部分成交
}

// 订单类型名称映射
export const OrderTypeNames: Record<OrderType, string> = {
  [OrderType.BUY]: '买入',
  [OrderType.SELL]: '卖出',
}

// 订单模式名称映射
export const OrderModeNames: Record<OrderMode, string> = {
  [OrderMode.MARKET]: '市价',
  [OrderMode.LIMIT]: '限价',
}

// 订单状态名称映射
export const OrderStatusNames: Record<OrderStatus, string> = {
  [OrderStatus.PENDING]: '待执行',
  [OrderStatus.EXECUTED]: '已执行',
  [OrderStatus.CANCELLED]: '已撤销',
  [OrderStatus.PARTIAL]: '部分成交',
}

// 订单类型颜色映射
export const OrderTypeColors: Record<OrderType, string> = {
  [OrderType.BUY]: '#ff4d4f',   // 红色
  [OrderType.SELL]: '#52c41a', // 绿色
}

// 订单状态颜色映射
export const OrderStatusColors: Record<OrderStatus, string> = {
  [OrderStatus.PENDING]: '#faad14',   // 黄色
  [OrderStatus.EXECUTED]: '#52c41a',  // 绿色
  [OrderStatus.CANCELLED]: '#8c8c8f', // 灰色
  [OrderStatus.PARTIAL]: '#1890ff',   // 蓝色
}
