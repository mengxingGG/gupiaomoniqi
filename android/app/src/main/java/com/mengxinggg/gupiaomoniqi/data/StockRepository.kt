package com.mengxinggg.gupiaomoniqi.data

import android.content.Context
import com.mengxinggg.gupiaomoniqi.model.AuthResult
import com.mengxinggg.gupiaomoniqi.model.ChartRange
import com.mengxinggg.gupiaomoniqi.model.ChartSeries
import com.mengxinggg.gupiaomoniqi.model.Currency
import com.mengxinggg.gupiaomoniqi.model.DailyCheckInStatus
import com.mengxinggg.gupiaomoniqi.model.EmailVerificationRequestResult
import com.mengxinggg.gupiaomoniqi.model.IndustryCount
import com.mengxinggg.gupiaomoniqi.model.Market
import com.mengxinggg.gupiaomoniqi.model.MarketItem
import com.mengxinggg.gupiaomoniqi.model.MarketMode
import com.mengxinggg.gupiaomoniqi.model.MarketQuery
import com.mengxinggg.gupiaomoniqi.model.LimitOrder
import com.mengxinggg.gupiaomoniqi.model.LimitOrderStatus
import com.mengxinggg.gupiaomoniqi.model.OrderBook
import com.mengxinggg.gupiaomoniqi.model.OrderCancellationResult
import com.mengxinggg.gupiaomoniqi.model.OrderSubmissionResult
import com.mengxinggg.gupiaomoniqi.model.Page
import com.mengxinggg.gupiaomoniqi.model.Portfolio
import com.mengxinggg.gupiaomoniqi.model.PublicAccount
import com.mengxinggg.gupiaomoniqi.model.PasswordResetConfirmResult
import com.mengxinggg.gupiaomoniqi.model.PasswordResetRequestResult
import com.mengxinggg.gupiaomoniqi.model.RewardClaimResult
import com.mengxinggg.gupiaomoniqi.model.TradeRequest
import com.mengxinggg.gupiaomoniqi.model.Transaction
import com.mengxinggg.gupiaomoniqi.model.Watchlist
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

interface StockRepository {
    var baseUrl: String
    val hasSession: Boolean

    suspend fun probeServer(baseUrl: String)
    fun clearLocalSession()

    suspend fun register(
        username: String,
        email: String,
        password: String,
        displayName: String,
    ): AuthResult

    suspend fun login(username: String, password: String): AuthResult
    suspend fun requestPasswordReset(email: String): PasswordResetRequestResult
    suspend fun confirmPasswordReset(
        email: String,
        code: String,
        newPassword: String,
    ): PasswordResetConfirmResult
    suspend fun requestEmailVerification(
        email: String,
    ): EmailVerificationRequestResult
    suspend fun confirmEmailVerification(
        email: String,
        code: String,
    ): PublicAccount
    suspend fun logout()
    suspend fun getCurrentAccount(): PublicAccount
    suspend fun updateDisplayCurrency(currency: Currency): PublicAccount
    suspend fun getMarket(query: MarketQuery): Page<MarketItem>
    suspend fun getIndustries(mode: MarketMode, market: Market?): List<IndustryCount>

    suspend fun getInstrument(
        instrumentId: String,
        mode: MarketMode,
    ): MarketItem

    suspend fun getChart(
        instrumentId: String,
        range: ChartRange,
        mode: MarketMode,
    ): ChartSeries

    suspend fun getOrderBook(
        instrumentId: String,
        mode: MarketMode,
    ): OrderBook

    suspend fun getPortfolio(mode: MarketMode): Portfolio
    suspend fun getTransactions(mode: MarketMode): List<Transaction>

    suspend fun submitOrder(
        mode: MarketMode,
        trade: TradeRequest,
    ): OrderSubmissionResult

    suspend fun getOrders(
        mode: MarketMode,
        status: LimitOrderStatus? = null,
    ): List<LimitOrder>

    suspend fun cancelOrder(
        mode: MarketMode,
        orderId: String,
    ): OrderCancellationResult

    suspend fun getWatchlist(mode: MarketMode): Watchlist

    suspend fun addToWatchlist(
        mode: MarketMode,
        instrumentId: String,
    ): Watchlist

    suspend fun removeFromWatchlist(
        mode: MarketMode,
        instrumentId: String,
    ): Watchlist

    suspend fun getCheckInStatus(): DailyCheckInStatus
    suspend fun claimDailyCheckIn(mode: MarketMode): RewardClaimResult

    suspend fun redeemGiftCode(
        mode: MarketMode,
        code: String,
        idempotencyKey: String,
    ): RewardClaimResult
}

