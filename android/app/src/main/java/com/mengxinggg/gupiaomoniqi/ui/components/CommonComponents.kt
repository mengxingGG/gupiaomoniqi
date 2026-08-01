package com.mengxinggg.gupiaomoniqi.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.material.ExperimentalMaterialApi
import androidx.compose.material.pullrefresh.PullRefreshIndicator
import androidx.compose.material.pullrefresh.pullRefresh
import androidx.compose.material.pullrefresh.rememberPullRefreshState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.mengxinggg.gupiaomoniqi.ui.AccountUi
import com.mengxinggg.gupiaomoniqi.ui.MainTab
import com.mengxinggg.gupiaomoniqi.ui.StockUi
import com.mengxinggg.gupiaomoniqi.ui.UiDisplayCurrency
import com.mengxinggg.gupiaomoniqi.ui.UiMarketMode
import com.mengxinggg.gupiaomoniqi.ui.formatPercent
import com.mengxinggg.gupiaomoniqi.ui.formatQuoteMoney
import com.mengxinggg.gupiaomoniqi.ui.marketLabel
import com.mengxinggg.gupiaomoniqi.ui.theme.GainRed
import com.mengxinggg.gupiaomoniqi.ui.theme.LossGreen

@Composable
fun AppTopControls(
    mode: UiMarketMode,
    currency: UiDisplayCurrency,
    account: AccountUi?,
    hasAppUpdate: Boolean,
    onModeChange: (UiMarketMode) -> Unit,
    onCurrencyChange: (UiDisplayCurrency) -> Unit,
    onAccountClick: () -> Unit,
    onSettingsClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surface)
            .padding(horizontal = 10.dp, vertical = 3.dp),
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(28.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = account?.displayName ?: "登录",
                modifier = Modifier
                    .weight(1f)
                    .clickable(role = Role.Button, onClick = onAccountClick)
                    .padding(horizontal = 4.dp, vertical = 2.dp),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                textAlign = TextAlign.End,
                style = MaterialTheme.typography.labelSmall.copy(
                    fontSize = 10.sp,
                    lineHeight = 12.sp,
                ),
            )
            Spacer(Modifier.width(2.dp))
            Box(
                modifier = Modifier
                    .size(28.dp)
                    .clip(CircleShape)
                    .semantics {
                        contentDescription = if (hasAppUpdate) {
                            "设置，有新版本"
                        } else {
                            "设置"
                        }
                    }
                    .clickable(role = Role.Button, onClick = onSettingsClick),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    "⚙",
                    style = MaterialTheme.typography.titleSmall,
                )
                if (hasAppUpdate) {
                    Box(
                        modifier = Modifier
                            .align(Alignment.TopEnd)
                            .size(7.dp)
                            .background(
                                color = MaterialTheme.colorScheme.error,
                                shape = CircleShape,
                            ),
                    )
                }
            }
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            SegmentedChoice(
                modifier = Modifier.weight(1f),
                choices = listOf(
                    UiMarketMode.VIRTUAL to "模拟",
                    UiMarketMode.REAL to "真实",
                ),
                selected = mode,
                onSelected = onModeChange,
            )
            SegmentedChoice(
                modifier = Modifier.width(104.dp),
                choices = listOf(
                    UiDisplayCurrency.CNY to "CNY",
                    UiDisplayCurrency.USD to "USD",
                ),
                selected = currency,
                onSelected = onCurrencyChange,
            )
        }
    }
}

@OptIn(ExperimentalMaterialApi::class)
@Composable
fun PullToRefreshContainer(
    refreshing: Boolean,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable BoxScope.() -> Unit,
) {
    val refreshState = rememberPullRefreshState(refreshing, onRefresh)
    Box(modifier = modifier.pullRefresh(refreshState)) {
        content()
        PullRefreshIndicator(
            refreshing = refreshing,
            state = refreshState,
            modifier = Modifier.align(Alignment.TopCenter),
            backgroundColor = MaterialTheme.colorScheme.surface,
            contentColor = MaterialTheme.colorScheme.primary,
        )
    }
}

@Composable
private fun <T> SegmentedChoice(
    choices: List<Pair<T, String>>,
    selected: T,
    onSelected: (T) -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(10.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Row(modifier = Modifier.padding(2.dp)) {
            choices.forEach { (value, label) ->
                val active = selected == value
                Surface(
                    modifier = Modifier
                        .weight(1f)
                        .semantics {
                            contentDescription = "$label ${if (active) "已选择" else "未选择"}"
                        }
                        .clickable(
                            role = Role.RadioButton,
                            onClick = { onSelected(value) },
                        ),
                    shape = RoundedCornerShape(8.dp),
                    color = if (active) {
                        MaterialTheme.colorScheme.surface
                    } else {
                        Color.Transparent
                    },
                    shadowElevation = if (active) 1.dp else 0.dp,
                ) {
                    Text(
                        text = label,
                        modifier = Modifier.padding(horizontal = 4.dp, vertical = 5.dp),
                        color = if (active) {
                            MaterialTheme.colorScheme.primary
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                        fontWeight = if (active) FontWeight.Bold else FontWeight.Medium,
                        style = MaterialTheme.typography.labelSmall,
                    )
                }
            }
        }
    }
}

@Composable
fun MainBottomBar(
    selected: MainTab,
    onSelect: (MainTab) -> Unit,
) {
    NavigationBar {
        MainTab.entries.forEach { tab ->
            NavigationBarItem(
                selected = selected == tab,
                onClick = { onSelect(tab) },
                icon = {
                    Text(
                        when (tab) {
                            MainTab.MARKET -> "行"
                            MainTab.WATCHLIST -> "★"
                            MainTab.ORDERS -> "单"
                            MainTab.ASSETS -> "资"
                        },
                        fontWeight = FontWeight.Bold,
                    )
                },
                label = { Text(tab.label) },
            )
        }
    }
}

@Composable
fun ModeNotice(mode: UiMarketMode, modifier: Modifier = Modifier) {
    if (mode != UiMarketMode.REAL) return
    Surface(
        modifier = modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.55f),
        shape = RoundedCornerShape(10.dp),
    ) {
        Text(
            "真实行情 · 仅模拟交易，不会产生真实订单",
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 7.dp),
            color = MaterialTheme.colorScheme.onPrimaryContainer,
            fontWeight = FontWeight.Medium,
            style = MaterialTheme.typography.labelSmall,
        )
    }
}

