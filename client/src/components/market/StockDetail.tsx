import { useEffect, useRef, useState, useCallback } from 'react'
import type { StockData as Stock } from '../../store/useMarketStore'
import { getMarketName, getMarketGroup } from '../../core/models/Stock'
import { createChart, IChartApi } from 'lightweight-charts'

interface StockDetailProps {
  stock: Stock
}

type ChartTab = 'timeline' | 'daily'

// 安全格式化数字
const n2 = (v: number | null | undefined, fallback = '—') =>
  v != null && isFinite(v) ? v.toFixed(2) : fallback

function fmtVol(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return '—'
  if (v >= 100000000) return (v / 100000000).toFixed(2) + '亿'
  if (v >= 10000) return (v / 10000).toFixed(2) + '万'
  return v.toLocaleString()
}

export default function StockDetail({ stock }: StockDetailProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartBoxRef = useRef<HTMLDivElement>(null)
  const chartApiRef = useRef<IChartApi | null>(null)
  const [tab, setTab] = useState<ChartTab>('timeline')

  const up = (stock.changePercent ?? 0) >= 0
  const isT0 = getMarketGroup(stock.market as any) === 'T0'

  // 安全取值
  const currentPrice = stock.currentPrice ?? 0
  const previousClose = stock.previousClose ?? currentPrice
  const openPrice = stock.openPrice ?? currentPrice
  const highPrice = stock.highPrice ?? currentPrice
  const lowPrice = stock.lowPrice ?? currentPrice
  const changePercent = isFinite(stock.changePercent ?? NaN) ? stock.changePercent : 0
  const changeAmount = isFinite(stock.changeAmount ?? NaN) ? stock.changeAmount : 0

  const buildChart = useCallback(() => {
    if (!chartBoxRef.current) return

    // 销毁旧图表
    if (chartApiRef.current) {
      try { chartApiRef.current.remove() } catch {}
      chartApiRef.current = null
    }

    const el = chartBoxRef.current
    const w = el.clientWidth || 400
    const h = el.clientHeight || 220
    const isDark = document.documentElement.classList.contains('dark')

    const bgColor = isDark ? '#1f2937' : '#ffffff'
    const textColor = isDark ? '#9ca3af' : '#555555'
    const gridColor = isDark ? '#374151' : '#f3f4f6'
    const borderColor = isDark ? '#4b5563' : '#e5e7eb'

    let chart: IChartApi
    try {
      chart = createChart(el, {
        width: w,
        height: h,
        layout: { background: { color: bgColor }, textColor },
        grid: { vertLines: { color: gridColor }, horzLines: { color: gridColor } },
        rightPriceScale: { borderColor },
        timeScale: { borderColor, timeVisible: true, secondsVisible: false },
        crosshair: { mode: 1 },
      })
    } catch (e) {
      console.error('[StockDetail] chart init failed:', e)
      return
    }

    chartApiRef.current = chart

    try {
      if (tab === 'timeline') {
        // 分时图
        const upColor = '#ff4d4f'
        const downColor = '#22c55e'
        const lineColor = up ? upColor : downColor

        const lineSeries = chart.addLineSeries({
          color: lineColor,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: true,
        })

        // 昨收基准线
        const baseSeries = chart.addLineSeries({
          color: borderColor,
          lineWidth: 1,
          lineStyle: 2, // dashed
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        })

        const history = (stock.priceHistory ?? [])
          .filter(p => p?.time && p?.price > 0)
          .sort((a, b) => a.time - b.time)

        if (history.length > 1) {
          const data = history.map(p => ({
            time: Math.floor(p.time / 1000) as any,
            value: p.price,
          }))
          lineSeries.setData(data)
          baseSeries.setData([
            { time: data[0].time, value: previousClose },
            { time: data[data.length - 1].time, value: previousClose },
          ])
        } else {
          // 无历史 → 模拟5分钟分时
          const nowSec = Math.floor(Date.now() / 1000)
          const pts: any[] = []
          let p = openPrice
          for (let i = 240; i >= 0; i--) {
            p = Math.max(0.01, p * (1 + (Math.random() - 0.498) * 0.003))
            pts.push({ time: (nowSec - i * 30) as any, value: Math.round(p * 100) / 100 })
          }
          pts[pts.length - 1] = { time: nowSec as any, value: currentPrice }
          lineSeries.setData(pts)
          baseSeries.setData([
            { time: pts[0].time, value: previousClose },
            { time: pts[pts.length - 1].time, value: previousClose },
          ])
        }

        // 量柱
        const volSeries = chart.addHistogramSeries({
          color: up ? 'rgba(255,77,79,0.4)' : 'rgba(34,197,94,0.4)',
          priceScaleId: 'vol',
          priceFormat: { type: 'volume' },
        })
        chart.priceScale('vol').applyOptions({
          scaleMargins: { top: 0.75, bottom: 0 },
        })
        if (history.length > 1) {
          volSeries.setData(history.map(p => ({
            time: Math.floor(p.time / 1000) as any,
            value: p.volume ?? 0,
            color: p.price >= previousClose ? 'rgba(255,77,79,0.4)' : 'rgba(34,197,94,0.4)',
          })))
        }
      } else {
        // 日K图
        const candleSeries = chart.addCandlestickSeries({
          upColor: '#ff4d4f',
          downColor: '#22c55e',
          borderUpColor: '#ff4d4f',
          borderDownColor: '#22c55e',
          wickUpColor: '#ff4d4f',
          wickDownColor: '#22c55e',
        })

        // 30日模拟历史
        const kData: any[] = []
        const daySec = 86400
        const nowSec = Math.floor(Date.now() / 1000)
        let base = previousClose
        for (let i = 30; i >= 1; i--) {
          const chg = (Math.random() - 0.5) * 0.06
          const o = base
          const c = Math.round(base * (1 + chg) * 100) / 100
          const h = Math.round(Math.max(o, c) * (1 + Math.random() * 0.02) * 100) / 100
          const l = Math.round(Math.min(o, c) * (1 - Math.random() * 0.02) * 100) / 100
          kData.push({ time: (nowSec - i * daySec) as any, open: o, high: h, low: l, close: c })
          base = c
        }
        // 今日真实数据
        kData.push({
          time: nowSec as any,
          open: openPrice,
          high: highPrice,
          low: lowPrice,
          close: currentPrice,
        })
        candleSeries.setData(kData)

        // 日量柱
        const volSeries = chart.addHistogramSeries({
          color: 'rgba(255,77,79,0.4)',
          priceScaleId: 'vol',
          priceFormat: { type: 'volume' },
        })
        chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.75, bottom: 0 } })
        volSeries.setData(kData.map(k => ({
          time: k.time,
          value: Math.round(Math.random() * 5000000 + 500000),
          color: k.close >= k.open ? 'rgba(255,77,79,0.4)' : 'rgba(34,197,94,0.4)',
        })))
      }

      chart.timeScale().fitContent()
    } catch (e) {
      console.error('[StockDetail] chart data failed:', e)
    }
  }, [stock.code, stock.currentPrice, tab]) // eslint-disable-line

  // 初始化图表
  useEffect(() => {
    // 等 DOM 完成布局后再创建图表
    const id = requestAnimationFrame(() => { buildChart() })
    return () => {
      cancelAnimationFrame(id)
      if (chartApiRef.current) {
        try { chartApiRef.current.remove() } catch {}
        chartApiRef.current = null
      }
    }
  }, [buildChart])

  // ResizeObserver 响应容器尺寸变化
  useEffect(() => {
    if (!chartBoxRef.current) return
    const ro = new ResizeObserver(() => {
      if (chartApiRef.current && chartBoxRef.current) {
        const { clientWidth, clientHeight } = chartBoxRef.current
        if (clientWidth > 0 && clientHeight > 0) {
          chartApiRef.current.applyOptions({ width: clientWidth, height: clientHeight })
        }
      }
    })
    ro.observe(chartBoxRef.current)
    return () => ro.disconnect()
  }, [])

  // 涨跌幅 → 背景颜色深度
  const changePct = Math.abs(changePercent)
  const limitColor = changePct >= 9.9
    ? (up ? 'bg-red-600 text-white' : 'bg-green-600 text-white')
    : (up ? 'text-up' : 'text-down')

  const STATS = [
    { label: '今开', value: n2(openPrice), cls: '' },
    { label: '昨收', value: n2(previousClose), cls: '' },
    { label: '最高', value: n2(highPrice), cls: 'text-up' },
    { label: '最低', value: n2(lowPrice), cls: 'text-down' },
    { label: '成交量', value: fmtVol(stock.volume), cls: '' },
    { label: '成交额', value: fmtVol(stock.turnover), cls: '' },
    { label: '涨跌额', value: (changeAmount >= 0 ? '+' : '') + n2(changeAmount), cls: up ? 'text-up' : 'text-down' },
    { label: '振幅', value: previousClose > 0 ? n2(((highPrice - lowPrice) / previousClose) * 100) + '%' : '—', cls: '' },
  ]

  return (
    <div ref={containerRef} className="flex flex-col h-full bg-white dark:bg-gray-800 overflow-hidden">
      {/* ── 股票标题 ── */}
      <div className="px-4 pt-3 pb-2 border-b border-gray-100 dark:border-gray-700 shrink-0">
        <div className="flex items-start justify-between gap-4">
          {/* 左：名称+代码+标签 */}
          <div className="min-w-0">
            <div className="flex items-center flex-wrap gap-1.5">
              <span className="text-lg font-bold text-gray-900 dark:text-white truncate">{stock.name}</span>
              <span className="text-xs text-gray-400 font-mono">{stock.code}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-500 shrink-0">
                {getMarketName(stock.market as any)}
              </span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${
                isT0 ? 'bg-purple-50 dark:bg-purple-900/30 text-purple-500'
                     : 'bg-orange-50 dark:bg-orange-900/30 text-orange-500'
              }`}>
                {isT0 ? 'T+0' : 'T+1'}
              </span>
              {stock.industry && (
                <span className="text-[10px] text-gray-400">{stock.industry}</span>
              )}
            </div>
          </div>

          {/* 右：价格 */}
          <div className="text-right shrink-0">
            <div className={`text-3xl font-bold font-number tabular-nums leading-none ${limitColor}`}>
              {n2(currentPrice)}
            </div>
            <div className={`text-sm font-number tabular-nums mt-0.5 ${up ? 'text-up' : 'text-down'}`}>
              {changeAmount >= 0 ? '+' : ''}{n2(changeAmount)}
              &ensp;
              {changePercent >= 0 ? '+' : ''}{n2(changePercent)}%
            </div>
            {changePct >= 9.9 && (
              <div className={`text-[10px] mt-0.5 font-bold ${up ? 'text-up' : 'text-down'}`}>
                {up ? '▲ 涨停' : '▼ 跌停'}
              </div>
            )}
          </div>
        </div>

        {/* 行情数据 8 格 */}
        <div className="grid grid-cols-4 gap-x-4 gap-y-1 mt-2 text-xs">
          {STATS.map(s => (
            <div key={s.label}>
              <span className="text-gray-400 dark:text-gray-500 mr-1">{s.label}</span>
              <span className={`font-number tabular-nums ${s.cls || 'text-gray-700 dark:text-gray-300'}`}>{s.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── 图表标签页 ── */}
      <div className="flex items-center px-3 py-0 border-b border-gray-100 dark:border-gray-700 shrink-0">
        {([['timeline', '分时'], ['daily', '日K']] as [ChartTab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-3 py-1.5 text-xs border-b-2 transition-colors ${
              tab === key
                ? 'border-primary text-primary font-medium'
                : 'border-transparent text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── 图表区域（flex-1 撑满剩余空间）── */}
      <div ref={chartBoxRef} className="flex-1 min-h-0" />
    </div>
  )
}
