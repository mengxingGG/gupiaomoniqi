import { ReactNode } from 'react'

interface Column<T> {
  key: string
  title: string
  width?: string
  align?: 'left' | 'center' | 'right'
  render?: (value: any, record: T, index: number) => ReactNode
}

interface TableProps<T> {
  columns: Column<T>[]
  data: T[]
  rowKey: string | ((record: T) => string)
  loading?: boolean
  emptyText?: string
  onRowClick?: (record: T, index: number) => void
  selectedRowKey?: string | null
}

export default function Table<T extends Record<string, any>>({
  columns,
  data,
  rowKey,
  loading = false,
  emptyText = '暂无数据',
  onRowClick,
  selectedRowKey,
}: TableProps<T>) {
  const getKey = (record: T, _index: number): string => {
    if (typeof rowKey === 'string') {
      return record[rowKey]
    }
    return rowKey(record)
  }

  const alignClass = (align?: 'left' | 'center' | 'right') => {
    switch (align) {
      case 'center':
        return 'text-center'
      case 'right':
        return 'text-right'
      default:
        return 'text-left'
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-700">
            {columns.map((col) => (
              <th
                key={col.key}
                className={`px-4 py-3 text-sm font-medium text-gray-600 dark:text-gray-400 ${alignClass(
                  col.align
                )}`}
                style={{ width: col.width }}
              >
                {col.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-8 text-center text-gray-400 dark:text-gray-500"
              >
                {emptyText}
              </td>
            </tr>
          ) : (
            data.map((record, index) => {
              const key = getKey(record, index)
              const isSelected = selectedRowKey === key

              return (
                <tr
                  key={key}
                  onClick={() => onRowClick?.(record, index)}
                  className={`border-b border-gray-100 dark:border-gray-800 transition-colors ${
                    onRowClick ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800' : ''
                  } ${isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
                >
                  {columns.map((col) => {
                    const value = record[col.key]
                    return (
                      <td
                        key={col.key}
                        className={`px-4 py-3 text-sm text-gray-900 dark:text-gray-100 ${alignClass(
                          col.align
                        )}`}
                      >
                        {col.render ? col.render(value, record, index) : value}
                      </td>
                    )
                  })}
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}
