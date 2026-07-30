package com.mengxinggg.gupiaomoniqi.model

enum class TradeSide {
    BUY,
    SELL,
}

enum class OrderMode {
    MARKET,
    LIMIT,
}

enum class TradeActorType {
    USER,
    AI,
}

data class Transaction(
    val id: String,
    val instrumentId: String,
    val symbol: String,
    val name: String,
    val market: Market,
    val side: TradeSide,
    val quantity: Int,
    val quotePrice: Double,
    val quoteCurrency: Currency,
    val fxRateToUsd: Double,
    val priceUsd: Double,
    val grossAmountUsd: Double,
    val feeUsd: Double,
    val netAmountUsd: Double,
    val realizedProfitUsd: Double?,
    val createdAt: String,
    val actorType: TradeActorType,
    val actorId: String? = null,
    val idempotencyKey: String? = null,
)

data class TradeRequest(
    val instrumentId: String,
    val side: TradeSide,
    val quantity: Int,
    val orderMode: OrderMode = OrderMode.MARKET,
    val idempotencyKey: String? = null,
) {
    init {
        require(instrumentId.isNotBlank()) { "instrumentId must not be blank" }
        require(quantity > 0) { "quantity must be positive" }
    }
}

data class TradeResult(
    val transaction: Transaction,
    val portfolio: Portfolio,
)
