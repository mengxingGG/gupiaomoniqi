package com.mengxinggg.gupiaomoniqi.model

enum class TradeSide {
    BUY,
    SELL,
}

enum class OrderMode {
    MARKET,
    LIMIT,
}

enum class LimitOrderStatus {
    OPEN,
    FILLED,
    CANCELLED,
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
    val limitPrice: Double? = null,
    val idempotencyKey: String? = null,
) {
    init {
        require(instrumentId.isNotBlank()) { "instrumentId must not be blank" }
        require(quantity > 0) { "quantity must be positive" }
        if (orderMode == OrderMode.LIMIT) {
            require(limitPrice != null && limitPrice.isFinite() && limitPrice > 0) {
                "limitPrice must be positive for a limit order"
            }
        }
    }
}

data class LimitOrder(
    val id: String,
    val mode: MarketMode,
    val instrumentId: String,
    val symbol: String,
    val name: String,
    val market: Market,
    val side: TradeSide,
    val orderMode: OrderMode,
    val status: LimitOrderStatus,
    val quantity: Int,
    val filledQuantity: Int,
    val limitPrice: Double?,
    val quoteCurrency: Currency,
    val reservedCashUsd: Double,
    val reservedQuantity: Int,
    val actorType: TradeActorType,
    val createdAt: String,
    val updatedAt: String,
    val filledAt: String?,
    val cancelledAt: String?,
    val transactionId: String?,
)

data class OrderSubmissionResult(
    val order: LimitOrder,
    val transaction: Transaction?,
    val portfolio: Portfolio,
)

data class OrderCancellationResult(
    val order: LimitOrder,
    val portfolio: Portfolio,
)

data class TradeResult(
    val transaction: Transaction,
    val portfolio: Portfolio,
)
