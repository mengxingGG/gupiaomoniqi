/**
 * 股票数据模型定义
 */

// 市场类型枚举
export enum MarketType {
  A_SHARE_T1 = 'A_SHARE_T1',       // A股主板 T+1
  GEM_T1 = 'GEM_T1',               // 创业板 T+1
  STAR_T1 = 'STAR_T1',             // 科创板 T+1
  FUTURES_T0 = 'FUTURES_T0',       // 期货 T+0
  HK_STOCK_T0 = 'HK_STOCK_T0',     // 港股通 T+0
  US_STOCK_T0 = 'US_STOCK_T0',     // 美股 T+0
}

// 市场分组（用于UI展示）
export type MarketGroup = 'T0' | 'T1';

// 获取市场分组
export function getMarketGroup(market: MarketType): MarketGroup {
  switch (market) {
    case MarketType.A_SHARE_T1:
    case MarketType.GEM_T1:
    case MarketType.STAR_T1:
      return 'T1';
    case MarketType.FUTURES_T0:
    case MarketType.HK_STOCK_T0:
    case MarketType.US_STOCK_T0:
      return 'T0';
    default:
      return 'T1';
  }
}

// 获取市场中文名称
export function getMarketName(market: MarketType): string {
  switch (market) {
    case MarketType.A_SHARE_T1:
      return 'A股主板';
    case MarketType.GEM_T1:
      return '创业板';
    case MarketType.STAR_T1:
      return '科创板';
    case MarketType.FUTURES_T0:
      return '期货';
    case MarketType.HK_STOCK_T0:
      return '港股通';
    case MarketType.US_STOCK_T0:
      return '美股';
    default:
      return '未知';
  }
}

// 价格数据点（用于K线图）
export interface PricePoint {
  time: number;      // 时间戳
  price: number;     // 价格
  volume: number;    // 成交量
  high?: number;     // 最高价（K线用）
  low?: number;      // 最低价（K线用）
  open?: number;     // 开盘价（K线用）
  close?: number;    // 收盘价（K线用）
}

// 股票数据接口
export interface Stock {
  code: string;              // 股票代码
  name: string;              // 股票名称
  market: MarketType;        // 市场类型
  industry?: string;         // 行业
  currentPrice: number;      // 当前价格
  previousClose: number;     // 昨收价
  openPrice: number;         // 开盘价
  highPrice: number;         // 最高价
  lowPrice: number;          // 最低价
  volume: number;            // 成交量
  turnover: number;          // 成交额
  changePercent: number;     // 涨跌幅
  changeAmount: number;      // 涨跌额
  priceHistory: PricePoint[]; // 价格历史（用于K线）
  lastUpdate: number;        // 最后更新时间
}

// 股票筛选条件
export interface StockFilter {
  keyword?: string;          // 搜索关键词（代码/名称）
  market?: MarketType;       // 市场类型
  industry?: string;         // 行业
  minPrice?: number;         // 最低价格
  maxPrice?: number;         // 最高价格
  minChange?: number;        // 最小涨跌幅
  maxChange?: number;        // 最大涨跌幅
}

// 排序选项
export type SortField = 'code' | 'name' | 'currentPrice' | 'changePercent' | 'volume' | 'turnover';
export type SortOrder = 'asc' | 'desc';

export interface SortOption {
  field: SortField;
  order: SortOrder;
}

// 原始股票数据（从API获取）
export interface RawStockData {
  code: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
  prevClose: number;
}
