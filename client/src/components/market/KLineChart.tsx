import { useEffect, useRef } from 'react'
import * as echarts from 'echarts'
import type { ECharts } from 'echarts'
import type { StockData as Stock } from '../../store/useMarketStore'

interface KLineChartProps {
  stock: Stock
  height?: number
}

export default function KLineChart({ stock, height = 400 }: KLineChartProps) {
  const chartRef = useRef<HTMLDivElement>(null)
  const chartInstance = useRef<ECharts | null>(null)

  useEffect(() => {
    if (!chartRef.current) return

    // 初始化图表
    if (!chartInstance.current) {
      chartInstance.current = echarts.init(chartRef.current)
    }

    // 准备数据
    const dates = stock.priceHistory.map((point) => {
      const date = new Date(point.time)
      return `${date.getMonth() + 1}/${date.getDate()}`
    })

    const klineData = stock.priceHistory.map((point) => [
      point.open?.toFixed(2) || point.price.toFixed(2),
      point.close?.toFixed(2) || point.price.toFixed(2),
      point.low?.toFixed(2) || point.price.toFixed(2),
      point.high?.toFixed(2) || point.price.toFixed(2),
    ])

    const volumes = stock.priceHistory.map((point) => point.volume)

    // 配置项
    const option: echarts.EChartsOption = {
      backgroundColor: 'transparent',
      animation: false,
      legend: {
        data: ['K线', '成交量'],
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
          data: dates,
          boundaryGap: false,
          axisLine: { lineStyle: { color: '#999' } },
          axisLabel: { color: '#999', fontSize: 11 },
          splitLine: { show: false },
          min: 'dataMin',
          max: 'dataMax',
        },
        {
          type: 'category',
          gridIndex: 1,
          data: dates,
          boundaryGap: false,
          axisLine: { show: false },
          axisLabel: { show: false },
          splitLine: { show: false },
          min: 'dataMin',
          max: 'dataMax',
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
      dataZoom: [
        {
          type: 'inside',
          xAxisIndex: [0, 1],
          start: 80,
          end: 100,
        },
      ],
      series: [
        {
          name: 'K线',
          type: 'candlestick',
          data: klineData,
          itemStyle: {
            color: '#ff4d4f', // 上涨颜色
            color0: '#52c41a', // 下跌颜色
            borderColor: '#ff4d4f',
            borderColor0: '#52c41a',
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
              const current = klineData[dataIndex]
              // 如果收盘价 > 开盘价，显示红色，否则绿色
              return parseFloat(current[1]) >= parseFloat(current[0]) ? '#ff4d4f' : '#52c41a'
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
          const date = dates[dataIndex]
          const kline = klineData[dataIndex]
          const volume = volumes[dataIndex]

          return `
            <div style="padding: 4px;">
              <div style="margin-bottom: 4px; font-weight: bold;">${date}</div>
              <div>开盘: ${kline[0]}</div>
              <div>收盘: ${kline[1]}</div>
              <div>最低: ${kline[2]}</div>
              <div>最高: ${kline[3]}</div>
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
