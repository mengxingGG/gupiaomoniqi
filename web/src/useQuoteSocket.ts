import type {
  MarketSocketMessage,
  MarketMode,
  Quote,
  StockMarket,
} from "@gupiaomoniqi/shared";
import { useEffect, useRef, useState } from "react";
import { marketSocketUrl } from "./api";

export type ConnectionState = "connecting" | "live" | "offline";

export function useQuoteSocket(
  filter: {
    mode?: MarketMode;
    market?: StockMarket;
    instrumentId?: string;
  },
  onQuotes: (quotes: Quote[], messageType: MarketSocketMessage["type"]) => void,
): ConnectionState {
  const [connection, setConnection] =
    useState<ConnectionState>("connecting");
  const callbackRef = useRef(onQuotes);
  callbackRef.current = onQuotes;

  useEffect(() => {
    let disposed = false;
    let reconnectTimer: number | null = null;
    let socket: WebSocket | null = null;

    const connect = () => {
      if (disposed) {
        return;
      }

      setConnection("connecting");
      socket = new WebSocket(marketSocketUrl(filter));
      socket.addEventListener("open", () => {
        if (!disposed) {
          setConnection("live");
        }
      });
      socket.addEventListener("message", (event) => {
        if (disposed || typeof event.data !== "string") {
          return;
        }

        try {
          const message = JSON.parse(event.data) as MarketSocketMessage;
          callbackRef.current(message.data, message.type);
        } catch {
          setConnection("offline");
        }
      });
      socket.addEventListener("close", () => {
        if (!disposed) {
          setConnection("offline");
          reconnectTimer = window.setTimeout(connect, 2_000);
        }
      });
      socket.addEventListener("error", () => socket?.close());
    };

    connect();

    return () => {
      disposed = true;

      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }

      socket?.close();
    };
  }, [filter.instrumentId, filter.market, filter.mode]);

  return connection;
}
