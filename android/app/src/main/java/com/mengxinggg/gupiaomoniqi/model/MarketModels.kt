package com.mengxinggg.gupiaomoniqi.model

/**
 * The two server-side ledgers. Every request whose endpoint supports a mode must
 * receive one explicitly; there is deliberately no client-side default here.
 */
enum class MarketMode {
    VIRTUAL,
    REAL,
}

enum class Market {
    CN,
    HK,
    US,
    UK,
}

/**
 * A single currency type is used for source, quote, and display currencies.
 * The API currently limits display currencies to CNY and USD.
 */
enum class Currency {
    CNY,
    HKD,
    USD,
    GBP,
}

enum class InstrumentType {
    STOCK_VIRTUAL,
    STOCK_REAL,
}

enum class SettlementCycle {
    T0,
    T1,
}

enum class MarketSort {
    DEFAULT,
    CHANGE_PERCENT,
}

enum class SortOrder {
    DESC,
    ASC,
}

data class Instrument(
    val id: String,
    val symbol: String,
    val name: String,
    val market: Market,
    val sourceCurrency: Currency,
    val quoteCurrency: Currency,
    val type: InstrumentType,
    val industry: String,
    val isTradable: Boolean,
    val lotSize: Int,
    val settlementCycle: SettlementCycle,
)

data class Quote(
    val instrumentId: String,
    val symbol: String,
    val market: Market,
    val quoteCurrency: Currency,
    val currentPrice: Double,
    val previousClose: Double,
    val openPrice: Double,
    val highPrice: Double,
    val lowPrice: Double,
    val volume: Long,
    val changeAmount: Double,
    val changePercent: Double,
    val updatedAt: String,
    val receivedAt: String? = null,
)

data class MarketItem(
    val instrument: Instrument,
    val quote: Quote,
)

data class Page<T>(
    val items: List<T>,
    val total: Int,
    val page: Int,
    val pageSize: Int,
)

typealias Paginated<T> = Page<T>

data class MarketQuery(
    val mode: MarketMode,
    val market: Market? = null,
    val search: String? = null,
    val page: Int = 1,
    val pageSize: Int = 50,
    val watchlistOnly: Boolean = false,
    val sortBy: MarketSort = MarketSort.DEFAULT,
    val sortOrder: SortOrder = SortOrder.DESC,
) {
    init {
        require(page > 0) { "page must be positive" }
        require(pageSize in 1..300) { "pageSize must be between 1 and 300" }
    }
}
