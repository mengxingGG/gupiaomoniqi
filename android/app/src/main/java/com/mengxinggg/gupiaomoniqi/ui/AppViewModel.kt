package com.mengxinggg.gupiaomoniqi.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.mengxinggg.gupiaomoniqi.data.ApiClientException
import com.mengxinggg.gupiaomoniqi.data.ApiUrl
import com.mengxinggg.gupiaomoniqi.data.StockRepository
import com.mengxinggg.gupiaomoniqi.model.Candle
import com.mengxinggg.gupiaomoniqi.model.ChartRange
import com.mengxinggg.gupiaomoniqi.model.Currency
import com.mengxinggg.gupiaomoniqi.model.DailyCheckInStatus
import com.mengxinggg.gupiaomoniqi.model.Market
import com.mengxinggg.gupiaomoniqi.model.MarketItem
import com.mengxinggg.gupiaomoniqi.model.MarketMode
import com.mengxinggg.gupiaomoniqi.model.MarketQuery
import com.mengxinggg.gupiaomoniqi.model.LimitOrder
import com.mengxinggg.gupiaomoniqi.model.LimitOrderStatus
import com.mengxinggg.gupiaomoniqi.model.OrderBook
import com.mengxinggg.gupiaomoniqi.model.OrderBookLevel
import com.mengxinggg.gupiaomoniqi.model.OrderMode
import com.mengxinggg.gupiaomoniqi.model.Portfolio
import com.mengxinggg.gupiaomoniqi.model.Position
import com.mengxinggg.gupiaomoniqi.model.PublicAccount
import com.mengxinggg.gupiaomoniqi.model.TradeRequest
import com.mengxinggg.gupiaomoniqi.model.TradeSide
import com.mengxinggg.gupiaomoniqi.model.Transaction
import com.mengxinggg.gupiaomoniqi.model.Watchlist
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

private const val MARKET_PAGE_SIZE = 30
private const val REAL_REFRESH_INTERVAL_MS = 2_000L
private const val VIRTUAL_REFRESH_INTERVAL_MS = 3_000L

private data class PrivateRequestContext(
    val serverEpoch: Long,
    val sessionEpoch: Long,
    val mode: UiMarketMode,
)

private data class GiftAttempt(
    val context: PrivateRequestContext,
    val normalizedCode: String,
    val idempotencyKey: String,
)

private data class PendingTrade(
    val instrumentId: String,
    val mode: UiMarketMode,
    val side: UiTradeSide,
)

private data class InstrumentIdentity(
    val market: String,
    val symbol: String,
)

private data class SilentDetailRefresh(
    val item: MarketItem,
    val orderBook: OrderBook?,
    val portfolio: Portfolio?,
    val sessionError: Throwable?,
    val chart: List<CandleUi>?,
    val chartNotice: String?,
)

private data class AccountSnapshot(
    val portfolio: Portfolio,
    val transactions: List<Transaction>,
    val orders: List<LimitOrder>,
    val checkIn: DailyCheckInStatus,
)

