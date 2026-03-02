/**
 * 计算工具函数
 */

import { GameConfig } from '../constants/GameConfig'

/**
 * 计算手续费
 */
export class Calculator {
  /**
   * 计算买入手续费
   * @param amount 交易金额
   * @returns 手续费
   */
  static calculateBuyFee(amount: number): number {
    return amount * GameConfig.BUY_FEE_RATE
  }

  /**
   * 计算卖出手续费
   * @param amount 交易金额
   * @returns 手续费
   */
  static calculateSellFee(amount: number): number {
    return amount * GameConfig.SELL_FEE_RATE
  }

  /**
   * 计算买入总成本（含手续费）
   * @param price 买入价格
   * @param quantity 买入数量
   * @returns 总成本
   */
  static calculateBuyCost(price: number, quantity: number): number {
    const amount = price * quantity
    const fee = this.calculateBuyFee(amount)
    return amount + fee
  }

  /**
   * 计算卖出总收入（扣除手续费）
   * @param price 卖出价格
   * @param quantity 卖出数量
   * @returns 总收入
   */
  static calculateSellRevenue(price: number, quantity: number): number {
    const amount = price * quantity
    const fee = this.calculateSellFee(amount)
    return amount - fee
  }

  /**
   * 计算盈亏金额
   * @param sellPrice 卖出价格
   * @param buyPrice 买入价格
   * @param quantity 数量
   * @returns 盈亏金额
   */
  static calculateProfit(sellPrice: number, buyPrice: number, quantity: number): number {
    const revenue = this.calculateSellRevenue(sellPrice, quantity)
    const cost = this.calculateBuyCost(buyPrice, quantity)
    return revenue - cost
  }

  /**
   * 计算盈亏百分比
   * @param sellPrice 卖出价格
   * @param buyPrice 买入价格
   * @returns 盈亏百分比
   */
  static calculateProfitPercent(sellPrice: number, buyPrice: number): number {
    if (buyPrice === 0) return 0
    return ((sellPrice - buyPrice) / buyPrice) * 100
  }

  /**
   * 计算涨跌幅
   * @param currentPrice 当前价格
   * @param previousPrice 前一价格
   * @returns 涨跌幅百分比
   */
  static calculateChangePercent(currentPrice: number, previousPrice: number): number {
    if (previousPrice === 0) return 0
    return ((currentPrice - previousPrice) / previousPrice) * 100
  }

  /**
   * 计算涨跌额
   * @param currentPrice 当前价格
   * @param previousPrice 前一价格
   * @returns 涨跌额
   */
  static calculateChangeAmount(currentPrice: number, previousPrice: number): number {
    return currentPrice - previousPrice
  }

  /**
   * 计算持仓市值
   * @param quantity 持仓数量
   * @param currentPrice 当前价格
   * @returns 市值
   */
  static calculateMarketValue(quantity: number, currentPrice: number): number {
    return quantity * currentPrice
  }

  /**
   * 计算持仓成本
   * @param quantity 持仓数量
   * @param averageCost 平均成本
   * @returns 总成本
   */
  static calculateTotalCost(quantity: number, averageCost: number): number {
    return quantity * averageCost
  }

  /**
   * 计算持仓盈亏
   * @param quantity 持仓数量
   * @param averageCost 平均成本
   * @param currentPrice 当前价格
   * @returns 盈亏金额
   */
  static calculatePositionProfit(
    quantity: number,
    averageCost: number,
    currentPrice: number
  ): number {
    const marketValue = this.calculateMarketValue(quantity, currentPrice)
    const totalCost = this.calculateTotalCost(quantity, averageCost)
    return marketValue - totalCost
  }

  /**
   * 计算持仓盈亏百分比
   * @param averageCost 平均成本
   * @param currentPrice 当前价格
   * @returns 盈亏百分比
   */
  static calculatePositionProfitPercent(averageCost: number, currentPrice: number): number {
    return this.calculateProfitPercent(currentPrice, averageCost)
  }

