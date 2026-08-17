package com.mengxinggg.gupiaomoniqi.model

data class PublicAccount(
    val id: String,
    val username: String,
    val email: String?,
    val displayName: String,
    val displayCurrency: Currency,
    val createdAt: String,
)

data class AuthResult(
    val token: String,
    val account: PublicAccount,
)

data class PasswordResetRequestResult(
    val accepted: Boolean,
    val expiresInSeconds: Int,
)

data class PasswordResetConfirmResult(
    val reset: Boolean,
)

data class EmailVerificationRequestResult(
    val accepted: Boolean,
    val expiresInSeconds: Int,
)

data class Position(
    val instrumentId: String,
    val symbol: String,
    val name: String,
    val market: Market,
    val quoteCurrency: Currency,
    val quantity: Int,
    val availableQuantity: Int,
    val frozenQuantity: Int,
    val pendingSettlementQuantity: Int,
    val averageCostUsd: Double,
    val currentPriceUsd: Double,
    val marketValueUsd: Double,
    val profitLossUsd: Double,
    val profitLossPercent: Double,
)

data class Portfolio(
    val mode: MarketMode,
    val displayCurrency: Currency,
    val usdCnyRate: Double,
    val initialCashUsd: Double,
    val availableCashUsd: Double,
    val frozenCashUsd: Double,
    val positionsValueUsd: Double,
    val totalAssetsUsd: Double,
    val realizedProfitUsd: Double,
    val unrealizedProfitUsd: Double,
    val totalProfitLossUsd: Double,
    val positions: List<Position>,
)

typealias PortfolioSnapshot = Portfolio
