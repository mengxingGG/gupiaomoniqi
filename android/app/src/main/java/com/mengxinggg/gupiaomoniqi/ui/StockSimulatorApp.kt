package com.mengxinggg.gupiaomoniqi.ui

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.ui.unit.dp
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.key
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import com.mengxinggg.gupiaomoniqi.ui.components.AssistantSheet
import com.mengxinggg.gupiaomoniqi.ui.components.AssistantManagementSheet
import com.mengxinggg.gupiaomoniqi.ui.components.AssistantOrb
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.compose.LifecycleStartEffect
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.mengxinggg.gupiaomoniqi.data.DefaultStockRepository
import com.mengxinggg.gupiaomoniqi.ui.components.AppTopControls
import com.mengxinggg.gupiaomoniqi.ui.components.EmailCompletionDialog
import com.mengxinggg.gupiaomoniqi.ui.components.MainBottomBar
import com.mengxinggg.gupiaomoniqi.ui.components.ServerSettingsSheet
import com.mengxinggg.gupiaomoniqi.ui.components.TradeSheet
import com.mengxinggg.gupiaomoniqi.ui.screens.AssetsScreen
import com.mengxinggg.gupiaomoniqi.ui.screens.AuthScreen
import com.mengxinggg.gupiaomoniqi.ui.screens.DetailScreen
import com.mengxinggg.gupiaomoniqi.ui.screens.DetailTradeActions
import com.mengxinggg.gupiaomoniqi.ui.screens.MarketScreen
import com.mengxinggg.gupiaomoniqi.ui.screens.OrdersScreen
import com.mengxinggg.gupiaomoniqi.ui.screens.WatchlistScreen
import com.mengxinggg.gupiaomoniqi.ui.theme.StockSimulatorTheme
import com.mengxinggg.gupiaomoniqi.update.ApkInstaller
import com.mengxinggg.gupiaomoniqi.update.AppUpdateManager
import com.mengxinggg.gupiaomoniqi.update.InstallLaunchResult
import java.io.File

