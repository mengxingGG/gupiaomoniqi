/**
 * 随机工具函数
 */

import { GameConfig } from '../constants/GameConfig'

/**
 * 随机工具类
 */
export class Random {
  /**
   * 生成指定范围内的随机整数 [min, max]
   * @param min 最小值
   * @param max 最大值
   * @returns 随机整数
   */
  static randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min
  }

  /**
   * 生成指定范围内的随机浮点数 [min, max)
   * @param min 最小值
   * @param max 最大值
   * @param decimals 小数位数
   * @returns 随机浮点数
   */
  static randomFloat(min: number, max: number, decimals: number = 2): number {
    const value = Math.random() * (max - min) + min
    return parseFloat(value.toFixed(decimals))
  }

  /**
   * 从数组中随机选择一个元素
   * @param array 数组
   * @returns 随机元素
   */
  static randomChoice<T>(array: T[]): T {
    if (array.length === 0) {
      throw new Error('Array cannot be empty')
    }
    return array[Math.floor(Math.random() * array.length)]
  }

  /**
   * 从数组中随机选择多个不重复的元素
   * @param array 数组
   * @param count 数量
   * @returns 随机元素数组
   */
  static randomSample<T>(array: T[], count: number): T[] {
    if (count >= array.length) return [...array]

    const shuffled = [...array]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    return shuffled.slice(0, count)
  }

  /**
   * 打乱数组顺序（Fisher-Yates 洗牌算法）
   * @param array 数组
   * @returns 打乱后的数组
   */
  static shuffle<T>(array: T[]): T[] {
    const shuffled = [...array]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    return shuffled
  }

  /**
   * 生成随机布尔值
   * @param probability 为 true 的概率（0-1）
   * @returns 随机布尔值
   */
  static randomBoolean(probability: number = 0.5): boolean {
    return Math.random() < probability
  }

  /**
   * 生成随机颜色（十六进制）
   * @returns 随机颜色
   */
  static randomColor(): string {
    return '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0')
  }

  /**
   * 生成随机字符串
   * @param length 长度
   * @param chars 字符集
   * @returns 随机字符串
   */
  static randomString(
    length: number,
    chars: string = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  ): string {
    let result = ''
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return result
  }

  /**
   * 生成随机数字字符串
   * @param length 长度
   * @returns 随机数字字符串
   */
  static randomNumericString(length: number): string {
    return this.randomString(length, '0123456789')
  }

  /**
   * 生成 UUID v4
   * @returns UUID
   */
  static generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0
      const v = c === 'x' ? r : (r & 0x3) | 0x8
      return v.toString(16)
    })
  }

  /**
   * 生成随机股票价格变动
   * @param currentPrice 当前价格
   * @param volatility 波动率
   * @returns 变动后的价格
   */
  static randomPriceChange(currentPrice: number, volatility: number = GameConfig.PRICE_VOLATILITY): number {
    const change = currentPrice * volatility * (Math.random() * 2 - 1)
    const newPrice = currentPrice + change

    // 确保价格在合理范围内
    const maxChange = currentPrice * GameConfig.MAX_PRICE_CHANGE
    const clampedPrice = Math.max(
      currentPrice - maxChange,
      Math.min(currentPrice + maxChange, newPrice)
    )

    return Math.max(0.01, parseFloat(clampedPrice.toFixed(2)))
  }

  /**
   * 生成随机成交量
   * @param baseVolume 基础成交量
   * @param variance 波动范围（百分比）
   * @returns 随机成交量
   */
  static randomVolume(baseVolume: number, variance: number = 0.3): number {
    const multiplier = 1 + (Math.random() * 2 - 1) * variance
    return Math.floor(baseVolume * multiplier)
  }

  /**
   * 生成随机交易决策
   * @param buyProbability 买入概率
   * @returns 'BUY' | 'SELL' | 'HOLD'
   */
  static randomTradeDecision(buyProbability: number = 0.4): 'BUY' | 'SELL' | 'HOLD' {
    const rand = Math.random()
    if (rand < buyProbability) return 'BUY'
    if (rand < buyProbability + 0.4) return 'SELL'
    return 'HOLD'
  }

  /**
   * 生成随机AI名称
   * @returns AI名称
   */
  static randomAIName(): string {
    const prefixes = ['智能', '量子', '阿尔法', '贝塔', '超级', '极速', '稳健', '激进']
    const suffixes = ['投资者', '交易员', '操盘手', '分析师', '机器人', '算法']
    return this.randomChoice(prefixes) + this.randomChoice(suffixes)
  }

  /**
   * 生成随机行业
   * @returns 行业名称
   */
  static randomIndustry(): string {
    const industries = [
      '银行',
      '保险',
      '证券',
      '房地产',
      '建筑',
      '建材',
      '钢铁',
      '煤炭',
      '石油',
      '化工',
      '机械',
      '汽车',
      '家电',
      '食品饮料',
      '医药',
      '电子',
      '计算机',
      '通信',
      '传媒',
      '电力',
      '新能源',
      '环保',
      '军工',
      '航空航天',
    ]
    return this.randomChoice(industries)
  }

  /**
   * 根据权重随机选择
   * @param items 元素数组
   * @param weights 权重数组
   * @returns 随机选择的元素
   */
  static weightedRandom<T>(items: T[], weights: number[]): T {
    if (items.length === 0) {
      throw new Error('Items array cannot be empty')
    }
    if (items.length !== weights.length) {
      throw new Error('Items and weights must have the same length')
    }

    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
    let random = Math.random() * totalWeight

    for (let i = 0; i < items.length; i++) {
      random -= weights[i]
      if (random <= 0) {
        return items[i]
      }
    }

    return items[items.length - 1]
  }

  /**
   * 生成随机时间戳（在指定范围内）
   * @param start 开始时间戳
   * @param end 结束时间戳
   * @returns 随机时间戳
   */
  static randomTimestamp(start: number, end: number): number {
    return this.randomInt(start, end)
  }

  /**
   * 生成正态分布随机数（Box-Muller变换）
   * @param mean 均值
   * @param stdDev 标准差
   * @returns 随机数
   */
  static randomNormal(mean: number = 0, stdDev: number = 1): number {
    const u1 = Math.random()
    const u2 = Math.random()
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2)
    return z0 * stdDev + mean
  }
}
