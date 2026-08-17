package com.mengxinggg.gupiaomoniqi.ui

enum class AppScreen {
    MAIN,
    DETAIL,
    AUTH,
}

enum class MainTab(val label: String) {
    MARKET("行情"),
    WATCHLIST("自选"),
    ORDERS("订单"),
    ASSETS("资产"),
}

enum class UiMarketMode {
    VIRTUAL,
    REAL,
}

enum class UiDisplayCurrency(val symbol: String) {
    CNY("¥"),
    USD("$"),
}

enum class MarketFilter(val label: String) {
    ALL("全部"),
    CN("沪深"),
    HK("港股"),
    US("美股"),
    UK("英股"),
}

enum class ChangeSort(val label: String) {
    DEFAULT("涨跌幅"),
    DESC("涨跌幅 ↓"),
    ASC("涨跌幅 ↑"),
}

internal fun ChangeSort.next(): ChangeSort = when (this) {
    ChangeSort.DEFAULT -> ChangeSort.DESC
    ChangeSort.DESC -> ChangeSort.ASC
    ChangeSort.ASC -> ChangeSort.DEFAULT
}

enum class UiChartRange(val label: String) {
    INTRADAY("分时"),
    DAY("日 K"),
    MONTH("月 K"),
    YEAR("年 K"),
}

enum class UiTradeSide {
    BUY,
    SELL,
}

enum class UiOrderMode(val label: String) {
    MARKET("市价"),
    LIMIT("限价"),
}

enum class UiOrderStatus(val label: String) {
    OPEN("委托中"),
    FILLED("已成交"),
    CANCELLED("已撤单"),
}

enum class AuthMode {
    REGISTER,
    LOGIN,
    RESET,
}

data class AccountUi(
    val username: String,
    val email: String?,
    val displayName: String,
)

data class StockUi(
    val id: String,
    val symbol: String,
    val name: String,
    val market: String,
    val industry: String,
    val quoteCurrency: String,
    val currentPrice: Double,
    val previousClose: Double,
    val openPrice: Double,
    val highPrice: Double,
    val lowPrice: Double,
    val volume: Double,
    val changeAmount: Double,
    val changePercent: Double,
    val lotSize: Int,
    val settlementCycle: String,
    val tradable: Boolean,
    val updatedAt: String,
)

data class IndustryCountUi(
    val industry: String,
    val count: Int,
)

data class CandleUi(
    val time: String,
    val open: Double,
    val high: Double,
    val low: Double,
    val close: Double,
    val volume: Double,
    val averagePrice: Double? = null,
)

data class OrderBookLevelUi(
    val price: Double,
    val quantity: Double,
)

data class OrderBookUi(
    val asks: List<OrderBookLevelUi> = emptyList(),
    val bids: List<OrderBookLevelUi> = emptyList(),
    val available: Boolean = true,
    val notice: String? = null,
)

data class PositionUi(
    val instrumentId: String,
    val symbol: String,
    val name: String,
    val market: String,
    val quantity: Double,
    val availableQuantity: Double,
    val frozenQuantity: Double,
    val pendingSettlementQuantity: Double,
    val averageCostUsd: Double,
    val currentPriceUsd: Double,
    val marketValueUsd: Double,
    val profitLossUsd: Double,
    val profitLossPercent: Double,
)

data class PortfolioUi(
    val availableCashUsd: Double,
    val frozenCashUsd: Double,
    val positionsValueUsd: Double,
    val totalAssetsUsd: Double,
    val realizedProfitUsd: Double,
    val unrealizedProfitUsd: Double,
    val totalProfitLossUsd: Double,
    val positions: List<PositionUi>,
)

data class TransactionUi(
    val id: String,
    val instrumentId: String,
    val symbol: String,
    val name: String,
    val side: UiTradeSide,
    val quantity: Double,
    val priceUsd: Double,
    val netAmountUsd: Double,
    val realizedProfitUsd: Double?,
    val createdAt: String,
)

data class LimitOrderUi(
    val id: String,
    val instrumentId: String,
    val symbol: String,
    val name: String,
    val market: String,
    val side: UiTradeSide,
    val orderMode: UiOrderMode,
    val status: UiOrderStatus,
    val quantity: Double,
    val filledQuantity: Double,
    val limitPrice: Double?,
    val quoteCurrency: String,
    val reservedCashUsd: Double,
    val reservedQuantity: Double,
    val createdAt: String,
    val updatedAt: String,
)

