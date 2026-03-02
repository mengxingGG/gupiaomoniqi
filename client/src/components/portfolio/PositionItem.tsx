import type { Position as PositionType } from '../../core/models/Position'
import type { Stock } from '../../core/models/Stock'

interface PositionItemProps {
  position: PositionType & {
    stock?: Stock
    currentValue?: number
    profit?: number
    profitPercent?: number
  }
}

export default function PositionItem({ position }: PositionItemProps) {
  // 获取涨跌幅颜色
  const getChangeColor = () => {
    if (!position.stock) return ''
    if (position.stock.changePercent > 0) return 'text-up'
    if (position.stock.changePercent < 0) return 'text-down'
    return 'text-flat'
  }

  // 获取盈亏颜色
  const getProfitColor = () => {
    if (!position.profit) return ''
    if (position.profit > 0) return 'text-up'
    if (position.profit < 0) return 'text-down'
    return 'text-flat'
  }

  return (
    <div className="p-3 border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
      {/* 头部：股票名称 + 涨跌幅 */}
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="font-medium text-gray-900 dark:text-white">
            {position.stockName || position.stockCode}
          </div>
          <div className="text-xs text-gray-500">
            {position.stock?.code}
          </div>
        </div>
        {position.stock && (
          <div className="text-right">
            <div className="font-number text-gray-900 dark:text-white">
              ¥{position.stock.currentPrice.toFixed(2)}
            </div>
            <div className={`font-number text-xs ${getChangeColor()}`}>
              {position.stock.changePercent >= 0 ? '+' : ''}
              {position.stock.changePercent.toFixed(2)}%
            </div>
          </div>
        )}
      </div>

      {/* 持仓详情 */}
      <div className="grid grid-cols-4 gap-2 text-sm mb-2">
        <div>
          <div className="text-gray-500 dark:text-gray-400 text-xs">持仓数量</div>
          <div className="font-number">{position.quantity}</div>
        </div>
        <div>
          <div className="text-gray-500 dark:text-gray-400 text-xs">可卖数量</div>
          <div className="font-number text-green-500">{position.availableQuantity}</div>
        </div>
        <div>
          <div className="text-gray-500 dark:text-gray-400 text-xs">持仓成本</div>
          <div className="font-number">¥{position.averageCost.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-gray-500 dark:text-gray-400 text-xs">持仓市值</div>
          <div className="font-number">¥{(position.currentValue || 0).toFixed(0)}</div>
        </div>
      </div>

      {/* 盈亏信息 */}
      {position.profit !== undefined && (
        <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-gray-700">
          <div className="text-xs text-gray-500 dark:text-gray-400">
            盈亏: <span className={getProfitColor()}>{position.profit >= 0 ? '+' : ''}¥{position.profit?.toFixed(2)}</span>
          </div>
          <div className={`text-sm font-bold font-number ${getProfitColor()}`}>
            {position.profitPercent !== undefined && (
              <span>{position.profitPercent >= 0 ? '+' : ''}{position.profitPercent.toFixed(2)}%</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
