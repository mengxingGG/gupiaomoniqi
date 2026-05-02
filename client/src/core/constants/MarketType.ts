/**
 * 市场类型常量定义
 */

export enum MarketType {
  A_SHARE_T1 = 'A_SHARE_T1',
  GEM_T1 = 'GEM_T1',
  STAR_T1 = 'STAR_T1',
  FUTURES_T0 = 'FUTURES_T0',
  HK_STOCK_T0 = 'HK_STOCK_T0',
  US_STOCK_T0 = 'US_STOCK_T0',
}

export type MarketGroup = 'T0' | 'T1'

export const MarketTypeConfig: Record<
  MarketType,
  { name: string; group: MarketGroup; feeRate: number }
> = {
  [MarketType.A_SHARE_T1]: {
    name: 'A股主板',
    group: 'T1',
    feeRate: 0.0003,
  },
  [MarketType.GEM_T1]: {
    name: '创业板',
    group: 'T1',
    feeRate: 0.0003,
  },
  [MarketType.STAR_T1]: {
    name: '科创板',
    group: 'T1',
    feeRate: 0.0002,
  },
  [MarketType.FUTURES_T0]: {
    name: '期货',
    group: 'T0',
    feeRate: 0.0001,
  },
  [MarketType.HK_STOCK_T0]: {
    name: '港股通',
    group: 'T0',
    feeRate: 0.001,
  },
  [MarketType.US_STOCK_T0]: {
    name: '美股',
    group: 'T0',
    feeRate: 0.001,
  },
}

export function getMarketGroup(market: MarketType): MarketGroup {
  return MarketTypeConfig[market]?.group ?? 'T1'
}

export function getMarketName(market: MarketType): string {
  return MarketTypeConfig[market]?.name ?? '未知'
}

export function getMarketFeeRate(market: MarketType): number {
  return MarketTypeConfig[market]?.feeRate ?? 0.0003
}

export const T0_MARKETS: MarketType[] = [
  MarketType.FUTURES_T0,
  MarketType.HK_STOCK_T0,
  MarketType.US_STOCK_T0,
]

export const T1_MARKETS: MarketType[] = [
  MarketType.A_SHARE_T1,
  MarketType.GEM_T1,
  MarketType.STAR_T1,
]