data class CheckInUi(
    val claimed: Boolean,
    val rewardUsd: Double,
    val mode: UiMarketMode?,
)

data class TradeSheetUi(
    val stock: StockUi,
    val side: UiTradeSide,
    val orderMode: UiOrderMode = UiOrderMode.MARKET,
    val limitPriceInput: String = "",
    val limitPriceCurrency: UiDisplayCurrency,
    val lots: Int = 1,
    val maxLots: Int = 0,
    val idempotencyKey: String,
)

data class AppUiState(
    val screen: AppScreen = AppScreen.MAIN,
    val returnScreen: AppScreen = AppScreen.MAIN,
    val selectedTab: MainTab = MainTab.MARKET,
    val mode: UiMarketMode = UiMarketMode.VIRTUAL,
    val displayCurrency: UiDisplayCurrency = UiDisplayCurrency.CNY,
    val account: AccountUi? = null,
    val sessionRestoring: Boolean = false,
    val serverUrl: String = "",
    val settingsOpen: Boolean = false,
    val serverError: String? = null,
    val serverSaving: Boolean = false,
    val marketFilter: MarketFilter = MarketFilter.ALL,
    val industryFilter: String? = null,
    val industryOptions: List<IndustryCountUi> = emptyList(),
    val industriesLoading: Boolean = false,
    val industryDirectoryNotice: String? = null,
    val changeSort: ChangeSort = ChangeSort.DEFAULT,
    val searchQuery: String = "",
    val marketItems: List<StockUi> = emptyList(),
    val marketPage: Int = 1,
    val marketTotal: Int = 0,
    val marketLoading: Boolean = true,
    val marketRefreshing: Boolean = false,
    val marketLoadingMore: Boolean = false,
    val marketError: String? = null,
    val watchlistIds: Set<String> = emptySet(),
    val watchlistItems: List<StockUi> = emptyList(),
    val watchlistLoading: Boolean = false,
    val selectedInstrumentId: String? = null,
    val selectedStock: StockUi? = null,
    val detailLoading: Boolean = false,
    val detailError: String? = null,
    val chartRange: UiChartRange = UiChartRange.INTRADAY,
    val candles: List<CandleUi> = emptyList(),
    val chartLoading: Boolean = false,
    val chartNotice: String? = null,
    val orderBook: OrderBookUi? = null,
    val portfolio: PortfolioUi? = null,
    val transactions: List<TransactionUi> = emptyList(),
    val orders: List<LimitOrderUi> = emptyList(),
    val ordersUnavailable: Boolean = false,
    val accountLoading: Boolean = false,
    val accountError: String? = null,
    val cancellingOrderId: String? = null,
    val checkIn: CheckInUi? = null,
    val rewardBusy: Boolean = false,
    val authMode: AuthMode = AuthMode.REGISTER,
    val authBusy: Boolean = false,
    val authError: String? = null,
    val authNotice: String? = null,
    val authResetCodeSent: Boolean = false,
    val authRegistrationCodeSent: Boolean = false,
    val emailCompletionBusy: Boolean = false,
    val emailCompletionCodeSent: Boolean = false,
    val emailCompletionError: String? = null,
    val emailCompletionNotice: String? = null,
    val tradeSheet: TradeSheetUi? = null,
    val tradeBusy: Boolean = false,
    val tradeError: String? = null,
    val transientMessage: String? = null,
) {
    val hasMoreMarketItems: Boolean
        get() = marketItems.size < marketTotal

    val serverConfigured: Boolean
        get() = serverUrl.isNotBlank()

    val selectedPosition: PositionUi?
        get() = selectedStock?.id?.let { id ->
            portfolio?.positions?.firstOrNull { it.instrumentId == id }
        }
}

internal fun Double.asDisplayMoney(currency: UiDisplayCurrency): Double =
    if (currency == UiDisplayCurrency.CNY) this * 7.0 else this

internal fun StockUi.displayPrice(
    value: Double,
    currency: UiDisplayCurrency,
): Double {
    val valueUsd = if (quoteCurrency == "CNY") value / 7.0 else value
    return valueUsd.asDisplayMoney(currency)
}
