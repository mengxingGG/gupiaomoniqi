/**
 * 验证工具函数
 */

import { GameConfig } from '../constants/GameConfig'

/**
 * 验证工具类
 */
export class Validator {
  /**
   * 验证是否为有效数字
   * @param value 值
   * @returns 是否有效
   */
  static isValidNumber(value: any): boolean {
    return typeof value === 'number' && !isNaN(value) && isFinite(value)
  }

  /**
   * 验证是否为正数
   * @param value 值
   * @returns 是否为正数
   */
  static isPositive(value: number): boolean {
    return this.isValidNumber(value) && value > 0
  }

  /**
   * 验证是否为非负数
   * @param value 值
   * @returns 是否为非负数
   */
  static isNonNegative(value: number): boolean {
    return this.isValidNumber(value) && value >= 0
  }

  /**
   * 验证是否为整数
   * @param value 值
   * @returns 是否为整数
   */
  static isInteger(value: number): boolean {
    return this.isValidNumber(value) && Number.isInteger(value)
  }

  /**
   * 验证股票代码格式
   * @param code 股票代码
   * @returns 是否有效
   */
  static isValidStockCode(code: string): boolean {
    // 6位数字
    const pattern = /^\d{6}$/
    return pattern.test(code)
  }

  /**
   * 验证价格是否有效
   * @param price 价格
   * @returns 是否有效
   */
  static isValidPrice(price: number): boolean {
    return this.isPositive(price) && price >= GameConfig.PRICE_TICK
  }

  /**
   * 验证数量是否有效
   * @param quantity 数量
   * @returns 是否有效
   */
  static isValidQuantity(quantity: number): boolean {
    return this.isInteger(quantity) && quantity > 0
  }

  /**
   * 验证交易金额是否满足最小要求
   * @param amount 金额
   * @returns 是否满足
   */
  static isValidTradeAmount(amount: number): boolean {
    return this.isPositive(amount) && amount >= GameConfig.MIN_TRADE_AMOUNT
  }

  /**
   * 验证是否有足够资金
   * @param availableCash 可用资金
   * @param requiredAmount 所需金额
   * @returns 是否足够
   */
  static hasEnoughCash(availableCash: number, requiredAmount: number): boolean {
    return this.isNonNegative(availableCash) && availableCash >= requiredAmount
  }

  /**
   * 验证是否有足够持仓
   * @param availableQuantity 可用数量
   * @param requiredQuantity 所需数量
   * @returns 是否足够
   */
  static hasEnoughQuantity(availableQuantity: number, requiredQuantity: number): boolean {
    return this.isNonNegative(availableQuantity) && availableQuantity >= requiredQuantity
  }

  /**
   * 验证涨跌幅是否在允许范围内
   * @param changePercent 涨跌幅
   * @returns 是否在范围内
   */
  static isWithinPriceLimit(changePercent: number): boolean {
    return Math.abs(changePercent) <= GameConfig.MAX_PRICE_CHANGE * 100
  }

  /**
   * 验证借款金额是否在允许范围内
   * @param amount 借款金额
   * @param principal 本金
   * @returns 是否在范围内
   */
  static isValidBorrowAmount(amount: number, principal: number): boolean {
    if (!this.isPositive(amount)) return false
    const maxBorrow = principal * GameConfig.LOAN_MULTIPLIER
    return amount <= maxBorrow
  }

  /**
   * 验证礼包码格式
   * @param code 礼包码
   * @returns 是否有效
   */
  static isValidGiftCode(code: string): boolean {
    // 字母数字组合，长度4-20
    const pattern = /^[A-Za-z0-9]{4,20}$/
    return pattern.test(code)
  }

  /**
   * 验证手机号格式
   * @param phone 手机号
   * @returns 是否有效
   */
  static isValidPhone(phone: string): boolean {
    const pattern = /^1[3-9]\d{9}$/
    return pattern.test(phone)
  }

  /**
   * 验证邮箱格式
   * @param email 邮箱
   * @returns 是否有效
   */
  static isValidEmail(email: string): boolean {
    const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    return pattern.test(email)
  }

  /**
   * 验证身份证号格式
   * @param idCard 身份证号
   * @returns 是否有效
   */
  static isValidIdCard(idCard: string): boolean {
    // 18位身份证号
    const pattern = /^\d{17}[\dXx]$/
    return pattern.test(idCard)
  }

  /**
   * 验证密码强度
   * @param password 密码
   * @param minLength 最小长度
   * @returns 强度等级 0-4
   */
  static validatePasswordStrength(password: string, minLength: number = 8): number {
    let strength = 0

    if (password.length < minLength) return 0

    // 长度
    if (password.length >= minLength) strength++
    if (password.length >= 12) strength++

    // 包含数字
    if (/\d/.test(password)) strength++

    // 包含小写字母
    if (/[a-z]/.test(password)) strength++

    // 包含大写字母
    if (/[A-Z]/.test(password)) strength++

    // 包含特殊字符
    if (/[!@#$%^&*(),.?":{}|<>]/.test(password)) strength++

    return Math.min(4, strength)
  }

  /**
   * 验证是否为空值
   * @param value 值
   * @returns 是否为空
   */
  static isEmpty(value: any): boolean {
    if (value === null || value === undefined) return true
    if (typeof value === 'string') return value.trim().length === 0
    if (Array.isArray(value)) return value.length === 0
    if (typeof value === 'object') return Object.keys(value).length === 0
    return false
  }

  /**
   * 验证是否在范围内
   * @param value 值
   * @param min 最小值
   * @param max 最大值
   * @returns 是否在范围内
   */
  static isInRange(value: number, min: number, max: number): boolean {
    return this.isValidNumber(value) && value >= min && value <= max
  }

  /**
   * 验证限价单价格是否合理
   * @param limitPrice 限价
   * @param currentPrice 当前价格
   * @param type 订单类型
   * @returns 是否合理
   */
  static isValidLimitPrice(
    limitPrice: number,
    currentPrice: number,
    type: 'BUY' | 'SELL'
  ): boolean {
    if (!this.isValidPrice(limitPrice)) return false

    // 买入限价不应高于当前价太多
    // 卖出限价不应低于当前价太多
    const deviation = Math.abs(limitPrice - currentPrice) / currentPrice
    return deviation <= 0.3 // 允许30%偏差
  }

  /**
   * 验证是否为有效的市场类型
   * @param market 市场类型
   * @returns 是否有效
   */
  static isValidMarket(market: string): boolean {
    const validMarkets = [
      'A_SHARE_T1',
      'GEM_T1',
      'STAR_T1',
      'FUTURES_T0',
      'HK_STOCK_T0',
      'US_STOCK_T0',
    ]
    return validMarkets.includes(market)
  }

  /**
   * 验证订单数量是否在限制内
   * @param quantity 数量
   * @returns 是否有效
   */
  static isValidOrderQuantity(quantity: number): boolean {
    return this.isValidQuantity(quantity) && quantity <= 1000000 // 最大100万股
  }
}