class DefaultStockRepository(
    private val apiClient: ApiClient,
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
) : StockRepository {
    constructor(context: Context) : this(
        ApiClient(
            EncryptedTokenStore(context.applicationContext),
        ),
    )

    override var baseUrl: String
        get() = apiClient.baseUrl
        set(value) {
            apiClient.baseUrl = value
        }

    override val hasSession: Boolean
        get() = apiClient.hasSession

    override suspend fun probeServer(baseUrl: String): Unit =
        io { apiClient.probeServer(baseUrl) }

    override fun clearLocalSession() {
        apiClient.clearSession()
    }

    override suspend fun register(
        username: String,
        email: String,
        password: String,
        displayName: String,
    ): AuthResult = io { apiClient.register(username, email, password, displayName) }

    override suspend fun login(
        username: String,
        password: String,
    ): AuthResult = io { apiClient.login(username, password) }

    override suspend fun requestPasswordReset(
        email: String,
    ): PasswordResetRequestResult = io { apiClient.requestPasswordReset(email) }

    override suspend fun confirmPasswordReset(
        email: String,
        code: String,
        newPassword: String,
    ): PasswordResetConfirmResult = io {
        apiClient.confirmPasswordReset(email, code, newPassword)
    }

    override suspend fun requestEmailVerification(
        email: String,
    ): EmailVerificationRequestResult = io {
        apiClient.requestEmailVerification(email)
    }

    override suspend fun confirmEmailVerification(
        email: String,
        code: String,
    ): PublicAccount = io {
        apiClient.confirmEmailVerification(email, code)
    }

    override suspend fun logout(): Unit = io { apiClient.logout() }

    override suspend fun getCurrentAccount(): PublicAccount =
        io { apiClient.me() }

    override suspend fun updateDisplayCurrency(
        currency: Currency,
    ): PublicAccount = io { apiClient.updateDisplayCurrency(currency) }

    override suspend fun getMarket(
        query: MarketQuery,
    ): Page<MarketItem> = io { apiClient.market(query) }

    override suspend fun getIndustries(
        mode: MarketMode,
        market: Market?,
    ): List<IndustryCount> = io { apiClient.industries(mode, market) }

    override suspend fun getInstrument(
        instrumentId: String,
        mode: MarketMode,
    ): MarketItem = io { apiClient.instrument(instrumentId, mode) }

    override suspend fun getChart(
        instrumentId: String,
        range: ChartRange,
        mode: MarketMode,
    ): ChartSeries = io { apiClient.chart(instrumentId, range, mode) }

    override suspend fun getOrderBook(
        instrumentId: String,
        mode: MarketMode,
    ): OrderBook = io { apiClient.orderBook(instrumentId, mode) }

    override suspend fun getPortfolio(
        mode: MarketMode,
    ): Portfolio = io { apiClient.account(mode) }

    override suspend fun getTransactions(
        mode: MarketMode,
    ): List<Transaction> = io { apiClient.transactions(mode) }

    override suspend fun submitOrder(
        mode: MarketMode,
        trade: TradeRequest,
    ): OrderSubmissionResult = io { apiClient.submitOrder(mode, trade) }

    override suspend fun getOrders(
        mode: MarketMode,
        status: LimitOrderStatus?,
    ): List<LimitOrder> = io { apiClient.orders(mode, status) }

    override suspend fun cancelOrder(
        mode: MarketMode,
        orderId: String,
    ): OrderCancellationResult = io { apiClient.cancelOrder(mode, orderId) }

    override suspend fun getWatchlist(
        mode: MarketMode,
    ): Watchlist = io { apiClient.watchlist(mode) }

    override suspend fun addToWatchlist(
        mode: MarketMode,
        instrumentId: String,
    ): Watchlist = io { apiClient.addWatchlist(mode, instrumentId) }

    override suspend fun removeFromWatchlist(
        mode: MarketMode,
        instrumentId: String,
    ): Watchlist = io { apiClient.removeWatchlist(mode, instrumentId) }

    override suspend fun getCheckInStatus(): DailyCheckInStatus =
        io { apiClient.checkInStatus() }

    override suspend fun claimDailyCheckIn(
        mode: MarketMode,
    ): RewardClaimResult = io { apiClient.claimCheckIn(mode) }

    override suspend fun redeemGiftCode(
        mode: MarketMode,
        code: String,
        idempotencyKey: String,
    ): RewardClaimResult =
        io { apiClient.redeemGiftCode(mode, code, idempotencyKey) }

    private suspend fun <T> io(block: () -> T): T =
        withContext(ioDispatcher) { block() }
}