class AppViewModel(
    private val repository: StockRepository,
) : ViewModel() {
    private val initialServerUrl = repository.baseUrl
    private val _uiState = MutableStateFlow(
        AppUiState(
            serverUrl = initialServerUrl,
            sessionRestoring = initialServerUrl.isNotBlank() && repository.hasSession,
            marketLoading = initialServerUrl.isNotBlank(),
            marketError = if (initialServerUrl.isBlank()) "请先设置服务器" else null,
        ),
    )
    val uiState: StateFlow<AppUiState> = _uiState.asStateFlow()

    private var marketJob: Job? = null
    private var searchJob: Job? = null
    private var detailJob: Job? = null
    private var chartJob: Job? = null
    private var modeMappingJob: Job? = null
    private var authJob: Job? = null
    private var tradeJob: Job? = null
    private var liveRefreshJob: Job? = null
    private var liveRefreshRequested = false
    private var pendingTrade: PendingTrade? = null
    private var activeTradeAttemptId: String? = null
    private var giftAttempt: GiftAttempt? = null
    private var serverEpoch = 0L
    private var sessionEpoch = 0L
    private var marketRequestId = 0L
    private var detailRequestId = 0L
    private var chartRequestId = 0L
    private var watchlistRequestId = 0L
    private var accountRequestId = 0L
    private var transactionsRequestId = 0L
    private var ordersRequestId = 0L
    private var settingsRequestId = 0L
    private var modeMappingRequestId = 0L
    private var portfolioMutationEpoch = 0L

    init {
        if (initialServerUrl.isNotBlank()) {
            loadMarket(reset = true)
            restoreSession()
        }
    }

    fun startLiveRefresh() {
        liveRefreshRequested = true
        if (liveRefreshJob?.isActive == true) return
        liveRefreshJob = viewModelScope.launch {
            var cycle = 0L
            while (isActive) {
                val interval = if (_uiState.value.mode == UiMarketMode.REAL) {
                    REAL_REFRESH_INTERVAL_MS
                } else {
                    VIRTUAL_REFRESH_INTERVAL_MS
                }
                delay(interval)
                cycle += 1
                refreshVisibleData(cycle)
            }
        }
    }

    fun stopLiveRefresh() {
        liveRefreshRequested = false
        liveRefreshJob?.cancel()
        liveRefreshJob = null
    }

    fun selectTab(tab: MainTab) {
        if (_uiState.value.tradeBusy) {
            _uiState.update {
                it.copy(transientMessage = "请等待当前交易提交完成。")
            }
            return
        }
        _uiState.update { it.copy(selectedTab = tab, screen = AppScreen.MAIN) }
        when (tab) {
            MainTab.MARKET -> Unit
            MainTab.WATCHLIST -> loadWatchlist()
            MainTab.ASSETS -> loadAccountData()
        }
    }

    fun changeMode(mode: UiMarketMode) {
        val current = _uiState.value
        if (current.mode == mode) return
        if (current.tradeBusy || current.rewardBusy || current.cancellingOrderId != null) {
            _uiState.update {
                it.copy(transientMessage = "请等待当前操作完成后再切换模拟盘。")
            }
            return
        }
        val selectedIdentity = current.selectedStock
            ?.let { InstrumentIdentity(it.market, it.symbol) }
            ?: current.selectedInstrumentId?.let { selectedId ->
                (current.marketItems + current.watchlistItems)
                    .firstOrNull { it.id == selectedId }
                    ?.let { InstrumentIdentity(it.market, it.symbol) }
            }
        modeMappingJob?.cancel()
        modeMappingRequestId += 1
        if (current.screen == AppScreen.DETAIL) {
            detailJob?.cancel()
            chartJob?.cancel()
            detailRequestId += 1
            chartRequestId += 1
        }
        _uiState.update {
            it.copy(
                mode = mode,
                marketItems = emptyList(),
                marketPage = 1,
                marketTotal = 0,
                marketError = null,
                watchlistIds = emptySet(),
                watchlistItems = emptyList(),
                selectedInstrumentId = null,
                selectedStock = null,
                candles = emptyList(),
                orderBook = null,
                portfolio = null,
                transactions = emptyList(),
                orders = emptyList(),
                detailLoading = current.screen == AppScreen.DETAIL && selectedIdentity != null,
                chartLoading = current.screen == AppScreen.DETAIL && selectedIdentity != null,
                detailError = null,
                accountError = null,
                tradeSheet = null,
            )
        }
        loadMarket(reset = true)
        if (_uiState.value.account != null) {
            loadWatchlist()
            if (_uiState.value.selectedTab == MainTab.ASSETS) loadAccountData()
        }
        if (current.screen == AppScreen.DETAIL) {
            if (selectedIdentity == null) {
                returnToMarketAfterModeSwitch("无法识别当前股票，已返回行情列表。")
            } else {
                resolveInstrumentAfterModeChange(mode, selectedIdentity)
            }
        }
    }

    private fun resolveInstrumentAfterModeChange(
        mode: UiMarketMode,
        identity: InstrumentIdentity,
    ) {
        val market = Market.entries.firstOrNull {
            it.name.equals(identity.market, ignoreCase = true)
        }
        if (market == null) {
            returnToMarketAfterModeSwitch("当前股票所属市场无法映射，已返回行情列表。")
            return
        }
        val requestId = modeMappingRequestId
        val requestServerEpoch = serverEpoch
        modeMappingJob = viewModelScope.launch {
            val page = try {
                repository.getMarket(
                    MarketQuery(
                        mode = mode.toModel(),
                        market = market,
                        search = identity.symbol,
                        page = 1,
                        pageSize = 300,
                    ),
                )
            } catch (error: CancellationException) {
                throw error
            } catch (_: Throwable) {
                null
            }
            val current = _uiState.value
            if (
                requestId != modeMappingRequestId ||
                requestServerEpoch != serverEpoch ||
                current.mode != mode ||
                current.screen != AppScreen.DETAIL
            ) {
                return@launch
            }
            val mapped = page?.items?.let {
                findModeMappedInstrument(it, identity.market, identity.symbol)
            }
            if (mapped == null) {
                returnToMarketAfterModeSwitch(
                    "${identity.market} · ${identity.symbol} 在当前模拟盘中不存在，已返回行情列表。",
                )
                return@launch
            }
            _uiState.update { it.copy(selectedStock = mapped.toUi()) }
            openStock(mapped.instrument.id)
        }
    }

    private fun returnToMarketAfterModeSwitch(message: String) {
        _uiState.update {
            it.copy(
                screen = AppScreen.MAIN,
                selectedTab = MainTab.MARKET,
                selectedInstrumentId = null,
                selectedStock = null,
                detailLoading = false,
                chartLoading = false,
                candles = emptyList(),
                orderBook = null,
                tradeSheet = null,
                detailError = null,
                transientMessage = message,
            )
        }
    }

    fun changeDisplayCurrency(currency: UiDisplayCurrency) {
        if (_uiState.value.displayCurrency == currency) return
        _uiState.update {
            it.copy(
                displayCurrency = currency,
                tradeSheet = it.tradeSheet?.convertLimitDisplayCurrency(currency),
            )
        }
        if (_uiState.value.account == null) return
        val requestEpoch = sessionEpoch
        viewModelScope.launch {
            runCatching {
                repository.updateDisplayCurrency(currency.toModel())
            }.onSuccess { account ->
                if (!sessionMatches(requestEpoch)) return@onSuccess
                _uiState.update {
                    it.copy(
                        account = account.toUi(),
                        displayCurrency = account.displayCurrency.toUiDisplay(),
                    )
                }
            }.onFailure { error ->
                if (error is CancellationException) return@onFailure
                if (!sessionMatches(requestEpoch)) return@onFailure
                if (handleSessionExpiry(error)) return@onFailure
                _uiState.update {
                    it.copy(transientMessage = error.userMessage("显示币种更新失败"))
                }
            }
        }
    }

    fun setSearchQuery(query: String) {
        _uiState.update { it.copy(searchQuery = query) }
        searchJob?.cancel()
        searchJob = viewModelScope.launch {
            delay(300)
            loadMarket(reset = true)
        }
    }

    fun setMarketFilter(filter: MarketFilter) {
        if (_uiState.value.marketFilter == filter) return
        _uiState.update { it.copy(marketFilter = filter) }
        loadMarket(reset = true)
    }

    fun refreshMarket() {
        loadMarket(reset = true, refreshing = _uiState.value.marketItems.isNotEmpty())
    }

    fun loadMoreMarket() {
        val state = _uiState.value
        if (state.marketLoadingMore || !state.hasMoreMarketItems) return
        loadMarket(reset = false)
    }

    fun openStock(instrumentId: String) {
        _uiState.update {
            it.copy(
                screen = AppScreen.DETAIL,
                selectedInstrumentId = instrumentId,
                selectedStock = if (it.selectedStock?.id == instrumentId) {
                    it.selectedStock
                } else {
                    null
                },
                detailLoading = true,
                detailError = null,
                chartLoading = true,
                candles = emptyList(),
                chartNotice = null,
                orderBook = null,
                tradeSheet = null,
                tradeError = null,
            )
        }
        loadDetail(instrumentId)
    }

    fun retryDetail() {
        _uiState.value.selectedInstrumentId?.let(::loadDetail)
    }

    fun closeDetail() {
        if (_uiState.value.tradeBusy) {
            _uiState.update {
                it.copy(transientMessage = "交易正在提交，请稍候。")
            }
            return
        }
        detailJob?.cancel()
        chartJob?.cancel()
        detailRequestId += 1
        chartRequestId += 1
        _uiState.update {
            it.copy(
                screen = AppScreen.MAIN,
                selectedInstrumentId = null,
                selectedStock = null,
                candles = emptyList(),
                orderBook = null,
                tradeSheet = null,
            )
        }
    }

    fun changeChartRange(range: UiChartRange) {
        if (_uiState.value.chartRange == range) return
        _uiState.update {
            it.copy(
                chartRange = range,
                candles = emptyList(),
                chartLoading = true,
                chartNotice = null,
            )
        }
        _uiState.value.selectedStock?.id?.let(::loadChart)
    }

    fun openAuth() {
        val state = _uiState.value
        if (!state.serverConfigured) {
            openSettings()
            return
        }
        if (state.sessionRestoring) {
            _uiState.update {
                it.copy(transientMessage = "正在恢复登录状态，请稍候。")
            }
            return
        }
        _uiState.update {
            it.copy(
                returnScreen = if (state.screen == AppScreen.AUTH) AppScreen.MAIN else state.screen,
                screen = AppScreen.AUTH,
                authError = null,
            )
        }
    }

    fun closeAuth() {
        if (_uiState.value.authBusy) return
        pendingTrade = null
        _uiState.update {
            it.copy(
                screen = it.returnScreen,
                authError = null,
                authBusy = false,
            )
        }
    }

    fun changeAuthMode(mode: AuthMode) {
        _uiState.update { it.copy(authMode = mode, authError = null) }
    }

    fun accountAction() {
        val state = _uiState.value
        when {
            state.sessionRestoring -> {
                _uiState.update {
                    it.copy(transientMessage = "正在恢复登录状态，请稍候。")
                }
            }
            state.account == null -> openAuth()
            else -> selectTab(MainTab.ASSETS)
        }
    }

    fun openSettings() {
        _uiState.update {
            it.copy(settingsOpen = true, serverError = null)
        }
    }

    fun closeSettings() {
        if (_uiState.value.serverSaving) return
        _uiState.update {
            it.copy(settingsOpen = false, serverError = null)
        }
    }

    fun saveServerUrl(rawUrl: String) {
        if (_uiState.value.serverSaving) return
        val normalized = runCatching {
            ApiUrl.normalizeOptionalBaseUrl(rawUrl)
        }.getOrElse { error ->
            _uiState.update {
                it.copy(serverError = error.userMessage("服务器地址格式无效"))
            }
            return
        }
        if (normalized.isBlank()) {
            _uiState.update {
                it.copy(serverError = "服务器地址不能为空。")
            }
            return
        }
        val previousUrl = repository.baseUrl
        val addressChanged = normalized != previousUrl
        val settingsRequest = ++settingsRequestId
        _uiState.update {
            it.copy(
                serverSaving = true,
                serverError = null,
            )
        }
        viewModelScope.launch {
            var liveRefreshPausedForSwitch = false
            try {
                repository.probeServer(normalized)
                if (settingsRequest != settingsRequestId) return@launch

                if (!addressChanged) {
                    repository.baseUrl = normalized
                    _uiState.update {
                        it.copy(
                            serverUrl = repository.baseUrl,
                            settingsOpen = false,
                            serverSaving = false,
                            serverError = null,
                            transientMessage = "服务器连接正常。",
                        )
                    }
                    loadMarket(
                        reset = true,
                        refreshing = _uiState.value.marketItems.isNotEmpty(),
                    )
                    return@launch
                }

                liveRefreshJob?.cancel()
                liveRefreshJob = null
                liveRefreshPausedForSwitch = true
                serverEpoch += 1
                sessionEpoch += 1
                marketJob?.cancel()
                detailJob?.cancel()
                chartJob?.cancel()
                authJob?.cancel()
                tradeJob?.cancel()
                marketRequestId += 1
                detailRequestId += 1
                chartRequestId += 1
                watchlistRequestId += 1
                accountRequestId += 1
                transactionsRequestId += 1
                ordersRequestId += 1
                pendingTrade = null
                giftAttempt = null
                activeTradeAttemptId = null
                // 换服只清理本机令牌，不等待已经失联的旧服务器注销响应。
                repository.baseUrl = normalized
                repository.clearLocalSession()
                val storedUrl = repository.baseUrl
                _uiState.update {
                    it.copy(
                        serverUrl = storedUrl,
                        settingsOpen = false,
                        serverSaving = false,
                        serverError = null,
                        account = null,
                        sessionRestoring = false,
                        portfolio = null,
                        transactions = emptyList(),
                        orders = emptyList(),
                        watchlistIds = emptySet(),
                        watchlistItems = emptyList(),
                        checkIn = null,
                        selectedTab = MainTab.MARKET,
                        screen = AppScreen.MAIN,
                        selectedInstrumentId = null,
                        selectedStock = null,
                        candles = emptyList(),
                        orderBook = null,
                        tradeSheet = null,
                        tradeBusy = false,
                        cancellingOrderId = null,
                        rewardBusy = false,
                        accountLoading = false,
                        marketItems = emptyList(),
                        marketTotal = 0,
                        marketLoading = true,
                        marketError = null,
                    )
                }
                loadMarket(reset = true)
                if (liveRefreshRequested) startLiveRefresh()
            } catch (error: CancellationException) {
                throw error
            } catch (error: Throwable) {
                if (settingsRequest != settingsRequestId) return@launch
                if (
                    liveRefreshPausedForSwitch &&
                    liveRefreshRequested &&
                    liveRefreshJob == null
                ) {
                    startLiveRefresh()
                }
                _uiState.update {
                    it.copy(
                        serverSaving = false,
                        serverError = error.userMessage("无法连接服务器"),
                    )
                }
            }
        }
    }

    fun authenticate(
        mode: AuthMode,
        username: String,
        displayName: String,
        password: String,
    ) {
        if (!_uiState.value.serverConfigured) {
            openSettings()
            return
        }
        if (_uiState.value.authBusy) return
        if (username.isBlank() || password.isBlank() || (mode == AuthMode.REGISTER && displayName.isBlank())) {
            _uiState.update { it.copy(authError = "请完整填写账户信息。") }
            return
        }
        val requestEpoch = ++sessionEpoch
        giftAttempt = null
        _uiState.update { it.copy(authBusy = true, authError = null) }
        authJob = viewModelScope.launch {
            runCatching {
                if (mode == AuthMode.REGISTER) {
                    repository.register(username, password, displayName)
                } else {
                    repository.login(username, password)
                }
            }.onSuccess { result ->
                if (sessionEpoch != requestEpoch) return@onSuccess
                _uiState.update {
                    it.copy(
                        account = result.account.toUi(),
                        displayCurrency = result.account.displayCurrency.toUiDisplay(),
                        screen = it.returnScreen,
                        sessionRestoring = false,
                        authBusy = false,
                        authError = null,
                        transientMessage = if (mode == AuthMode.REGISTER) {
                            "注册成功，两个模拟盘已准备就绪。"
                        } else {
                            "登录成功。"
                        },
                    )
                }
                loadUserData(openPendingTrade = true)
            }.onFailure { error ->
                if (error is CancellationException) return@onFailure
                if (sessionEpoch != requestEpoch) return@onFailure
                _uiState.update {
                    it.copy(
                        authBusy = false,
                        authError = error.userMessage("登录失败，请重试"),
                    )
                }
            }
        }
    }

    fun logout() {
        val state = _uiState.value
        if (state.tradeBusy || state.rewardBusy || state.cancellingOrderId != null) {
            _uiState.update {
                it.copy(transientMessage = "请等待当前操作完成后再退出。")
            }
            return
        }
        val requestEpoch = ++sessionEpoch
        pendingTrade = null
        giftAttempt = null
        activeTradeAttemptId = null
        _uiState.update {
            it.copy(
                account = null,
                sessionRestoring = true,
                portfolio = null,
                transactions = emptyList(),
                orders = emptyList(),
                watchlistIds = emptySet(),
                watchlistItems = emptyList(),
                checkIn = null,
                selectedTab = MainTab.MARKET,
                screen = AppScreen.MAIN,
                accountLoading = false,
                rewardBusy = false,
                tradeSheet = null,
                tradeBusy = false,
                cancellingOrderId = null,
                transientMessage = "已退出登录。",
            )
        }
        viewModelScope.launch {
            runCatching { repository.logout() }
            if (sessionEpoch != requestEpoch) return@launch
            _uiState.update {
                it.copy(
                    sessionRestoring = false,
                )
            }
        }
    }

    fun refreshWatchlist() {
        loadWatchlist()
    }

    fun toggleWatchlist(instrumentId: String) {
        if (_uiState.value.sessionRestoring) {
            _uiState.update {
                it.copy(transientMessage = "正在恢复登录状态，请稍候。")
            }
            return
        }
        if (_uiState.value.account == null) {
            openAuth()
            return
        }
        val context = privateRequestContext() ?: return
        val requestId = ++watchlistRequestId
        val removing = instrumentId in _uiState.value.watchlistIds
        viewModelScope.launch {
            runCatching {
                if (removing) {
                    repository.removeFromWatchlist(context.mode.toModel(), instrumentId)
                } else {
                    repository.addToWatchlist(context.mode.toModel(), instrumentId)
                }
            }.onSuccess { watchlist ->
                if (
                    requestId != watchlistRequestId ||
                    !privateContextMatches(context)
                ) {
                    return@onSuccess
                }
                applyWatchlist(watchlist)
                _uiState.update {
                    it.copy(
                        transientMessage = if (removing) "已移出自选。" else "已加入自选。",
                    )
                }
            }.onFailure { error ->
                if (error is CancellationException) return@onFailure
                if (
                    requestId != watchlistRequestId ||
                    !privateContextMatches(context)
                ) {
                    return@onFailure
                }
                if (handleSessionExpiry(error)) return@onFailure
                _uiState.update {
                    it.copy(transientMessage = error.userMessage("自选更新失败"))
                }
            }
        }
    }

    fun refreshAccount() {
        loadAccountData()
    }

    fun claimCheckIn() {
        val state = _uiState.value
        if (state.account == null) {
            openAuth()
            return
        }
        if (state.rewardBusy || state.checkIn?.claimed == true) return
        val context = privateRequestContext() ?: return
        accountRequestId += 1
        _uiState.update { it.copy(rewardBusy = true) }
        viewModelScope.launch {
            runCatching {
                repository.claimDailyCheckIn(context.mode.toModel())
            }.onSuccess { result ->
                if (!privateContextMatches(context)) return@onSuccess
                _uiState.update {
                    it.copy(
                        rewardBusy = false,
                        portfolio = result.portfolio.toUi(),
                        checkIn = CheckInUi(
                            claimed = true,
                            rewardUsd = result.amountUsd,
                            mode = result.mode.toUi(),
                        ),
                        transientMessage = "签到成功，${formatMoney(result.amountUsd, it.displayCurrency)} 已入账。",
                    )
                }
            }.onFailure { error ->
                if (error is CancellationException) return@onFailure
                if (!privateContextMatches(context)) return@onFailure
                if (handleSessionExpiry(error)) return@onFailure
                _uiState.update {
                    it.copy(
                        rewardBusy = false,
                        transientMessage = error.userMessage("签到失败"),
                    )
                }
            }
        }
    }

    fun redeemGiftCode(code: String) {
        if (_uiState.value.account == null) {
            openAuth()
            return
        }
        if (code.isBlank() || _uiState.value.rewardBusy) return
        val context = privateRequestContext() ?: return
        // 礼包码由服务端按原始大小写匹配，只去掉用户误输入的首尾空格。
        val normalizedCode = code.trim()
        val attempt = giftAttempt
            ?.takeIf {
                it.context == context && it.normalizedCode == normalizedCode
            }
            ?: GiftAttempt(
                context = context,
                normalizedCode = normalizedCode,
                idempotencyKey = UUID.randomUUID().toString(),
            ).also { giftAttempt = it }
        accountRequestId += 1
        _uiState.update { it.copy(rewardBusy = true) }
        viewModelScope.launch {
            runCatching {
                repository.redeemGiftCode(
                    mode = context.mode.toModel(),
                    code = normalizedCode,
                    idempotencyKey = attempt.idempotencyKey,
                )
            }.onSuccess { result ->
                if (!privateContextMatches(context)) return@onSuccess
                giftAttempt = null
                _uiState.update {
                    it.copy(
                        rewardBusy = false,
                        portfolio = result.portfolio.toUi(),
                        transientMessage =
                            "礼包领取成功，${formatMoney(result.amountUsd, it.displayCurrency)} 已入账。",
                    )
                }
            }.onFailure { error ->
                if (error is CancellationException) return@onFailure
                if (!privateContextMatches(context)) return@onFailure
                if (handleSessionExpiry(error)) return@onFailure
                _uiState.update {
                    it.copy(
                        rewardBusy = false,
                        transientMessage = error.userMessage("礼包码领取失败"),
                    )
                }
            }
        }
    }

    fun requestTrade(side: UiTradeSide) {
        val state = _uiState.value
        val stock = state.selectedStock ?: return
        val requestedTrade = PendingTrade(
            instrumentId = stock.id,
            mode = state.mode,
            side = side,
        )
        if (state.sessionRestoring) {
            pendingTrade = requestedTrade
            _uiState.update {
                it.copy(transientMessage = "正在恢复账户，完成后会继续本次交易。")
            }
            return
        }
        if (state.account == null) {
            pendingTrade = requestedTrade
            openAuth()
            return
        }
        if (tradeJob?.isActive == true) {
            _uiState.update {
                it.copy(transientMessage = "上一笔交易正在提交，请稍候。")
            }
            return
        }
        if (state.accountLoading || state.portfolio == null) {
            pendingTrade = requestedTrade
            _uiState.update {
                it.copy(transientMessage = "正在同步可用资金与持仓…")
            }
            loadUserData(openPendingTrade = true)
            return
        }
        showTradeSheet(side)
    }

    fun updateTradeLots(lots: Int) {
        _uiState.update { state ->
            val sheet = state.tradeSheet ?: return@update state
            state.copy(
                tradeSheet = sheet.changeLots(lots),
                tradeError = null,
            )
        }
    }

    fun updateOrderMode(mode: UiOrderMode) {
        _uiState.update { state ->
            val sheet = state.tradeSheet ?: return@update state
            state.copy(
                tradeSheet = sheet.changeOrderMode(mode, state.portfolio),
                tradeError = null,
            )
        }
    }

    fun updateLimitPrice(raw: String) {
        _uiState.update { state ->
            val sheet = state.tradeSheet ?: return@update state
            state.copy(
                tradeSheet = sheet.changeLimitPrice(raw, state.portfolio),
                tradeError = null,
            )
        }
    }

    fun selectTradePercentage(percent: Int) {
        _uiState.update { state ->
            val sheet = state.tradeSheet ?: return@update state
            state.copy(
                tradeSheet = sheet.selectPercentage(percent, state.portfolio),
                tradeError = null,
            )
        }
    }

    fun dismissTradeSheet() {
        if (_uiState.value.tradeBusy || tradeJob?.isActive == true) return
        _uiState.update { it.copy(tradeSheet = null, tradeError = null) }
    }

    fun submitTrade() {
        val state = _uiState.value
        val sheet = state.tradeSheet ?: return
        if (
            state.tradeBusy ||
            tradeJob?.isActive == true ||
            sheet.lots <= 0 ||
            sheet.lots > sheet.maxLots
        ) {
            return
        }
        val context = privateRequestContext() ?: return
        val attemptId = sheet.idempotencyKey
        val quantity = sheet.lots * sheet.stock.lotSize
        accountRequestId += 1
        val mutationEpoch = ++portfolioMutationEpoch
        activeTradeAttemptId = attemptId
        _uiState.update {
            it.copy(tradeBusy = true, tradeError = null, accountLoading = false)
        }
        tradeJob = viewModelScope.launch {
            try {
                val result = repository.submitOrder(
                    mode = context.mode.toModel(),
                    trade = TradeRequest(
                        instrumentId = sheet.stock.id,
                        side = sheet.side.toModel(),
                        quantity = quantity,
                        orderMode = sheet.orderMode.toModel(),
                        limitPrice = sheet.limitPriceQuoteOrNull(),
                        idempotencyKey = sheet.idempotencyKey,
                    ),
                )
                if (
                    activeTradeAttemptId != attemptId ||
                    mutationEpoch != portfolioMutationEpoch ||
                    !privateContextMatches(context) ||
                    _uiState.value.tradeSheet?.idempotencyKey != attemptId
                ) {
                    return@launch
                }
                _uiState.update {
                    it.copy(
                        portfolio = result.portfolio.toUi(),
                        tradeSheet = null,
                        tradeBusy = false,
                        tradeError = null,
                        transientMessage =
                            if (result.order.status == LimitOrderStatus.OPEN) {
                                "${sheet.stock.name} $quantity 股限价委托已提交。"
                            } else {
                                "${if (sheet.side == UiTradeSide.BUY) "买入" else "卖出"} " +
                                    "${sheet.stock.name} $quantity 股成交。"
                            },
                    )
                }
                loadTransactions()
                loadOrders()
            } catch (error: CancellationException) {
                throw error
            } catch (error: Throwable) {
                if (
                    activeTradeAttemptId != attemptId ||
                    mutationEpoch != portfolioMutationEpoch ||
                    !privateContextMatches(context)
                ) {
                    return@launch
                }
                if (handleSessionExpiry(error, pendingTrade = sheet.side)) {
                    return@launch
                }
                _uiState.update {
                    it.copy(
                        tradeError = error.userMessage("下单失败，请重试"),
                    )
                }
            } finally {
                if (activeTradeAttemptId == attemptId) {
                    activeTradeAttemptId = null
                    _uiState.update { current ->
                        if (current.tradeBusy) current.copy(tradeBusy = false) else current
                    }
                }
                tradeJob = null
            }
        }
    }

    fun cancelOrder(orderId: String) {
        val state = _uiState.value
        if (state.cancellingOrderId != null || state.tradeBusy) return
        val order = state.orders.firstOrNull {
            it.id == orderId && it.status == UiOrderStatus.OPEN
        } ?: return
        val context = privateRequestContext() ?: return
        accountRequestId += 1
        ordersRequestId += 1
        val mutationEpoch = ++portfolioMutationEpoch
        _uiState.update {
            it.copy(cancellingOrderId = orderId, accountLoading = false)
        }
        viewModelScope.launch {
            runCatching {
                repository.cancelOrder(context.mode.toModel(), orderId)
            }.onSuccess { result ->
                if (
                    mutationEpoch != portfolioMutationEpoch ||
                    !privateContextMatches(context)
                ) return@onSuccess
                _uiState.update { current ->
                    current.copy(
                        portfolio = result.portfolio.toUi(),
                        orders = current.orders.map {
                            if (it.id == orderId) result.order.toUi() else it
                        },
                        cancellingOrderId = null,
                        transientMessage = "${order.name} 的委托已撤销，冻结资产已释放。",
                    )
                }
            }.onFailure { error ->
                if (error is CancellationException) return@onFailure
                if (
                    mutationEpoch != portfolioMutationEpoch ||
                    !privateContextMatches(context)
                ) return@onFailure
                if (handleSessionExpiry(error)) return@onFailure
                _uiState.update {
                    it.copy(
                        cancellingOrderId = null,
                        transientMessage = error.userMessage("撤单失败，请重试"),
                    )
                }
                loadAccountData()
            }
        }
    }

    fun clearTransientMessage() {
        _uiState.update { it.copy(transientMessage = null) }
    }

    private fun restoreSession() {
        if (!_uiState.value.serverConfigured || !repository.hasSession) {
            _uiState.update { it.copy(sessionRestoring = false) }
            return
        }
        val requestEpoch = ++sessionEpoch
        authJob = viewModelScope.launch {
            runCatching { repository.getCurrentAccount() }
                .onSuccess { account ->
                    if (sessionEpoch != requestEpoch) return@onSuccess
                    _uiState.update {
                        it.copy(
                            account = account.toUi(),
                            displayCurrency = account.displayCurrency.toUiDisplay(),
                            sessionRestoring = false,
                        )
                    }
                    loadUserData(openPendingTrade = pendingTrade != null)
                }
                .onFailure { error ->
                    if (error is CancellationException) return@onFailure
                    if (sessionEpoch != requestEpoch) return@onFailure
                    _uiState.update { state ->
                        state.copy(
                            account = null,
                            sessionRestoring = false,
                            transientMessage = if (pendingTrade != null) {
                                "登录状态已失效，请重新登录后继续交易。"
                            } else {
                                state.transientMessage
                            },
                        )
                    }
                    if (pendingTrade != null) openAuth()
                }
        }
    }

    private fun loadMarket(reset: Boolean, refreshing: Boolean = false) {
        if (!_uiState.value.serverConfigured) {
            _uiState.update {
                it.copy(
                    marketItems = emptyList(),
                    marketTotal = 0,
                    marketLoading = false,
                    marketRefreshing = false,
                    marketLoadingMore = false,
                    marketError = "请先设置服务器",
                )
            }
            return
        }
        marketJob?.cancel()
        val requestId = ++marketRequestId
        val requestServerEpoch = serverEpoch
        val snapshot = _uiState.value
        val page = if (reset) 1 else snapshot.marketPage + 1
        val mode = snapshot.mode
        val filter = snapshot.marketFilter
        val search = snapshot.searchQuery.trim().ifBlank { null }
        _uiState.update {
            it.copy(
                marketLoading = reset && !refreshing,
                marketRefreshing = reset && refreshing,
                marketLoadingMore = !reset,
                marketError = null,
                marketPage = if (reset) 1 else it.marketPage,
                marketItems = if (reset && !refreshing) emptyList() else it.marketItems,
            )
        }
        marketJob = viewModelScope.launch {
            runCatching {
                repository.getMarket(
                    MarketQuery(
                        mode = mode.toModel(),
                        market = filter.toModelOrNull(),
                        search = search,
                        page = page,
                        pageSize = MARKET_PAGE_SIZE,
                    ),
                )
            }.onSuccess { result ->
                if (
                    requestId != marketRequestId ||
                    requestServerEpoch != serverEpoch ||
                    _uiState.value.mode != mode ||
                    _uiState.value.marketFilter != filter ||
                    _uiState.value.searchQuery.trim().ifBlank { null } != search
                ) {
                    return@onSuccess
                }
                _uiState.update { current ->
                    val mapped = result.items.map(MarketItem::toUi)
                    current.copy(
                        marketItems = if (reset) {
                            mapped
                        } else {
                            (current.marketItems + mapped).distinctBy { it.id }
                        },
                        marketPage = result.page,
                        marketTotal = result.total,
                        marketLoading = false,
                        marketRefreshing = false,
                        marketLoadingMore = false,
                        marketError = null,
                    )
                }
            }.onFailure { error ->
                if (error is CancellationException) return@onFailure
                if (
                    requestId != marketRequestId ||
                    requestServerEpoch != serverEpoch
                ) {
                    return@onFailure
                }
                _uiState.update {
                    it.copy(
                        marketLoading = false,
                        marketRefreshing = false,
                        marketLoadingMore = false,
                        marketError = error.userMessage("行情加载失败"),
                    )
                }
            }
        }
    }

    private fun loadDetail(instrumentId: String) {
        detailJob?.cancel()
        val requestId = ++detailRequestId
        val requestServerEpoch = serverEpoch
        val mode = _uiState.value.mode
        val requestSessionEpoch = sessionEpoch
        val requestHasAccount = _uiState.value.account != null
        val mutationEpoch = portfolioMutationEpoch
        _uiState.update {
            it.copy(detailLoading = true, detailError = null, orderBook = null)
        }
        detailJob = viewModelScope.launch {
            runCatching {
                coroutineScope {
                    val instrument = async {
                        repository.getInstrument(instrumentId, mode.toModel())
                    }
                    val orderBook = async {
                        runCatching {
                            repository.getOrderBook(instrumentId, mode.toModel())
                        }.getOrNull()
                    }
                    val portfolio = async<Pair<Portfolio?, Throwable?>> {
                        if (requestHasAccount) {
                            try {
                                repository.getPortfolio(mode.toModel()) to null
                            } catch (error: CancellationException) {
                                throw error
                            } catch (error: Throwable) {
                                null to error
                            }
                        } else {
                            null to null
                        }
                    }
                    Triple(instrument.await(), orderBook.await(), portfolio.await())
                }
            }.onSuccess { (item, orderBook, portfolioResult) ->
                if (
                    portfolioResult.second != null &&
                    requestServerEpoch == serverEpoch &&
                    sessionMatches(requestSessionEpoch) &&
                    handleSessionExpiry(portfolioResult.second!!)
                ) {
                    return@onSuccess
                }
                if (
                    requestId != detailRequestId ||
                    requestServerEpoch != serverEpoch ||
                    _uiState.value.screen != AppScreen.DETAIL ||
                    _uiState.value.selectedInstrumentId != instrumentId ||
                    _uiState.value.mode != mode
                ) {
                    return@onSuccess
                }
                _uiState.update { current ->
                    val freshStock = item.toUi()
                    val freshPortfolio = if (
                        mutationEpoch == portfolioMutationEpoch &&
                        sessionMatches(requestSessionEpoch)
                    ) {
                        portfolioResult.first?.toUi() ?: current.portfolio
                    } else {
                        current.portfolio
                    }
                    current.copy(
                        selectedStock = freshStock,
                        orderBook = orderBook?.toUi(),
                        portfolio = freshPortfolio,
                        tradeSheet = current.tradeSheet?.withLatestMarketData(
                            freshStock,
                            freshPortfolio,
                        ),
                        detailLoading = false,
                        detailError = null,
                    )
                }
                loadChart(instrumentId)
            }.onFailure { error ->
                if (error is CancellationException) return@onFailure
                if (
                    requestId != detailRequestId ||
                    requestServerEpoch != serverEpoch ||
                    _uiState.value.selectedInstrumentId != instrumentId ||
                    _uiState.value.mode != mode
                ) {
                    return@onFailure
                }
                _uiState.update {
                    it.copy(
                        detailLoading = false,
                        chartLoading = false,
                        detailError = error.userMessage("股票详情加载失败"),
                    )
                }
            }
        }
    }

    private fun loadChart(instrumentId: String) {
        chartJob?.cancel()
        val requestId = ++chartRequestId
        val requestServerEpoch = serverEpoch
        val mode = _uiState.value.mode
        val range = _uiState.value.chartRange
        _uiState.update {
            it.copy(chartLoading = true, chartNotice = null, candles = emptyList())
        }
        chartJob = viewModelScope.launch {
            runCatching {
                repository.getChart(instrumentId, range.toModel(), mode.toModel())
            }.onSuccess { chart ->
                if (
                    requestId != chartRequestId ||
                    requestServerEpoch != serverEpoch ||
                    _uiState.value.selectedStock?.id != instrumentId ||
                    _uiState.value.chartRange != range ||
                    _uiState.value.mode != mode
                ) {
                    return@onSuccess
                }
                _uiState.update {
                    it.copy(
                        chartLoading = false,
                        candles = chart.candles.map(Candle::toUi),
                        chartNotice = chart.notice,
                    )
                }
            }.onFailure { error ->
                if (error is CancellationException) return@onFailure
                if (
                    requestId != chartRequestId ||
                    requestServerEpoch != serverEpoch ||
                    _uiState.value.selectedInstrumentId != instrumentId ||
                    _uiState.value.chartRange != range ||
                    _uiState.value.mode != mode
                ) {
                    return@onFailure
                }
                _uiState.update {
                    it.copy(
                        chartLoading = false,
                        candles = emptyList(),
                        chartNotice = error.userMessage("图表读取失败"),
                    )
                }
            }
        }
    }

    private fun loadWatchlist() {
        val context = privateRequestContext() ?: return
        val requestId = ++watchlistRequestId
        _uiState.update { it.copy(watchlistLoading = true) }
        viewModelScope.launch {
            runCatching { repository.getWatchlist(context.mode.toModel()) }
                .onSuccess { watchlist ->
                    if (
                        requestId == watchlistRequestId &&
                        privateContextMatches(context)
                    ) {
                        applyWatchlist(watchlist)
                    }
                }
                .onFailure { error ->
                    if (error is CancellationException) return@onFailure
                    if (
                        requestId != watchlistRequestId ||
                        !privateContextMatches(context)
                    ) {
                        return@onFailure
                    }
                    if (handleSessionExpiry(error)) return@onFailure
                    _uiState.update {
                        it.copy(
                            watchlistLoading = false,
                            transientMessage = error.userMessage("自选加载失败"),
                        )
                    }
                }
        }
    }

    private fun applyWatchlist(watchlist: Watchlist) {
        _uiState.update {
            it.copy(
                watchlistIds = watchlist.instrumentIds.toSet(),
                watchlistItems = watchlist.items.mapNotNull { item ->
                    item.marketItem?.toUi()
                },
                watchlistLoading = false,
            )
        }
    }

    private fun loadAccountData() {
        if (_uiState.value.cancellingOrderId != null) return
        val context = privateRequestContext() ?: return
        val requestId = ++accountRequestId
        val mutationEpoch = portfolioMutationEpoch
        _uiState.update { it.copy(accountLoading = true, accountError = null) }
        viewModelScope.launch {
            runCatching {
                coroutineScope {
                    val portfolio = async { repository.getPortfolio(context.mode.toModel()) }
                    val transactions = async { repository.getTransactions(context.mode.toModel()) }
                    val orders = async { repository.getOrders(context.mode.toModel()) }
                    val checkIn = async { repository.getCheckInStatus() }
                    AccountSnapshot(
                        portfolio = portfolio.await(),
                        transactions = transactions.await(),
                        orders = orders.await(),
                        checkIn = checkIn.await(),
                    )
                }
            }.onSuccess { snapshot ->
                if (
                    requestId != accountRequestId ||
                    mutationEpoch != portfolioMutationEpoch ||
                    !privateContextMatches(context)
                ) {
                    return@onSuccess
                }
                _uiState.update {
                    it.copy(
                        portfolio = snapshot.portfolio.toUi(),
                        transactions = snapshot.transactions.map(Transaction::toUi),
                        orders = snapshot.orders.map(LimitOrder::toUi),
                        checkIn = snapshot.checkIn.toUi(),
                        accountLoading = false,
                        accountError = null,
                    )
                }
            }.onFailure { error ->
                if (error is CancellationException) return@onFailure
                if (
                    requestId != accountRequestId ||
                    mutationEpoch != portfolioMutationEpoch ||
                    !privateContextMatches(context)
                ) {
                    return@onFailure
                }
                if (handleSessionExpiry(error)) return@onFailure
                _uiState.update {
                    it.copy(
                        accountLoading = false,
                        accountError = error.userMessage("资产读取失败"),
                    )
                }
            }
        }
    }

    private fun loadUserData(openPendingTrade: Boolean) {
        if (_uiState.value.cancellingOrderId != null) return
        val context = privateRequestContext() ?: return
        loadWatchlist()
        val requestId = ++accountRequestId
        val mutationEpoch = portfolioMutationEpoch
        _uiState.update { it.copy(accountLoading = true, accountError = null) }
        viewModelScope.launch {
            runCatching { repository.getPortfolio(context.mode.toModel()) }
                .onSuccess { portfolio ->
                    if (
                        requestId != accountRequestId ||
                        mutationEpoch != portfolioMutationEpoch ||
                        !privateContextMatches(context)
                    ) {
                        return@onSuccess
                    }
                    _uiState.update {
                        it.copy(
                            portfolio = portfolio.toUi(),
                            accountLoading = false,
                            accountError = null,
                        )
                    }
                    if (openPendingTrade) {
                        val pending = pendingTrade
                        val current = _uiState.value
                        if (
                            pending != null &&
                            pending.mode == context.mode &&
                            pending.instrumentId == current.selectedStock?.id &&
                            current.screen == AppScreen.DETAIL
                        ) {
                            pendingTrade = null
                            showTradeSheet(pending.side)
                        } else if (pending != null) {
                            pendingTrade = null
                        }
                    }
                }
                .onFailure { error ->
                    if (error is CancellationException) return@onFailure
                    if (
                        requestId != accountRequestId ||
                        mutationEpoch != portfolioMutationEpoch ||
                        !privateContextMatches(context)
                    ) {
                        return@onFailure
                    }
                    if (handleSessionExpiry(error)) return@onFailure
                    _uiState.update {
                        it.copy(
                            accountLoading = false,
                            accountError = error.userMessage("资产读取失败"),
                            transientMessage = "资产同步失败，请重试后继续交易。",
                        )
                    }
                }
            if (_uiState.value.selectedTab == MainTab.ASSETS) {
                loadAccountData()
            }
        }
    }

    private fun loadTransactions() {
        val context = privateRequestContext() ?: return
        val requestId = ++transactionsRequestId
        viewModelScope.launch {
            runCatching { repository.getTransactions(context.mode.toModel()) }
                .onSuccess { transactions ->
                    if (
                        requestId == transactionsRequestId &&
                        privateContextMatches(context)
                    ) {
                        _uiState.update {
                            it.copy(transactions = transactions.map(Transaction::toUi))
                        }
                    }
                }
                .onFailure { error ->
                    if (error is CancellationException) return@onFailure
                    if (
                        requestId != transactionsRequestId ||
                        !privateContextMatches(context)
                    ) {
                        return@onFailure
                    }
                    handleSessionExpiry(error)
                }
        }
    }

    private fun loadOrders() {
        if (_uiState.value.cancellingOrderId != null) return
        val context = privateRequestContext() ?: return
        val requestId = ++ordersRequestId
        val mutationEpoch = portfolioMutationEpoch
        viewModelScope.launch {
            runCatching { repository.getOrders(context.mode.toModel()) }
                .onSuccess { orders ->
                    if (
                        requestId == ordersRequestId &&
                        mutationEpoch == portfolioMutationEpoch &&
                        privateContextMatches(context)
                    ) {
                        _uiState.update {
                            it.copy(orders = orders.map(LimitOrder::toUi))
                        }
                    }
                }
                .onFailure { error ->
                    if (error is CancellationException) return@onFailure
                    if (
                        requestId == ordersRequestId &&
                        mutationEpoch == portfolioMutationEpoch &&
                        privateContextMatches(context)
                    ) {
                        handleSessionExpiry(error)
                    }
                }
        }
    }

    private suspend fun refreshVisibleData(cycle: Long) {
        val state = _uiState.value
        if (
            !state.serverConfigured ||
            state.settingsOpen ||
            state.serverSaving ||
            state.sessionRestoring ||
            state.authBusy ||
            state.tradeBusy ||
            state.rewardBusy ||
            state.cancellingOrderId != null
        ) {
            return
        }

        when (state.screen) {
            AppScreen.AUTH -> Unit
            AppScreen.DETAIL -> refreshDetailSilently(
                includeChart = cycle % 5L == 0L,
            )
            AppScreen.MAIN -> when (state.selectedTab) {
                MainTab.MARKET -> refreshMarketSilently()
                MainTab.WATCHLIST -> refreshWatchlistSilently()
                MainTab.ASSETS -> {
                    if (cycle % 2L == 0L) refreshAssetsSilently()
                }
            }
        }
    }

    private suspend fun refreshMarketSilently() {
        val snapshot = _uiState.value
        if (
            snapshot.marketItems.isEmpty() ||
            snapshot.marketLoading ||
            snapshot.marketRefreshing ||
            snapshot.marketLoadingMore
        ) {
            return
        }
        val requestServerEpoch = serverEpoch
        val mode = snapshot.mode
        val filter = snapshot.marketFilter
        val search = snapshot.searchQuery.trim().ifBlank { null }
        val refreshCount = snapshot.marketItems.size
            .coerceAtLeast(MARKET_PAGE_SIZE)
            .coerceAtMost(300)

        val result = try {
            repository.getMarket(
                MarketQuery(
                    mode = mode.toModel(),
                    market = filter.toModelOrNull(),
                    search = search,
                    page = 1,
                    pageSize = refreshCount,
                ),
            )
        } catch (error: CancellationException) {
            throw error
        } catch (_: Throwable) {
            return
        }

        val current = _uiState.value
        if (
            current.screen != AppScreen.MAIN ||
            current.selectedTab != MainTab.MARKET ||
            requestServerEpoch != serverEpoch ||
            current.mode != mode ||
            current.marketFilter != filter ||
            current.searchQuery.trim().ifBlank { null } != search ||
            current.marketLoading ||
            current.marketRefreshing ||
            current.marketLoadingMore
        ) {
            return
        }
        val refreshed = result.items.map(MarketItem::toUi)
        _uiState.update {
            val tail = if (it.marketItems.size > refreshCount) {
                it.marketItems.drop(refreshCount)
                    .filter { item -> refreshed.none { fresh -> fresh.id == item.id } }
            } else {
                emptyList()
            }
            it.copy(
                marketItems = refreshed + tail,
                marketTotal = result.total,
                marketError = null,
            )
        }
    }

    private suspend fun refreshWatchlistSilently() {
        val context = privateRequestContext() ?: return
        if (_uiState.value.watchlistLoading) return
        val watchlist = try {
            repository.getWatchlist(context.mode.toModel())
        } catch (error: CancellationException) {
            throw error
        } catch (error: Throwable) {
            if (privateContextMatches(context)) {
                handleSessionExpiry(error)
            }
            return
        }
        val current = _uiState.value
        if (
            current.screen == AppScreen.MAIN &&
            current.selectedTab == MainTab.WATCHLIST &&
            privateContextMatches(context) &&
            !current.watchlistLoading
        ) {
            applyWatchlist(watchlist)
        }
    }

    private suspend fun refreshAssetsSilently() {
        val context = privateRequestContext() ?: return
        val mutationEpoch = portfolioMutationEpoch
        if (
            _uiState.value.accountLoading ||
            _uiState.value.cancellingOrderId != null
        ) return
        val result = try {
            coroutineScope {
                val portfolio = async {
                    repository.getPortfolio(context.mode.toModel())
                }
                val transactions = async {
                    repository.getTransactions(context.mode.toModel())
                }
                val orders = async {
                    repository.getOrders(context.mode.toModel())
                }
                Triple(portfolio.await(), transactions.await(), orders.await())
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Throwable) {
            if (privateContextMatches(context)) {
                handleSessionExpiry(error)
            }
            return
        }
        val current = _uiState.value
        if (
            current.screen == AppScreen.MAIN &&
            current.selectedTab == MainTab.ASSETS &&
            mutationEpoch == portfolioMutationEpoch &&
            privateContextMatches(context) &&
            !current.accountLoading
        ) {
            _uiState.update {
                it.copy(
                    portfolio = result.first.toUi(),
                    transactions = result.second.map(Transaction::toUi),
                    orders = result.third.map(LimitOrder::toUi),
                    accountError = null,
                )
            }
        }
    }

    private suspend fun refreshDetailSilently(includeChart: Boolean) {
        val snapshot = _uiState.value
        val instrumentId = snapshot.selectedInstrumentId ?: return
        val requestServerEpoch = serverEpoch
        val mode = snapshot.mode
        val range = snapshot.chartRange
        val requestSessionEpoch = sessionEpoch
        val hasAccount = snapshot.account != null
        val mutationEpoch = portfolioMutationEpoch
        if (snapshot.detailLoading) return

        val result = try {
            coroutineScope {
                val instrument = async {
                    repository.getInstrument(instrumentId, mode.toModel())
                }
                val orderBook = async {
                    runCatching {
                        repository.getOrderBook(instrumentId, mode.toModel())
                    }.getOrNull()
                }
                val portfolio = async<Pair<Portfolio?, Throwable?>> {
                    if (hasAccount) {
                        try {
                            repository.getPortfolio(mode.toModel()) to null
                        } catch (error: CancellationException) {
                            throw error
                        } catch (error: Throwable) {
                            null to error
                        }
                    } else {
                        null to null
                    }
                }
                val chart = async {
                    if (includeChart) {
                        runCatching {
                            repository.getChart(
                                instrumentId,
                                range.toModel(),
                                mode.toModel(),
                            )
                        }.getOrNull()
                    } else {
                        null
                    }
                }
                val chartResult = chart.await()
                val portfolioResult = portfolio.await()
                SilentDetailRefresh(
                    item = instrument.await(),
                    orderBook = orderBook.await(),
                    portfolio = portfolioResult.first,
                    sessionError = portfolioResult.second,
                    chart = chartResult?.candles?.map(Candle::toUi),
                    chartNotice = chartResult?.notice,
                )
            }
        } catch (error: CancellationException) {
            throw error
        } catch (_: Throwable) {
            return
        }

        if (
            result.sessionError != null &&
            requestServerEpoch == serverEpoch &&
            sessionMatches(requestSessionEpoch) &&
            handleSessionExpiry(result.sessionError)
        ) {
            return
        }
        val current = _uiState.value
        if (
            current.screen != AppScreen.DETAIL ||
            requestServerEpoch != serverEpoch ||
            current.selectedInstrumentId != instrumentId ||
            current.mode != mode ||
            current.chartRange != range ||
            current.detailLoading
        ) {
            return
        }
        _uiState.update { state ->
            val freshStock = result.item.toUi()
            val freshPortfolio = if (
                mutationEpoch == portfolioMutationEpoch &&
                sessionMatches(requestSessionEpoch)
            ) {
                result.portfolio?.toUi() ?: state.portfolio
            } else {
                state.portfolio
            }
            state.copy(
                selectedStock = freshStock,
                orderBook = result.orderBook?.toUi() ?: state.orderBook,
                portfolio = freshPortfolio,
                tradeSheet = state.tradeSheet?.withLatestMarketData(
                    freshStock,
                    freshPortfolio,
                ),
                candles = result.chart ?: state.candles,
                chartNotice = if (result.chart != null) {
                    result.chartNotice
                } else {
                    state.chartNotice
                },
                detailError = null,
            )
        }
    }

    private fun privateRequestContext(): PrivateRequestContext? {
        val state = _uiState.value
        if (state.account == null || state.sessionRestoring || !state.serverConfigured) {
            return null
        }
        return PrivateRequestContext(
            serverEpoch = serverEpoch,
            sessionEpoch = sessionEpoch,
            mode = state.mode,
        )
    }

    private fun privateContextMatches(context: PrivateRequestContext): Boolean =
        context.serverEpoch == serverEpoch &&
            context.sessionEpoch == sessionEpoch &&
            _uiState.value.account != null &&
            _uiState.value.mode == context.mode &&
            _uiState.value.serverConfigured

    private fun sessionMatches(epoch: Long): Boolean =
        epoch == sessionEpoch && _uiState.value.account != null

    private fun handleSessionExpiry(
        error: Throwable,
        pendingTrade: UiTradeSide? = null,
    ): Boolean {
        if (error !is ApiClientException || error.status != 401) return false
        val state = _uiState.value
        val stock = state.selectedStock
        if (pendingTrade != null && stock != null) {
            this.pendingTrade = PendingTrade(
                instrumentId = stock.id,
                mode = state.mode,
                side = pendingTrade,
            )
        }
        sessionEpoch += 1
        giftAttempt = null
        watchlistRequestId += 1
        accountRequestId += 1
        transactionsRequestId += 1
        ordersRequestId += 1
        _uiState.update {
            it.copy(
                account = null,
                sessionRestoring = false,
                portfolio = null,
                transactions = emptyList(),
                orders = emptyList(),
                watchlistIds = emptySet(),
                watchlistItems = emptyList(),
                checkIn = null,
                accountLoading = false,
                rewardBusy = false,
                tradeBusy = false,
                cancellingOrderId = null,
                tradeSheet = null,
                returnScreen = if (it.screen == AppScreen.AUTH) {
                    it.returnScreen
                } else {
                    it.screen
                },
                screen = AppScreen.AUTH,
                authBusy = false,
                authError = "登录状态已过期，请重新登录。",
            )
        }
        return true
    }

    private fun showTradeSheet(side: UiTradeSide) {
        val state = _uiState.value
        val stock = state.selectedStock ?: return
        val draft = TradeSheetUi(
            stock = stock,
            side = side,
            limitPriceCurrency = state.displayCurrency,
            idempotencyKey = UUID.randomUUID().toString(),
        ).recalculateForPortfolio(state.portfolio)
        _uiState.update {
            it.copy(
                tradeSheet = draft,
                tradeError = null,
            )
        }
    }

    class Factory(
        private val repository: StockRepository,
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            if (modelClass.isAssignableFrom(AppViewModel::class.java)) {
                return AppViewModel(repository) as T
            }
            throw IllegalArgumentException("Unknown ViewModel class: ${modelClass.name}")
        }
    }
}

