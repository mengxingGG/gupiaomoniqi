import { useEffect, useRef } from 'react'
import { useMarketStore } from '../store/useMarketStore'

// 使用相对路径走 Vite 代理
const WS_URL = import.meta.env.VITE_WS_URL || ''

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const { updateStockPrice, setConnected } = useMarketStore()
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let destroyed = false

    const connect = () => {
      if (destroyed) return

      const ws = new WebSocket(`${WS_URL}/ws/market`)
      wsRef.current = ws

      ws.onopen = () => {
        setConnected(true)
        console.log('[WS] Connected')
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === 'price_update' && Array.isArray(msg.data)) {
            msg.data.forEach((item: any) => {
              updateStockPrice({
                code: item.code,
                name: item.name,
                currentPrice: item.price,
                changePercent: item.changePercent,
                changeAmount: item.changeAmount,
                volume: item.volume,
                turnover: item.turnover,
                updatedAt: item.timestamp,
                lastUpdate: item.timestamp,
              })
            })
          }
        } catch (err) {
          console.error('[WS] Parse error:', err)
        }
      }

      ws.onclose = () => {
        setConnected(false)
        console.log('[WS] Disconnected, reconnecting in 3s...')
        if (!destroyed) {
          reconnectTimerRef.current = setTimeout(connect, 3000)
        }
      }

      ws.onerror = (err) => {
        console.error('[WS] Error:', err)
        ws.close()
      }
    }

    connect()

    return () => {
      destroyed = true
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      wsRef.current?.close()
    }
  }, [])
}
