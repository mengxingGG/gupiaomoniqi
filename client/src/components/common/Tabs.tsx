import { Tab } from '@headlessui/react'
import { ReactNode } from 'react'

interface TabItem {
  key: string
  label: string
  content: ReactNode
  disabled?: boolean
}

interface TabsProps {
  tabs: TabItem[]
  defaultIndex?: number
  onChange?: (index: number) => void
  selectedIndex?: number
  variant?: 'default' | 'pills'
}

export default function Tabs({
  tabs,
  defaultIndex = 0,
  onChange,
  selectedIndex,
  variant = 'default',
}: TabsProps) {
  const isControlled = selectedIndex !== undefined

  const tabListStyles =
    variant === 'pills'
      ? 'flex space-x-2 bg-gray-100 dark:bg-gray-800 rounded-lg p-1'
      : 'flex border-b border-gray-200 dark:border-gray-700'

  const tabStyles = (selected: boolean) =>
    variant === 'pills'
      ? `px-4 py-2 text-sm font-medium rounded-md transition-all ${
          selected
            ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow'
            : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
        }`
      : `px-4 py-2 text-sm font-medium border-b-2 transition-all ${
          selected
            ? 'border-blue-500 text-blue-600 dark:text-blue-400'
            : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600'
        }`

  const tabComponent = (
    <Tab.Group
      selectedIndex={isControlled ? selectedIndex : undefined}
      defaultIndex={isControlled ? undefined : defaultIndex}
      onChange={onChange}
    >
      <Tab.List className={tabListStyles}>
        {tabs.map((tab) => (
          <Tab
            key={tab.key}
            disabled={tab.disabled}
            className={({ selected }) => tabStyles(selected)}
          >
            {tab.label}
          </Tab>
        ))}
      </Tab.List>
      <Tab.Panels className="mt-4">
        {tabs.map((tab) => (
          <Tab.Panel key={tab.key}>{tab.content}</Tab.Panel>
        ))}
      </Tab.Panels>
    </Tab.Group>
  )

  return tabComponent
}