private fun UiMarketMode.toModel(): MarketMode =
    if (this == UiMarketMode.REAL) MarketMode.REAL else MarketMode.VIRTUAL

private fun MarketMode.toUi(): UiMarketMode =
    if (this == MarketMode.REAL) UiMarketMode.REAL else UiMarketMode.VIRTUAL

private fun UiDisplayCurrency.toModel(): Currency =
    if (this == UiDisplayCurrency.CNY) Currency.CNY else Currency.USD

private fun Currency.toUiDisplay(): UiDisplayCurrency =
    if (this == Currency.USD) UiDisplayCurrency.USD else UiDisplayCurrency.CNY

private fun MarketFilter.toModelOrNull(): Market? = when (this) {
    MarketFilter.ALL -> null
    MarketFilter.CN -> Market.CN
    MarketFilter.HK -> Market.HK
    MarketFilter.US -> Market.US
    MarketFilter.UK -> Market.UK
}

private fun UiChartRange.toModel(): ChartRange = ChartRange.valueOf(name)

private fun UiTradeSide.toModel(): TradeSide = TradeSide.valueOf(name)

private fun UiOrderMode.toModel(): OrderMode = OrderMode.valueOf(name)

private fun PublicAccount.toUi(): AccountUi = AccountUi(
    username = username,
    displayName = displayName,
)

