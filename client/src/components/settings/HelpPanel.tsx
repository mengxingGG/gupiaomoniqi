import { useState } from 'react'

interface HelpItem {
  id: string
  question: string
  answer: string
}

const helpItems: HelpItem[] = [
  {
    id: '1',
    question: '如何开始游戏？',
    answer: '在欢迎页面输入您的名字，点击"开始游戏"即可创建新角色，获得100万初始资金。',
  },
  {
    id: '2',
    question: '如何进行股票交易？',
    answer: '1. 在股票列表中选择一只股票\n2. 在右侧交易面板选择买入或卖出\n3. 输入数量后点击确认\n4. 市价单立即成交，限价单需要等待价格达到委托价',
  },
  {
    id: '3',
    question: '什么是T+1制度？',
    answer: 'A股市场实行T+1制度，即当天买入的股票需要下一个交易日才能卖出。其他市场（T+0）可以当天买卖。',
  },
  {
    id: '4',
    question: '手续费如何计算？',
    answer: '买入手续费：成交金额 × 5%\n卖出手续费：成交金额 × 3%\n例如：买入10万元股票，手续费为5000元',
  },
  {
    id: '5',
    question: '如何借款？',
    answer: '点击侧边栏"借贷"按钮进入借贷中心。借款额度为您初始资金的3倍，年利率17%。借款按游戏时间计息。',
  },
  {
    id: '6',
    question: '如何使用礼包码？',
    answer: '进入设置页面，点击"礼包码"标签，输入礼包码后点击"兑换"按钮即可获得奖励。',
  },
  {
    id: '7',
    question: '如何保存和加载游戏？',
    answer: '游戏会自动每5分钟保存一次到浏览器本地存储。您也可以在设置页面手动保存、导出或导入存档。',
  },
  {
    id: '8',
    question: '排行榜如何计算？',
    answer: '排行榜根据总资产和收益率进行排名。玩家可以与1000个AI交易者竞争排名。',
  },
  {
    id: '9',
    question: '如何解锁成就？',
    answer: '在游戏中完成特定目标即可解锁成就，如：完成交易达到一定次数、资产达到一定金额、分散投资等。',
  },
  {
    id: '10',
    question: '如何暂定/继续游戏？',
    answer: '在主页顶部有"暂停"按钮，点击可以暂停游戏时间。暂停状态下AI不会交易，价格也不会变化。',
  },
]

export default function HelpPanel() {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  // 过滤帮助项
  const filteredItems = helpItems.filter(
    (item) =>
      item.question.includes(searchQuery) || item.answer.includes(searchQuery)
  )

  return (
    <div className="space-y-4">
      {/* 搜索 */}
      <div>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="搜索问题..."
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
        />
      </div>

      {/* 帮助列表 */}
      <div className="space-y-2">
        {filteredItems.length === 0 ? (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            没有找到相关问题
          </div>
        ) : (
          filteredItems.map((item) => (
            <div
              key={item.id}
              className="border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden"
            >
              {/* 问题 */}
              <button
                onClick={() =>
                  setExpandedId(expandedId === item.id ? null : item.id)
                }
                className="w-full flex items-center justify-between p-3 text-left bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
              >
                <span className="font-medium text-gray-900 dark:text-white">
                  {item.question}
                </span>
                <span className="text-gray-400 dark:text-gray-500">
                  {expandedId === item.id ? '▲' : '▼'}
                </span>
              </button>

              {/* 答案 */}
              {expandedId === item.id && (
                <div className="p-3 text-sm text-gray-600 dark:text-gray-400 whitespace-pre-line">
                  {item.answer}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* 联系信息 */}
      <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
        <div className="text-sm text-blue-600 dark:text-blue-400">
          <p className="font-medium mb-1">需要更多帮助？</p>
          <p>如果您有其他问题，可以查看游戏内的其他功能或重新阅读本帮助文档。</p>
        </div>
      </div>

      {/* 快捷操作 */}
      <div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          快捷操作
        </h3>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="p-2 bg-gray-50 dark:bg-gray-700 rounded">
            <div className="font-medium">快捷键</div>
            <div className="text-gray-500">Enter: 确认交易</div>
          </div>
          <div className="p-2 bg-gray-50 dark:bg-gray-700 rounded">
            <div className="font-medium">快速买卖</div>
            <div className="text-gray-500">点击数量按钮快速设置</div>
          </div>
        </div>
      </div>
    </div>
  )
}
