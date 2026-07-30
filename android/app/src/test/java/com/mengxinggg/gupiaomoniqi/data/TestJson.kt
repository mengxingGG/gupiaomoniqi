package com.mengxinggg.gupiaomoniqi.data

internal object TestJson {
    val account = """
        {
          "id": "account-1",
          "username": "trader_1",
          "displayName": "Trader One",
          "displayCurrency": "CNY",
          "createdAt": "2026-07-30T01:00:00.000Z"
        }
    """.trimIndent()

    val instrument = """
        {
          "id": "us-aapl",
          "symbol": "AAPL",
          "name": "Apple",
          "market": "US",
          "sourceCurrency": "USD",
          "quoteCurrency": "USD",
          "type": "STOCK_REAL",
          "industry": "Technology",
          "isTradable": true,
          "lotSize": 1,
          "settlementCycle": "T1"
        }
    """.trimIndent()

    val quote = """
        {
          "instrumentId": "us-aapl",
          "symbol": "AAPL",
          "market": "US",
          "quoteCurrency": "USD",
          "currentPrice": 213.44,
          "previousClose": 210.00,
          "openPrice": 211.00,
          "highPrice": 214.10,
          "lowPrice": 209.80,
          "volume": 12345678,
          "changeAmount": 3.44,
          "changePercent": 1.638095,
          "updatedAt": "2026-07-30T01:01:00.000Z",
          "receivedAt": null
        }
    """.trimIndent()

    val marketItem = """
        {
          "instrument": $instrument,
          "quote": $quote
        }
    """.trimIndent()

    val position = """
        {
          "instrumentId": "us-aapl",
          "symbol": "AAPL",
          "name": "Apple",
          "market": "US",
          "quoteCurrency": "USD",
          "quantity": 12,
          "availableQuantity": 10,
          "frozenQuantity": 1,
          "pendingSettlementQuantity": 1,
          "averageCostUsd": 200.00,
          "currentPriceUsd": 213.44,
          "marketValueUsd": 2561.28,
          "profitLossUsd": 161.28,
          "profitLossPercent": 6.72
        }
    """.trimIndent()

    val portfolio = """
        {
          "mode": "REAL",
          "displayCurrency": "CNY",
          "usdCnyRate": 7,
          "initialCashUsd": 100000,
          "availableCashUsd": 95000,
          "frozenCashUsd": 100,
          "positionsValueUsd": 2561.28,
          "totalAssetsUsd": 97661.28,
          "realizedProfitUsd": 10,
          "unrealizedProfitUsd": 161.28,
          "totalProfitLossUsd": 171.28,
          "positions": [$position]
        }
    """.trimIndent()

    val transaction = """
        {
          "id": "transaction-1",
          "instrumentId": "us-aapl",
          "symbol": "AAPL",
          "name": "Apple",
          "market": "US",
          "side": "BUY",
          "quantity": 12,
          "quotePrice": 200,
          "quoteCurrency": "USD",
          "fxRateToUsd": 1,
          "priceUsd": 200,
          "grossAmountUsd": 2400,
          "feeUsd": 1,
          "netAmountUsd": 2401,
          "realizedProfitUsd": null,
          "createdAt": "2026-07-30T01:02:00.000Z",
          "actorType": "USER",
          "actorId": null,
          "idempotencyKey": "trade-key-0001"
        }
    """.trimIndent()
}