private fun MarketItem.toUi(): StockUi = StockUi(
    id = instrument.id,
    symbol = instrument.symbol,
    name = instrument.name,
    market = instrument.market.name,
    industry = instrument.industry,
    quoteCurrency = quote.quoteCurrency.name,
    currentPrice = quote.currentPrice,
    previousClose = quote.previousClose,
    openPrice = quote.openPrice,
    highPrice = quote.highPrice,
    lowPrice = quote.lowPrice,
    volume = quote.volume.toDouble(),
    changeAmount = quote.changeAmount,
    changePercent = quote.changePercent,
    lotSize = instrument.lotSize,
    settlementCycle = instrument.settlementCycle.name,
    tradable = instrument.isTradable,
    updatedAt = quote.receivedAt ?: quote.updatedAt,
)

private fun Candle.toUi(): CandleUi = CandleUi(
    time = time,
    open = open,
    high = high,
    low = low,
    close = close,
    volume = volume.toDouble(),
)

private fun OrderBookLevel.toUi(): OrderBookLevelUi = OrderBookLevelUi(
    price = price,
    quantity = quantity.toDouble(),
)

private fun OrderBook.toUi(): OrderBookUi = OrderBookUi(
    asks = asks.map(OrderBookLevel::toUi),
    bids = bids.map(OrderBookLevel::toUi),
    available = available ?: true,
    notice = notice,
)

