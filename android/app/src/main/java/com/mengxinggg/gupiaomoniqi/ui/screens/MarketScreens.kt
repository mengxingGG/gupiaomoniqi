package com.mengxinggg.gupiaomoniqi.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.mengxinggg.gupiaomoniqi.ui.AppUiState
import com.mengxinggg.gupiaomoniqi.ui.MarketFilter
import com.mengxinggg.gupiaomoniqi.ui.UiMarketMode
import com.mengxinggg.gupiaomoniqi.ui.components.EmptyPanel
import com.mengxinggg.gupiaomoniqi.ui.components.ErrorPanel
import com.mengxinggg.gupiaomoniqi.ui.components.LoadingPanel
import com.mengxinggg.gupiaomoniqi.ui.components.ModeNotice
import com.mengxinggg.gupiaomoniqi.ui.components.SectionTitle
import com.mengxinggg.gupiaomoniqi.ui.components.StockCard

@Composable
fun MarketScreen(
    state: AppUiState,
    onSearchChange: (String) -> Unit,
    onFilterChange: (MarketFilter) -> Unit,
    onRefresh: () -> Unit,
    onLoadMore: () -> Unit,
    onOpenStock: (String) -> Unit,
    onToggleWatchlist: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 10.dp, end = 10.dp, top = 8.dp, bottom = 20.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    if (state.mode == UiMarketMode.REAL) "真实行情" else "模拟行情",
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                )
                TextButton(
                    enabled = !state.marketRefreshing,
                    onClick = onRefresh,
                ) {
                    Text(
                        if (state.marketRefreshing) "刷新中…" else "刷新",
                        style = MaterialTheme.typography.labelMedium,
                    )
                }
            }
        }
        item { ModeNotice(state.mode) }
        item {
            OutlinedTextField(
                value = state.searchQuery,
                onValueChange = onSearchChange,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp),
                placeholder = {
                    Text(
                        "搜索名称或代码",
                        style = MaterialTheme.typography.bodySmall,
                    )
                },
                textStyle = MaterialTheme.typography.bodySmall,
                singleLine = true,
                trailingIcon = {
                    if (state.searchQuery.isNotEmpty()) {
                        TextButton(onClick = { onSearchChange("") }) {
                            Text("清除", style = MaterialTheme.typography.labelSmall)
                        }
                    }
                },
            )
        }
        item {
            LazyRow(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                contentPadding = PaddingValues(end = 6.dp),
            ) {
                items(MarketFilter.entries, key = { it.name }) { filter ->
                    FilterChip(
                        modifier = Modifier.height(36.dp),
                        selected = state.marketFilter == filter,
                        onClick = { onFilterChange(filter) },
                        label = {
                            Text(
                                filter.label,
                                style = MaterialTheme.typography.labelSmall,
                            )
                        },
                    )
                }
            }
        }
        if (state.marketRefreshing && state.marketItems.isNotEmpty()) {
            item { LinearProgressIndicator(modifier = Modifier.fillMaxWidth()) }
        }
        when {
            state.marketLoading && state.marketItems.isEmpty() -> {
                item { LoadingPanel("正在读取最新行情…") }
            }

            state.marketError != null && state.marketItems.isEmpty() -> {
                item { ErrorPanel(state.marketError, onRetry = onRefresh) }
            }

            state.marketItems.isEmpty() -> {
                item {
                    EmptyPanel(
                        title = "没有匹配的股票",
                        description = "换一个名称、代码或市场试试。",
                        action = "清除筛选",
                        onAction = {
                            onSearchChange("")
                            onFilterChange(MarketFilter.ALL)
                        },
                    )
                }
            }

            else -> {
                items(state.marketItems, key = { it.id }) { stock ->
                    StockCard(
                        stock = stock,
                        currency = state.displayCurrency,
                        watched = stock.id in state.watchlistIds,
                        onClick = { onOpenStock(stock.id) },
                        onWatchClick = { onToggleWatchlist(stock.id) },
                    )
                }
                if (state.marketError != null) {
                    item {
                        Text(
                            state.marketError,
                            modifier = Modifier.padding(vertical = 4.dp),
                            color = MaterialTheme.colorScheme.error,
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
                item {
                    if (state.hasMoreMarketItems) {
                        Button(
                            onClick = onLoadMore,
                            enabled = !state.marketLoadingMore,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text(
                                if (state.marketLoadingMore) {
                                    "加载中…"
                                } else {
                                    "加载更多（${state.marketItems.size}/${state.marketTotal}）"
                                },
                            )
                        }
                    } else {
                        Text(
                            "已显示全部 ${state.marketItems.size} 只股票",
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 10.dp),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            fontWeight = FontWeight.Medium,
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun WatchlistScreen(
    state: AppUiState,
    onLogin: () -> Unit,
    onRefresh: () -> Unit,
    onOpenStock: (String) -> Unit,
    onToggleWatchlist: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 10.dp, end = 10.dp, top = 8.dp, bottom = 20.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        item {
            SectionTitle(
                title = "我的自选",
                trailing = {
                    if (state.account != null) {
                        TextButton(onClick = onRefresh) { Text("刷新") }
                    }
                },
            )
        }
        item { ModeNotice(state.mode) }

        if (state.account == null) {
            item {
                EmptyPanel(
                    title = "登录后保存自选",
                    description = "行情可以公开浏览；登录后可在两个模拟盘分别管理自选股。",
                    action = "注册或登录",
                    onAction = onLogin,
                )
            }
        } else {
            when {
                state.watchlistLoading && state.watchlistItems.isEmpty() -> {
                    item { LoadingPanel("正在同步自选…") }
                }

                state.watchlistItems.isEmpty() -> {
                    item {
                        EmptyPanel(
                            title = "自选列表还是空的",
                            description = "在行情或详情页点击星标，即可把股票加到当前模拟盘。",
                        )
                    }
                }

                else -> {
                    items(state.watchlistItems, key = { it.id }) { stock ->
                        StockCard(
                            stock = stock,
                            currency = state.displayCurrency,
                            watched = true,
                            onClick = { onOpenStock(stock.id) },
                            onWatchClick = { onToggleWatchlist(stock.id) },
                        )
                    }
                }
            }
        }
    }
}
