/**
 * 格式化工具函数
 */

import { format, formatDistanceToNow } from 'date-fns'
import { zhCN } from 'date-fns/locale'

/**
 * 格式化工具类
 */
export class Formatter {
  /**
   * 格式化货币（人民币）
   * @param amount 金额
   * @param decimals 小数位数
   * @returns 格式化后的货币字符串
   */
  static formatMoney(amount: number, decimals: number = 2): string {
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency: 'CNY',
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(amount)
  }

  /**
   * 格式化数字（添加千分位）
   * @param value 数值
   * @param decimals 小数位数
   * @returns 格式化后的数字字符串
   */
  static formatNumber(value: number, decimals: number = 2): string {
    return new Intl.NumberFormat('zh-CN', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value)
  }

  /**
   * 格式化百分比
   * @param value 百分比值（如 5.23 表示 5.23%）
   * @param decimals 小数位数
   * @param showSign 是否显示正负号
   * @returns 格式化后的百分比字符串
   */
  static formatPercent(value: number, decimals: number = 2, showSign: boolean = true): string {
    const prefix = showSign && value > 0 ? '+' : ''
    const formatted = value.toFixed(decimals)
    return `${prefix}${formatted}%`
  }

  /**
   * 格式化股票价格
   * @param price 价格
   * @returns 格式化后的价格字符串
   */
  static formatPrice(price: number): string {
    return price.toFixed(2)
  }

  /**
   * 格式化涨跌额
   * @param amount 涨跌额
   * @returns 格式化后的涨跌额字符串
   */
  static formatChangeAmount(amount: number): string {
    const prefix = amount >= 0 ? '+' : ''
    return `${prefix}${amount.toFixed(2)}`
  }

  /**
   * 格式化成交量
   * @param volume 成交量
   * @returns 格式化后的成交量字符串
   */
  static formatVolume(volume: number): string {
    if (volume >= 100000000) {
      return `${(volume / 100000000).toFixed(2)}亿`
    }
    if (volume >= 10000) {
      return `${(volume / 10000).toFixed(2)}万`
    }
    return volume.toString()
  }

  /**
   * 格式化成交额
   * @param amount 成交额
   * @returns 格式化后的成交额字符串
   */
  static formatAmount(amount: number): string {
    if (amount >= 100000000) {
      return `${(amount / 100000000).toFixed(2)}亿`
    }
    if (amount >= 10000) {
      return `${(amount / 10000).toFixed(2)}万`
    }
    return amount.toFixed(2)
  }

  /**
   * 格式化日期时间
   * @param timestamp 时间戳
   * @param formatStr 格式字符串
   * @returns 格式化后的日期字符串
   */
  static formatDateTime(timestamp: number, formatStr: string = 'yyyy-MM-dd HH:mm:ss'): string {
    return format(new Date(timestamp), formatStr, { locale: zhCN })
  }

  /**
   * 格式化日期
   * @param timestamp 时间戳
   * @returns 格式化后的日期字符串
   */
  static formatDate(timestamp: number): string {
    return format(new Date(timestamp), 'yyyy-MM-dd', { locale: zhCN })
  }

  /**
   * 格式化时间
   * @param timestamp 时间戳
   * @returns 格式化后的时间字符串
   */
  static formatTime(timestamp: number): string {
    return format(new Date(timestamp), 'HH:mm:ss', { locale: zhCN })
  }

  /**
   * 格式化相对时间（如"3天前"）
   * @param timestamp 时间戳
   * @returns 格式化后的相对时间字符串
   */
  static formatRelativeTime(timestamp: number): string {
    return formatDistanceToNow(new Date(timestamp), { addSuffix: true, locale: zhCN })
  }

  /**
   * 格式化股票代码
   * @param code 股票代码
   * @returns 格式化后的股票代码
   */
  static formatStockCode(code: string): string {
    // 补齐6位
    return code.padStart(6, '0')
  }

  /**
   * 格式化手机号（隐藏中间4位）
   * @param phone 手机号
   * @returns 格式化后的手机号
   */
  static formatPhone(phone: string): string {
    if (phone.length !== 11) return phone
    return `${phone.slice(0, 3)}****${phone.slice(7)}`
  }

  /**
   * 格式化银行卡号（每4位一组）
   * @param cardNumber 银行卡号
   * @returns 格式化后的银行卡号
   */
  static formatBankCard(cardNumber: string): string {
    return cardNumber.replace(/(.{4})/g, '$1 ').trim()
  }

  /**
   * 格式化文件大小
   * @param bytes 字节数
   * @returns 格式化后的文件大小字符串
   */
  static formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B'

    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))

    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
  }

  /**
   * 格式化股票涨跌状态
   * @param changePercent 涨跌幅
   * @returns 涨跌状态：'up' | 'down' | 'flat'
   */
  static formatStockStatus(changePercent: number): 'up' | 'down' | 'flat' {
    if (changePercent > 0.01) return 'up'
    if (changePercent < -0.01) return 'down'
    return 'flat'
  }

  /**
   * 格式化持仓数量（手）
   * @param quantity 数量
   * @returns 格式化后的数量字符串
   */
  static formatQuantity(quantity: number): string {
    if (quantity >= 10000) {
      return `${(quantity / 10000).toFixed(2)}万`
    }
    return quantity.toString()
  }

  /**
   * 格式化交易类型
   * @param type 交易类型
   * @returns 交易类型中文名称
   */
  static formatTradeType(type: 'BUY' | 'SELL'): string {
    return type === 'BUY' ? '买入' : '卖出'
  }

  /**
   * 格式化订单状态
   * @param status 订单状态
   * @returns 订单状态中文名称
   */
  static formatOrderStatus(status: 'PENDING' | 'EXECUTED' | 'CANCELLED'): string {
    const statusMap = {
      PENDING: '待执行',
      EXECUTED: '已执行',
      CANCELLED: '已撤销',
    }
    return statusMap[status]
  }

  /**
   * 截断字符串
   * @param str 字符串
   * @param maxLength 最大长度
   * @param suffix 后缀
   * @returns 截断后的字符串
   */
  static truncate(str: string, maxLength: number, suffix: string = '...'): string {
    if (str.length <= maxLength) return str
    return str.slice(0, maxLength - suffix.length) + suffix
  }

  /**
   * 格式化身份证号（隐藏中间部分）
   * @param idCard 身份证号
   * @returns 格式化后的身份证号
   */
  static formatIdCard(idCard: string): string {
    if (idCard.length !== 18) return idCard
    return `${idCard.slice(0, 6)}********${idCard.slice(14)}`
  }
}