  /**
   * 计算总资产
   * @param cash 现金
   * @param positions 持仓市值
   * @returns 总资产
   */
  static calculateTotalAssets(cash: number, positions: number): number {
    return cash + positions
  }

  /**
   * 计算所有持仓的市值
   * @param positions 持仓列表
   * @param stocks 股票价格映射
   * @returns 总持仓市值
   */
  static calculatePositionsValue(
    positions: Array<{ stockCode: string; quantity: number; averageCost: number }>,
    stocks: Map<string, number>
  ): number {
    let positionsValue = 0
    for (const position of positions) {
      const currentPrice = stocks.get(position.stockCode) || position.averageCost
      positionsValue += currentPrice * position.quantity
    }
    return positionsValue
  }

  /**
   * 计算借款上限
   * @param principal 本金
   * @returns 借款上限
   */
  static calculateMaxBorrowAmount(principal: number): number {
    return principal * GameConfig.LOAN_MULTIPLIER
  }

  /**
   * 计算利息
   * @param principal 本金
   * @param annualRate 年利率
   * @param days 天数
   * @returns 利息
   */
  static calculateInterest(principal: number, annualRate: number, days: number): number {
    const dailyRate = annualRate / 365
    return principal * dailyRate * days
  }

  /**
   * 计算可买入的最大数量
   * @param cash 可用资金
   * @param price 股票价格
   * @returns 最大可买数量
   */
  static calculateMaxBuyQuantity(cash: number, price: number): number {
    const totalWithFee = cash
    const priceWithFee = price * (1 + GameConfig.BUY_FEE_RATE)
    return Math.floor(totalWithFee / priceWithFee)
  }

  /**
   * 计算平均成本（加仓时）
   * @param oldQuantity 原持仓数量
   * @param oldCost 原平均成本
   * @param newQuantity 新买入数量
   * @param newPrice 新买入价格
   * @returns 新的平均成本
   */
  static calculateAverageCost(
    oldQuantity: number,
    oldCost: number,
    newQuantity: number,
    newPrice: number
  ): number {
    const totalQuantity = oldQuantity + newQuantity
    if (totalQuantity === 0) return 0

    const totalCost = oldQuantity * oldCost + newQuantity * newPrice
    return totalCost / totalQuantity
  }

  /**
   * 价格波动计算
   * @param currentPrice 当前价格
   * @param volatility 波动率
   * @returns 波动后的价格
   */
  static calculatePriceVolatility(currentPrice: number, volatility: number): number {
    const change = currentPrice * volatility * (Math.random() * 2 - 1)
    return Math.max(0.01, currentPrice + change) // 确保价格不为负
  }

  /**
   * 计算成交量对价格的影响
   * @param currentPrice 当前价格
   * @param buyVolume 买入量
   * @param sellVolume 卖出量
   * @param totalVolume 总流通量
   * @returns 价格变动
   */
  static calculateVolumeImpact(
    currentPrice: number,
    buyVolume: number,
    sellVolume: number,
    totalVolume: number
  ): number {
    if (totalVolume === 0) return 0

    const buyPressure = buyVolume / totalVolume
    const sellPressure = sellVolume / totalVolume
    const netPressure = buyPressure - sellPressure

    return currentPrice * netPressure * GameConfig.VOLUME_IMPACT_FACTOR
  }

  /**
   * 四舍五入到指定小数位
   * @param value 数值
   * @param decimals 小数位数
   * @returns 四舍五入后的值
   */
  static round(value: number, decimals: number = 2): number {
    const multiplier = Math.pow(10, decimals)
    return Math.round(value * multiplier) / multiplier
  }

  /**
   * 向下取整到价格最小变动单位
   * @param price 价格
   * @returns 取整后的价格
   */
  static floorPrice(price: number): number {
    return Math.floor(price / GameConfig.PRICE_TICK) * GameConfig.PRICE_TICK
  }

  /**
   * 向上取整到价格最小变动单位
   * @param price 价格
   * @returns 取整后的价格
   */
  static ceilPrice(price: number): number {
    return Math.ceil(price / GameConfig.PRICE_TICK) * GameConfig.PRICE_TICK
  }
}