@Composable
fun StockCard(
    stock: StockUi,
    currency: UiDisplayCurrency,
    watched: Boolean,
    onClick: () -> Unit,
    onWatchClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Card(
        onClick = onClick,
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(8.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Row(
            modifier = Modifier.padding(start = 10.dp, end = 4.dp, top = 7.dp, bottom = 7.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    stock.name,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    listOfNotNull(
                        stock.symbol,
                        marketLabel(stock.market),
                        stock.industry.trim().takeIf(String::isNotEmpty),
                    ).joinToString(" · "),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.labelSmall,
                )
            }
            Column(
                modifier = Modifier.width(96.dp),
                horizontalAlignment = Alignment.End,
            ) {
                Text(
                    formatQuoteMoney(stock, stock.currentPrice, currency),
                    maxLines = 1,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Bold,
                )
                MovementText(
                    value = stock.changePercent,
                    text = formatPercent(stock.changePercent),
                    style = MaterialTheme.typography.labelSmall,
                )
            }
            TextButton(
                modifier = Modifier
                    .size(36.dp)
                    .semantics {
                        contentDescription = if (watched) {
                            "移除${stock.name}自选"
                        } else {
                            "添加${stock.name}自选"
                        }
                    },
                onClick = onWatchClick,
                contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp),
            ) {
                Text(
                    if (watched) "★" else "☆",
                    color = if (watched) {
                        MaterialTheme.colorScheme.primary
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    },
                    style = MaterialTheme.typography.titleMedium,
                )
            }
        }
    }
}

@Composable
fun MarketBadge(market: String, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier.size(38.dp),
        shape = CircleShape,
        color = MaterialTheme.colorScheme.secondaryContainer,
    ) {
        Box(contentAlignment = Alignment.Center) {
            Text(
                market,
                color = MaterialTheme.colorScheme.onSecondaryContainer,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}

@Composable
fun MovementText(
    value: Double,
    text: String,
    modifier: Modifier = Modifier,
    style: androidx.compose.ui.text.TextStyle = MaterialTheme.typography.bodyMedium,
) {
    Text(
        text = text,
        modifier = modifier,
        color = when {
            value > 0 -> GainRed
            value < 0 -> LossGreen
            else -> MaterialTheme.colorScheme.onSurfaceVariant
        },
        fontWeight = FontWeight.Bold,
        style = style,
    )
}

@Composable
fun LoadingPanel(label: String, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(30.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        CircularProgressIndicator(modifier = Modifier.size(28.dp), strokeWidth = 3.dp)
        Text(
            label,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodyMedium,
        )
    }
}

@Composable
fun EmptyPanel(
    title: String,
    description: String,
    modifier: Modifier = Modifier,
    action: String? = null,
    onAction: (() -> Unit)? = null,
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f),
        ),
    ) {
        Column(
            modifier = Modifier.padding(22.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(7.dp),
        ) {
            Text(title, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
            Text(
                description,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall,
            )
            if (action != null && onAction != null) {
                Button(onClick = onAction) { Text(action) }
            }
        }
    }
}

@Composable
fun ErrorPanel(
    message: String,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.errorContainer,
        ),
    ) {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                "加载失败",
                color = MaterialTheme.colorScheme.onErrorContainer,
                fontWeight = FontWeight.Bold,
            )
            Text(
                message,
                color = MaterialTheme.colorScheme.onErrorContainer,
                style = MaterialTheme.typography.bodySmall,
            )
            OutlinedButton(onClick = onRetry) {
                Text("重试")
            }
        }
    }
}

@Composable
fun SectionTitle(
    title: String,
    modifier: Modifier = Modifier,
    caption: String? = null,
    trailing: (@Composable () -> Unit)? = null,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            if (caption != null) {
                Text(
                    caption,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
        trailing?.invoke()
    }
}

@Composable
fun KeyValueRow(
    label: String,
    value: String,
    valueColor: Color = MaterialTheme.colorScheme.onSurface,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            label,
            modifier = Modifier.weight(1f),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodySmall,
        )
        Text(
            value,
            color = valueColor,
            fontWeight = FontWeight.SemiBold,
            style = MaterialTheme.typography.bodyMedium,
        )
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.55f))
}
