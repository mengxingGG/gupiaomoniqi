import { Tab } from '@headlessui/react'
import { MarketType, MarketGroup, getMarketGroup, getMarketName } from '../../core/models/Stock'

interface MarketTabsProps {
  markets: MarketType[]
  selectedMarket?: MarketType
  onChange: (market: MarketType) => void
  groupBy?: 'market' | 'type' // 按市场分组或按T+0/T+1分组
}

export default function MarketTabs({
  markets,
  selectedMarket,
  onChange,
  groupBy = 'type',
}: MarketTabsProps) {
  // 按T+0/T+1分组
  const groupedByType = markets.reduce(
    (acc, market) => {
      const group = getMarketGroup(market)
      if (!acc[group]) {
        acc[group] = []
      }
      acc[group].push(market)
      return acc
    },
    {} as Record<MarketGroup, MarketType[]>
  )

  // 按市场类型分组
  const groupedByMarket = markets.reduce(
    (acc, market) => {
      acc[market] = [market]
      return acc
    },
    {} as Record<MarketType, MarketType[]>
  )

  const grouped = groupBy === 'type' ? groupedByType : groupedByMarket

  const getGroupLabel = (key: string): string => {
    if (groupBy === 'type') {
      return key === 'T0' ? 'T+0 市场' : 'T+1 市场'
    }
    return getMarketName(key as MarketType)
  }

  return (
    <Tab.Group
      selectedIndex={selectedMarket ? markets.indexOf(selectedMarket) : 0}
      onChange={(index) => onChange(markets[index])}
    >
      <Tab.List className="flex space-x-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
        {Object.entries(grouped).map(([groupKey]) => (
          <Tab key={groupKey} as="div" className="flex-1">
            {({ selected }) => (
              <button
                className={`w-full px-4 py-2 text-sm font-medium rounded-md transition-all ${
                  selected
                    ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
              >
                {getGroupLabel(groupKey)}
              </button>
            )}
          </Tab>
        ))}
      </Tab.List>
    </Tab.Group>
  )
}
