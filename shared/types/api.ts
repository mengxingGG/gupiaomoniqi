// API 类型定义

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export interface User {
  userId: string;
  username: string;
  displayName: string;
}

export interface Player {
  id: string;
  cash: number;
  initialCash: number;
  totalAssets: number;
  tradingDay: number;
  isPaused: number;
  updatedAt: number;
}

export interface Stock {
  code: string;
  name: string;
  market: string;
  industry?: string;
  currentPrice: number;
  previousClose: number;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  volume: number;
  turnover: number;
  changePercent: number;
  changeAmount: number;
  priceHistory: string;
  updatedAt: number;
}

export interface Position {
  id: string;
  playerId: string;
  stockCode: string;
  stockName: string;
  market: string;
  quantity: number;
  availableQuantity: number;
  averageCost: number;
  totalCost: number;
  buyDate: number;
}

export interface Order {
  id: string;
  playerId: string;
  stockCode: string;
  stockName: string;
  type: 'BUY' | 'SELL';
  orderMode: 'MARKET' | 'LIMIT';
  quantity: number;
  price?: number;
  executedPrice?: number;
  status: 'PENDING' | 'EXECUTED' | 'CANCELLED';
  fee: number;
  createdAt: number;
  executedAt?: number;
}

export interface Transaction {
  id: string;
  playerId: string;
  stockCode: string;
  stockName: string;
  type: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  total: number;
  fee: number;
  createdAt: number;
}

export interface Loan {
  id: string;
  playerId: string;
  principal: number;
  interest: number;
  annualRate: number;
  status: 'ACTIVE' | 'REPAID';
  borrowDate: number;
  lastInterestAt: number;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  unlocked: boolean;
  unlockedAt?: number;
}

export interface RankingEntry {
  rank: number;
  playerId: string;
  displayName: string;
  totalAssets: number;
  cash: number;
  profit: number;
  profitPercent: number;
}