private fun Position.toUi(): PositionUi = PositionUi(
    instrumentId = instrumentId,
    symbol = symbol,
    name = name,
    market = market.name,
    quantity = quantity.toDouble(),
    availableQuantity = availableQuantity.toDouble(),
    frozenQuantity = frozenQuantity.toDouble(),
    pendingSettlementQuantity = pendingSettlementQuantity.toDouble(),
    averageCostUsd = averageCostUsd,
    currentPriceUsd = currentPriceUsd,
    marketValueUsd = marketValueUsd,
    profitLossUsd = profitLossUsd,
    profitLossPercent = profitLossPercent,
)

private fun Portfolio.toUi(): PortfolioUi = PortfolioUi(
    availableCashUsd = availableCashUsd,
    frozenCashUsd = frozenCashUsd,
    positionsValueUsd = positionsValueUsd,
    totalAssetsUsd = totalAssetsUsd,
    realizedProfitUsd = realizedProfitUsd,
    unrealizedProfitUsd = unrealizedProfitUsd,
    totalProfitLossUsd = totalProfitLossUsd,
    positions = positions.map(Position::toUi),
)

private fun Transaction.toUi(): TransactionUi = TransactionUi(
    id = id,
    instrumentId = instrumentId,
    symbol = symbol,
    name = name,
    side = UiTradeSide.valueOf(side.name),
    quantity = quantity.toDouble(),
    priceUsd = priceUsd,
    netAmountUsd = netAmountUsd,
    realizedProfitUsd = realizedProfitUsd,
    createdAt = createdAt,
)

