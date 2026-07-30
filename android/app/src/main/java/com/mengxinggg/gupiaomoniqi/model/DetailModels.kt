package com.mengxinggg.gupiaomoniqi.model

enum class ChartRange {
    INTRADAY,
    DAY,
    MONTH,
    YEAR,
}

enum class CandleSource {
    DATABASE_SNAPSHOT,
    TRANSACTION_BACKFILL,
    MARKET_TICK,
    REAL_PROVIDER_HISTORY,
    REAL_PROVIDER_SNAPSHOT,
}

data class Candle(
    val time: String,
    val open: Double,
    val high: Double,
    val low: Double,
    val close: Double,
    val volume: Long,
    val averagePrice: Double? = null,
    val source: CandleSource,
    val isPartial: Boolean,
)

enum class ChartSource {
    DATABASE_RECORDED,
    REAL_MARKET_RECORDED,
}

data class ChartSeries(
    val instrumentId: String,
    val range: ChartRange,
    val mode: MarketMode,
    val source: ChartSource,
    val candles: List<Candle>,
    val coverageStart: String?,
    val updatedAt: String,
    val referencePrice: Double? = null,
    val complete: Boolean? = null,
    val notice: String? = null,
)

data class OrderBookLevel(
    val price: Double,
    val quantity: Long,
    val orderCount: Int,
)

data class OrderBook(
    val instrumentId: String,
    val quoteCurrency: Currency,
    val mode: MarketMode,
    val asks: List<OrderBookLevel>,
    val bids: List<OrderBookLevel>,
    val updatedAt: String,
    val available: Boolean? = null,
    val notice: String? = null,
)

typealias OrderBookSnapshot = OrderBook