@Composable
fun StockSimulatorApp() {
    val context = LocalContext.current
    val repository = remember(context.applicationContext) {
        DefaultStockRepository(context.applicationContext)
    }
    val factory = remember(repository) { AppViewModel.Factory(repository) }
    val viewModel: AppViewModel = viewModel(factory = factory)
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val pageStates = rememberSaveableStateHolder()
    var assistantOpen by rememberSaveable { mutableStateOf(false) }
    var assistantManagementOpen by rememberSaveable { mutableStateOf(false) }
    var assistantStatus by remember { mutableStateOf("idle") }
    val lifecycleOwner = androidx.lifecycle.compose.LocalLifecycleOwner.current
    LaunchedEffect(repository, state.account?.username, state.mode, state.serverUrl, assistantOpen, assistantManagementOpen) {
        lifecycleOwner.lifecycle.repeatOnLifecycle(androidx.lifecycle.Lifecycle.State.STARTED) {
            while (true) {
                kotlinx.coroutines.delay(2_000)
                if (state.account != null && !assistantOpen && !assistantManagementOpen && com.mengxinggg.gupiaomoniqi.data.AppIdle.ready())
                    repository.syncAssistantSnapshots(state.mode.name)
            }
        }
    }
    LaunchedEffect(state.account?.username) { assistantOpen = false; assistantManagementOpen = false; assistantStatus = "idle" }
    val updateManager = remember(context.applicationContext) {
        AppUpdateManager(context.applicationContext)
    }
    val updateState by updateManager.state.collectAsStateWithLifecycle()
    val apkInstaller = remember(context.applicationContext) {
        ApkInstaller(context.applicationContext)
    }
    val snackbarHostState = remember { SnackbarHostState() }
    val unknownSourceSettingsLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) {
        if (context.packageManager.canRequestPackageInstalls()) {
            updateManager.requestInstallAgain()
        } else {
            updateManager.onInstallFailed(
                "尚未允许安装更新，可稍后在设置中再次点击安装",
            )
        }
    }

    DisposableEffect(updateManager) {
        onDispose(updateManager::close)
    }

    LifecycleStartEffect(viewModel, updateManager) {
        viewModel.startLiveRefresh()
        updateManager.onAppForeground()
        onStopOrDispose {
            viewModel.stopLiveRefresh()
        }
    }

    LaunchedEffect(state.serverUrl) {
        updateManager.onServerConfigurationChanged()
    }

    BackHandler(enabled = state.screen != AppScreen.MAIN) {
        when (state.screen) {
            AppScreen.AUTH -> viewModel.closeAuth()
            AppScreen.DETAIL -> viewModel.closeDetail()
            AppScreen.MAIN -> Unit
        }
    }

    LaunchedEffect(state.transientMessage) {
        val message = state.transientMessage ?: return@LaunchedEffect
        snackbarHostState.showSnackbar(message)
        viewModel.clearTransientMessage()
    }

    LaunchedEffect(updateState.message) {
        val message = updateState.message ?: return@LaunchedEffect
        snackbarHostState.showSnackbar(message)
        updateManager.consumeMessage(message)
    }

    LaunchedEffect(
        updateState.installRequestId,
        updateState.downloadedApkPath,
    ) {
        if (updateState.installRequestId <= 0L) return@LaunchedEffect
        val path = updateState.downloadedApkPath ?: return@LaunchedEffect
        when (val result = apkInstaller.launch(File(path))) {
            InstallLaunchResult.Started ->
                updateManager.onInstallerStarted()
            is InstallLaunchResult.PermissionRequired -> {
                updateManager.onInstallPermissionRequired()
                runCatching {
                    unknownSourceSettingsLauncher.launch(result.intent)
                }.onFailure {
                    updateManager.onInstallFailed(
                        it.message ?: "无法打开安装权限设置",
                    )
                }
            }
            is InstallLaunchResult.Failed ->
                updateManager.onInstallFailed(result.message)
        }
    }

    StockSimulatorTheme {
        Box(Modifier.fillMaxSize()) {
        Scaffold(
            topBar = {
                if (state.screen != AppScreen.AUTH) {
                    AppTopControls(
                        mode = state.mode,
                        currency = state.displayCurrency,
                        account = state.account,
                        hasAppUpdate = updateState.updateAvailable,
                        onModeChange = viewModel::changeMode,
                        onCurrencyChange = viewModel::changeDisplayCurrency,
                        onAccountClick = {
                            if (state.account == null) {
                                viewModel.openAuth()
                            } else {
                                viewModel.selectTab(MainTab.ASSETS)
                            }
                        },
                        onSettingsClick = viewModel::openSettings,
                        modifier = Modifier.statusBarsPadding(),
                    )
                }
            },
            bottomBar = {
                when (state.screen) {
                    AppScreen.MAIN -> {
                        MainBottomBar(
                            selected = state.selectedTab,
                            onSelect = viewModel::selectTab,
                        )
                    }
                    AppScreen.DETAIL -> {
                        DetailTradeActions(
                            stock = state.selectedStock,
                            tradeBusy = state.tradeBusy,
                            onTrade = viewModel::requestTrade,
                        )
                    }
                    AppScreen.AUTH -> Unit
                }
            },
            snackbarHost = { SnackbarHost(snackbarHostState) },
        ) { innerPadding ->
            val route = state.screen to if (state.screen == AppScreen.MAIN) state.selectedTab else MainTab.MARKET
            AnimatedContent(targetState = route, modifier = Modifier.fillMaxSize(), transitionSpec = {
                val direction = if (targetState.first == AppScreen.MAIN && initialState.first != AppScreen.MAIN) -1
                    else if (targetState.first == AppScreen.MAIN && targetState.second.ordinal < initialState.second.ordinal) -1 else 1
                (fadeIn(tween(210)) + slideInHorizontally(tween(280, easing = FastOutSlowInEasing)) { direction * it / 12 }) togetherWith
                    (fadeOut(tween(150)) + slideOutHorizontally(tween(240, easing = FastOutSlowInEasing)) { -direction * it / 16 })
            }, label = "页面切换") { page ->
            // 离场页保留最后一帧数据，避免详情被清空后出现闪白；列表位置按页恢复。
            var pageState by remember(page) { mutableStateOf(state) }
            SideEffect { if (page == route) pageState = state }
            pageStates.SaveableStateProvider("${page.first}-${page.second}") {
            when (page.first) {
                AppScreen.AUTH -> {
                    AuthScreen(
                        state = pageState,
                        onBack = viewModel::closeAuth,
                        onModeChange = viewModel::changeAuthMode,
                        onSubmit = viewModel::authenticate,
                        onRegistrationEmailReset =
                            viewModel::resetRegistrationEmailVerification,
                        onResetRequest = viewModel::requestPasswordReset,
                        onResetConfirm = viewModel::confirmPasswordReset,
                        modifier = Modifier
                            .padding(innerPadding)
                            .statusBarsPadding(),
                    )
                }
                AppScreen.DETAIL -> {
                    DetailScreen(
                        state = pageState,
                        onBack = viewModel::closeDetail,
                        onRetry = viewModel::retryDetail,
                        onRangeChange = viewModel::changeChartRange,
                        onToggleWatchlist = viewModel::toggleWatchlist,
                        modifier = Modifier.padding(innerPadding),
                    )
                }
                AppScreen.MAIN -> {
                    when (page.second) {
                        MainTab.MARKET -> {
                            MarketScreen(
                                state = pageState,
                                onSearchChange = viewModel::setSearchQuery,
                                onFilterChange = viewModel::setMarketFilter,
                                onIndustryChange = viewModel::setIndustryFilter,
                                onChangeSort = viewModel::cycleChangeSort,
                                onRefresh = viewModel::refreshMarket,
                                onLoadMore = viewModel::loadMoreMarket,
                                onOpenStock = viewModel::openStock,
                                onToggleWatchlist = viewModel::toggleWatchlist,
                                modifier = Modifier.padding(innerPadding),
                            )
                        }
                        MainTab.WATCHLIST -> {
                            WatchlistScreen(
                                state = pageState,
                                onLogin = viewModel::openAuth,
                                onRefresh = viewModel::refreshWatchlist,
                                onOpenStock = viewModel::openStock,
                                onToggleWatchlist = viewModel::toggleWatchlist,
                                modifier = Modifier.padding(innerPadding),
                            )
                        }
                        MainTab.ORDERS -> {
                            OrdersScreen(
                                state = pageState,
                                onLogin = viewModel::openAuth,
                                onRefresh = viewModel::refreshAccount,
                                onOpenStock = viewModel::openStock,
                                onCancelOrder = viewModel::cancelOrder,
                                modifier = Modifier.padding(innerPadding),
                            )
                        }
                        MainTab.ASSETS -> {
                            AssetsScreen(
                                state = pageState,
                                onLogin = viewModel::openAuth,
                                onRefresh = viewModel::refreshAccount,
                                onLogout = viewModel::logout,
                                onOpenStock = viewModel::openStock,
                                onCheckIn = viewModel::claimCheckIn,
                                onRedeemGift = viewModel::redeemGiftCode,
                                modifier = Modifier.padding(innerPadding),
                            )
                        }
                    }
                }
            }
            }
            }
        }

        if (state.screen != AppScreen.AUTH && state.tradeSheet == null) {
            AssistantOrb(status = assistantStatus,
                modifier = Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(start = 10.dp, end = 10.dp, top = 100.dp, bottom = 100.dp),
                onClick = { if (state.account == null) viewModel.openAuth() else assistantOpen = true })
        }
        }
        key(state.account?.username) {
            if (state.account != null && assistantManagementOpen) AssistantManagementSheet(repository = repository,
                onDismiss = { assistantManagementOpen = false; viewModel.openSettings() })
            if (state.account != null) AssistantSheet(visible = assistantOpen, repository = repository,
                mode = state.mode.name, instrumentId = if (state.screen == AppScreen.DETAIL) state.selectedStock?.id else null,
                onStatusChange = { assistantStatus = it }, onDismiss = { assistantOpen = false }, onTradeCompleted = viewModel::refreshAccount)
        }

        if (state.tradeSheet != null) {
            TradeSheet(
                state = state,
                onDismiss = viewModel::dismissTradeSheet,
                onOrderModeChange = viewModel::updateOrderMode,
                onLimitPriceChange = viewModel::updateLimitPrice,
                onLotsChange = viewModel::updateTradeLots,
                onPercentage = viewModel::selectTradePercentage,
                onSubmit = viewModel::submitTrade,
            )
        }

        if (state.settingsOpen) {
            ServerSettingsSheet(
                currentUrl = state.serverUrl,
                updateState = updateState,
                onDismiss = viewModel::closeSettings,
                onAssistantSettings = {
                    viewModel.closeSettings()
                    if (state.account == null) viewModel.openAuth() else assistantManagementOpen = true
                },
                onUpdateAction = {
                    if (updateState.downloadedApkPath != null) {
                        updateManager.requestInstallAgain()
                    } else {
                        updateManager.checkAndInstall()
                    }
                },
            )
        }

        if (
            state.account != null &&
            state.account?.email.isNullOrBlank() &&
            !state.sessionRestoring
        ) {
            EmailCompletionDialog(
                state = state,
                onRequestCode = viewModel::requestEmailCompletion,
                onConfirm = viewModel::confirmEmailCompletion,
                onChangeEmail = viewModel::changeEmailCompletionAddress,
                onLogout = viewModel::logout,
            )
        }
    }
}
