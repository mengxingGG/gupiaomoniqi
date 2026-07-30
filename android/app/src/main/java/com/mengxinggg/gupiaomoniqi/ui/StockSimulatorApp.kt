package com.mengxinggg.gupiaomoniqi.ui

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.compose.LifecycleStartEffect
import androidx.lifecycle.viewmodel.compose.viewModel
import com.mengxinggg.gupiaomoniqi.data.DefaultStockRepository
import com.mengxinggg.gupiaomoniqi.ui.components.AppTopControls
import com.mengxinggg.gupiaomoniqi.ui.components.MainBottomBar
import com.mengxinggg.gupiaomoniqi.ui.components.ServerSettingsSheet
import com.mengxinggg.gupiaomoniqi.ui.components.TradeSheet
import com.mengxinggg.gupiaomoniqi.ui.screens.AssetsScreen
import com.mengxinggg.gupiaomoniqi.ui.screens.AuthScreen
import com.mengxinggg.gupiaomoniqi.ui.screens.DetailScreen
import com.mengxinggg.gupiaomoniqi.ui.screens.DetailTradeActions
import com.mengxinggg.gupiaomoniqi.ui.screens.MarketScreen
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
            when (state.screen) {
                AppScreen.AUTH -> {
                    AuthScreen(
                        state = state,
                        onBack = viewModel::closeAuth,
                        onModeChange = viewModel::changeAuthMode,
                        onSubmit = viewModel::authenticate,
                        modifier = Modifier
                            .padding(innerPadding)
                            .statusBarsPadding(),
                    )
                }
                AppScreen.DETAIL -> {
                    DetailScreen(
                        state = state,
                        onBack = viewModel::closeDetail,
                        onRetry = viewModel::retryDetail,
                        onRangeChange = viewModel::changeChartRange,
                        onToggleWatchlist = viewModel::toggleWatchlist,
                        modifier = Modifier.padding(innerPadding),
                    )
                }
                AppScreen.MAIN -> {
                    when (state.selectedTab) {
                        MainTab.MARKET -> {
                            MarketScreen(
                                state = state,
                                onSearchChange = viewModel::setSearchQuery,
                                onFilterChange = viewModel::setMarketFilter,
                                onRefresh = viewModel::refreshMarket,
                                onLoadMore = viewModel::loadMoreMarket,
                                onOpenStock = viewModel::openStock,
                                onToggleWatchlist = viewModel::toggleWatchlist,
                                modifier = Modifier.padding(innerPadding),
                            )
                        }
                        MainTab.WATCHLIST -> {
                            WatchlistScreen(
                                state = state,
                                onLogin = viewModel::openAuth,
                                onRefresh = viewModel::refreshWatchlist,
                                onOpenStock = viewModel::openStock,
                                onToggleWatchlist = viewModel::toggleWatchlist,
                                modifier = Modifier.padding(innerPadding),
                            )
                        }
                        MainTab.ASSETS -> {
                            AssetsScreen(
                                state = state,
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

        if (state.tradeSheet != null) {
            TradeSheet(
                state = state,
                onDismiss = viewModel::dismissTradeSheet,
                onLotsChange = viewModel::updateTradeLots,
                onPercentage = viewModel::selectTradePercentage,
                onSubmit = viewModel::submitTrade,
            )
        }

        if (state.settingsOpen) {
            ServerSettingsSheet(
                currentUrl = state.serverUrl,
                error = state.serverError,
                saving = state.serverSaving,
                updateState = updateState,
                onDismiss = viewModel::closeSettings,
                onSave = viewModel::saveServerUrl,
                onUpdateAction = {
                    if (updateState.downloadedApkPath != null) {
                        updateManager.requestInstallAgain()
                    } else {
                        updateManager.checkAndInstall()
                    }
                },
            )
        }
    }
}