private fun LimitOrder.toUi(): LimitOrderUi = LimitOrderUi(
    id = id,
    instrumentId = instrumentId,
    symbol = symbol,
    name = name,
    market = market.name,
    side = UiTradeSide.valueOf(side.name),
    orderMode = UiOrderMode.valueOf(orderMode.name),
    status = UiOrderStatus.valueOf(status.name),
    quantity = quantity.toDouble(),
    filledQuantity = filledQuantity.toDouble(),
    limitPrice = limitPrice,
    quoteCurrency = quoteCurrency.name,
    reservedCashUsd = reservedCashUsd,
    reservedQuantity = reservedQuantity.toDouble(),
    createdAt = createdAt,
    updatedAt = updatedAt,
)

private fun DailyCheckInStatus.toUi(): CheckInUi = CheckInUi(
    claimed = claimed,
    rewardUsd = rewardUsd,
    mode = mode?.toUi(),
)

private fun Throwable.userMessage(fallback: String): String {
    val detail = message?.trim().orEmpty()
    val normalized = detail.lowercase()
    return when {
        detail.isBlank() -> fallback
        "unexpected end of stream" in normalized ||
            "failed to connect" in normalized ||
            "connection refused" in normalized ||
            "unable to resolve host" in normalized -> {
            "无法连接行情服务，请确认服务已启动并检查网络。"
        }
        "timeout" in normalized || "timed out" in normalized -> {
            "行情服务响应超时，请稍后重试。"
        }
        else -> detail
    }
}
