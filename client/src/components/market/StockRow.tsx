import type { StockData as Stock } from '../../store/useMarketStore'

interface StockRowProps {
  stock: Stock
  isSelected?: boolean
  onClick?: () => void
}

export default function StockRow({ stock, isSelected = false, onClick }: StockRowProps) {
  const formatPrice = (price: number) => {
    return price.toFixed(2)
  }

  const formatChange = (change: number) => {
    const prefix = change >= 0 ? '+' : ''
    return `${prefix}${change.toFixed(2)}%`
  }

  const changeClass = stock.changePercent >= 0 ? 'text-up' : 'text-down'

  return (
    <button
      onClick={onClick}
      className={`w-full grid grid-cols-4 gap-2 px-3 py-3 text-sm border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${
        isSelected ? 'bg-blue-50 dark:bg-blue-900/30' : ''
      }`}
    >
      <div className="font-mono text-gray-900 dark:text-white">{stock.code}</div>
      <div className="text-gray-700 dark:text-gray-300 truncate">{stock.name}</div>
      <div className="text-right font-number text-gray-900 dark:text-white">
        {formatPrice(stock.currentPrice)}
      </div>
      <div className={`text-right font-number ${changeClass}`}>{formatChange(stock.changePercent)}</div>
    </button>
  )
}
