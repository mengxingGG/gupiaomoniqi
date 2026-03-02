import { useEffect, useRef } from 'react'
import * as echarts from 'echarts'
import type { ECharts } from 'echarts'
import type { Stock } from '../../core/models/Stock'

interface TimeLineChartProps {
  stock: Stock
  height?: number
}

export default function TimeLineChart({ stock, height = 400 }: TimeLineChartProps) {
  const chartRef = useRef<HTMLDivElement>(null)
  const chartInstance = useRef<ECharts | null>(null)

  useEffect(() => {
    if (!chartRef.current) return

    // 初始化图表
    if (!chartInstance.current) {
      chartInstance.current = echarts.init(chartRef.current)
    }

    // 准备数据
    const times = stock.priceHistory.map((point) => {
      const date = new Date(point.time)
      const hours = date.getHours().toString().padStart(2, '0')
      const minutes = date.getMinutes().toString().padStart(2, '0')
      return `${hours}:${minutes}`
    })

    const prices = stock.priceHistory.map((point) => point.price.toFixed(2))
    const volumes = stock.priceHistory.map((point) => point.volume)
    const baseLine = stock.previousClose.toFixed(2) // 昨收价基准线

    // 计算平均价格线
    const avgPrices: string[] = []
    let sum = 0
    prices.forEach((price, index) => {
      sum += parseFloat(price)
      avgPrices.push((sum / (index + 1)).toFixed(2))
    })

    // 配置项
    const option: echarts.EChartsOption = {
      backgroundColor: 'transparent',
      animation: false,
      legend: {
        data: ['分时', '均价', '成交量'],
        top: 10,
        left: 'center',
        textStyle: {
          color: '#999',
        },
      },
      grid: [
        {
          left: '10%',
          right: '8%',
          top: '15%',
          height: '55%',
        },
        {
          left: '10%',
          right: '8%',
          top: '75%',
          height: '15%',
        },
      ],
      xAxis: [
        {
          type: 'category',
          data: times,
          boundaryGap: false,
          axisLine: { lineStyle: { color: '#999' } },
          axisLabel: {
            color: '#999',
            fontSize: 11,
            interval: Math.floor(times.length / 6), // 显示约6个时间标签
          },
          splitLine: { show: false },
        },
        {
          type: 'category',
          gridIndex: 1,
          data: times,
          boundaryGap: false,
          axisLine: { show: false },
          axisLabel: { show: false },
          splitLine: { show: false },
        },
      ],
      yAxis: [
        {
          scale: true,
          axisLine: { lineStyle: { color: '#999' } },
          axisLabel: { color: '#999', fontSize: 11 },
          splitLine: {
            lineStyle: {
              color: '#e0e0e0',
              type: 'dashed',
            },
          },
          splitNumber: 5,
        },
        {
          scale: true,
          gridIndex: 1,
          splitNumber: 2,
          axisLine: { show: false },
          axisLabel: { show: false },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: '分时',
          type: 'line',
          data: prices,
          smooth: true,
          symbol: 'none',
          lineStyle: {
            width: 1.5,
            color: '#1890ff',
          },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(24, 144, 255, 0.3)' },
              { offset: 1, color: 'rgba(24, 144, 255, 0.05)' },
            ]),
          },
          markLine: {
            silent: true,
            symbol: 'none',
            data: [
              {
                yAxis: baseLine,
                label: {
                  position: 'end',
                  formatter: '昨收: {c}',
                  color: '#999',
                  fontSize: 11,
                },
                lineStyle: {
                  color: '#999',
                  type: 'dashed',
                  width: 1,
                },
              },
            ],
          },
        },
        {
          name: '均价',
          type: 'line',
          data: avgPrices,
          smooth: true,
          symbol: 'none',
          lineStyle: {
            width: 1,
            color: '#ff9c00',
            type: 'dashed',
          },
        },
        {
          name: '成交量',
          type: 'bar',
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: volumes,
          itemStyle: {
            color: function (params: any) {
              const dataIndex = params.dataIndex
              if (dataIndex === 0) return '#999'
              const currentPrice = parseFloat(prices[dataIndex])
              const prevPrice = parseFloat(prices[dataIndex - 1])
              // 如果当前价格 >= 前一个价格，显示红色，否则绿色
              return currentPrice >= prevPrice ? '#ff4d4f' : '#52c41a'
            },
          },
        },
      ],
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'cross',
        },
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        borderColor: '#333',
        textStyle: {
          color: '#fff',
        },
        formatter: function (params: any) {
          const dataIndex = params[0].dataIndex
          const time = times[dataIndex]
          const price = prices[dataIndex]
          const avgPrice = avgPrices[dataIndex]
          const volume = volumes[dataIndex]

          const changePercent = ((parseFloat(price) - stock.previousClose) / stock.previousClose) * 100
          const changeAmount = parseFloat(price) - stock.previousClose

          return `
            <div style="padding: 4px;">
              <div style="margin-bottom: 4px; font-weight: bold;">${time}</div>
              <div>价格: ${price}</div>
              <div>均价: ${avgPrice}</div>
              <div>涨跌: ${changeAmount >= 0 ? '+' : ''}${changeAmount.toFixed(2)} (${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%)</div>
              <div>成交量: ${volume.toLocaleString()}</div>
            </div>
          `
        },
      },
    }

    chartInstance.current.setOption(option)

    // 响应式
    const handleResize = () => {
      chartInstance.current?.resize()
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [stock])

  // 清理
  useEffect(() => {
    return () => {
      chartInstance.current?.dispose()
    }
  }, [])

  return <div ref={chartRef} style={{ width: '100%', height: `${height}px` }} />
}
