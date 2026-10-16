package com.mengxinggg.gupiaomoniqi.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.ui.unit.sp
import com.mengxinggg.gupiaomoniqi.ui.components.FineIcon
import com.mengxinggg.gupiaomoniqi.ui.components.FineSymbol
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.mengxinggg.gupiaomoniqi.ui.AppUiState
import com.mengxinggg.gupiaomoniqi.ui.OrderBookLevelUi
import com.mengxinggg.gupiaomoniqi.ui.PositionUi
import com.mengxinggg.gupiaomoniqi.ui.StockUi
import com.mengxinggg.gupiaomoniqi.ui.UiChartRange
import com.mengxinggg.gupiaomoniqi.ui.UiMarketMode
import com.mengxinggg.gupiaomoniqi.ui.UiTradeSide
import com.mengxinggg.gupiaomoniqi.ui.components.EmptyPanel
import com.mengxinggg.gupiaomoniqi.ui.components.ErrorPanel
import com.mengxinggg.gupiaomoniqi.ui.components.KeyValueRow
import com.mengxinggg.gupiaomoniqi.ui.components.LoadingPanel
import com.mengxinggg.gupiaomoniqi.ui.components.MarketBadge
import com.mengxinggg.gupiaomoniqi.ui.components.MarketChart
import com.mengxinggg.gupiaomoniqi.ui.components.ModeNotice
import com.mengxinggg.gupiaomoniqi.ui.components.MovementText
import com.mengxinggg.gupiaomoniqi.ui.components.SectionTitle
import com.mengxinggg.gupiaomoniqi.ui.formatCompactNumber
import com.mengxinggg.gupiaomoniqi.ui.formatMoney
import com.mengxinggg.gupiaomoniqi.ui.formatPercent
import com.mengxinggg.gupiaomoniqi.ui.formatQuantity
import com.mengxinggg.gupiaomoniqi.ui.formatQuoteMoney
import com.mengxinggg.gupiaomoniqi.ui.marketLabel
import com.mengxinggg.gupiaomoniqi.ui.theme.GainRed
import com.mengxinggg.gupiaomoniqi.ui.theme.LossGreen

@Composable
fun DetailScreen(
    state: AppUiState,
    onBack: () -> Unit,
    onRetry: () -> Unit,
    onRangeChange: (UiChartRange) -> Unit,
    onToggleWatchlist: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val selectedStock = state.selectedStock
    when {
        state.detailLoading && selectedStock == null -> {
            LoadingPanel("正在加载股票详情…", modifier.fillMaxSize())
            return
        }

        selectedStock == null -> {
            Column(
                modifier = modifier
                    .fillMaxSize()
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                TextButton(onClick = onBack) { Text("← 返回行情") }
                ErrorPanel(
                    message = state.detailError ?: "没有找到这只股票",
                    onRetry = onRetry,
                )
            }
            return
        }
    }
    val stock = requireNotNull(selectedStock)

    LazyColumn(
        modifier = modifier.fillMaxSize().background(Color.White),
        contentPadding = PaddingValues(start = 10.dp, end = 10.dp, top = 2.dp, bottom = 22.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onBack) { FineIcon(FineSymbol.BACK, "返回行情") }
                Column(Modifier.weight(1f)) {
                    Text(stock.name, fontSize = 18.sp, lineHeight = 22.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text("${marketLabel(stock.market)} ${stock.symbol} · ${stock.industry}", fontSize = 10.sp, lineHeight = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                IconButton(onClick = { onToggleWatchlist(stock.id) }, colors = IconButtonDefaults.iconButtonColors(
                    contentColor = if (stock.id in state.watchlistIds) Color(0xFFE27B39) else MaterialTheme.colorScheme.onSurface,
                )) {
                    FineIcon(FineSymbol.STAR, if (stock.id in state.watchlistIds) "移除自选" else "加入自选")
                }
            }
        }
        if (state.detailError != null) {
            item {
                Text(
                    state.detailError,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
        item { QuoteSummary(stock = stock, state = state) }
        item {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(UiChartRange.entries, key = { it.name }) { range ->
                    TextButton(onClick = { onRangeChange(range) }, contentPadding = PaddingValues(horizontal = 16.dp, vertical = 2.dp)) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(range.label, color = if (state.chartRange == range) Color(0xFFE27B39) else Color(0xFF59616A), fontSize = 14.sp, lineHeight = 22.sp)
                            Box(Modifier.width(22.dp).height(2.dp).background(if (state.chartRange == range) Color(0xFFE27B39) else Color.Transparent))
                        }
                    }
                }
            }
        }
        if (state.chartNotice != null) {
            item {
                Surface(
                    color = MaterialTheme.colorScheme.surfaceVariant,
                    shape = RoundedCornerShape(12.dp),
                ) {
                    Text(
                        state.chartNotice,
                        modifier = Modifier.padding(12.dp),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        }
        item {
            if (state.chartLoading) {
                LoadingPanel("正在读取图表记录…")
            } else {
                MarketChart(
                    candles = state.candles,
                    range = state.chartRange,
                    quoteCurrency = stock.quoteCurrency,
                    displayCurrency = state.displayCurrency,
                )
            }
        }
        item {
            var detailTab by rememberSaveable { mutableStateOf("盘口") }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("盘口", "我的持仓").forEach { tab -> FilterChip(selected = detailTab == tab, onClick = { detailTab = tab }, label = { Text(tab) }) }
            }
            if (detailTab == "盘口") OrderBookPanel(state = state, stock = stock)
            else PositionPanel(position = state.selectedPosition, state = state)
        }
        item {
            StockFacts(stock = stock, mode = state.mode)
        }
    }
}

@Composable
private fun QuoteSummary(stock: StockUi, state: AppUiState) {
    val entries = listOf(
        "今开" to formatQuoteMoney(stock, stock.openPrice, state.displayCurrency),
        "最高" to formatQuoteMoney(stock, stock.highPrice, state.displayCurrency),
        "最低" to formatQuoteMoney(stock, stock.lowPrice, state.displayCurrency),
        "昨收" to formatQuoteMoney(stock, stock.previousClose, state.displayCurrency),
        "成交量" to formatCompactNumber(stock.volume),
        "每手" to "${stock.lotSize}股",
    )
    val price = formatQuoteMoney(stock, stock.currentPrice, state.displayCurrency)
    val updateTime = runCatching { java.time.Instant.parse(stock.updatedAt).atZone(java.time.ZoneId.systemDefault()).format(java.time.format.DateTimeFormatter.ofPattern("MM-dd HH:mm:ss")) }.getOrDefault(stock.updatedAt)
    BoxWithConstraints(Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 6.dp)) {
        val compact = maxWidth >= 310.dp && LocalDensity.current.fontScale <= 1.15f
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.then(if (compact) Modifier.width(112.dp) else Modifier.weight(1f))) {
                    Text(price, fontSize = if (price.length > 9) 17.sp else 26.sp, lineHeight = 34.sp, fontWeight = FontWeight.Bold,
                        color = if (stock.changePercent > 0) GainRed else if (stock.changePercent < 0) LossGreen else MaterialTheme.colorScheme.onSurface)
                    MovementText(stock.changePercent, formatPercent(stock.changePercent), style = MaterialTheme.typography.labelMedium)
                    MovementText(stock.changeAmount, formatQuoteMoney(stock, stock.changeAmount, state.displayCurrency, signed = true), style = MaterialTheme.typography.labelSmall)
                }
                if (compact) Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    entries.chunked(2).forEach { pair -> Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        pair.forEach { (label, value) -> QuoteStat(label, value, Modifier.weight(1f)) }
                    } }
                }
            }
            if (!compact) entries.chunked(2).forEach { pair -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                pair.forEach { (label, value) -> QuoteStat(label, value, Modifier.weight(1f)) }
            } }
            Text((if (state.mode == UiMarketMode.REAL) "真实行情 · 模拟交易" else "虚拟市场 · 模拟交易") + " · ${state.displayCurrency.name} · ${stock.settlementCycle} · $updateTime",
                fontSize = 10.sp, lineHeight = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (state.mode == UiMarketMode.REAL && stock.dataProvider in listOf("TENCENT", "SINA")) Text(
                "报价补缺：${if (stock.dataProvider == "TENCENT") "腾讯" else "新浪"} · 时间为来源行情时间，可能延迟",
                fontSize = 10.sp, lineHeight = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun QuoteStat(label: String, value: String, modifier: Modifier = Modifier) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
        Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 10.sp, lineHeight = 16.sp)
        Text(value, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.Medium, fontSize = 11.sp, lineHeight = 16.sp)
    }
}

@Composable
private fun OrderBookPanel(
    state: AppUiState,
    stock: StockUi,
) {
    Card {
        Column(
            modifier = Modifier.padding(15.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            SectionTitle(title = "五档盘口", caption = if (state.mode == UiMarketMode.REAL) "真实盘口 · 聚合快照" else "模拟盘口 · 聚合快照")
            val book = state.orderBook
            when {
                book == null && state.detailLoading -> {
                    LoadingPanel("正在读取盘口…")
                }

                book == null -> {
                    EmptyPanel(
                        title = "暂无盘口",
                        description = "服务端暂未返回该股票的盘口数据。",
                    )
                }

                !book.available -> {
                    EmptyPanel(
                        title = "真实盘口不可用",
                        description = book.notice ?: "当前真实行情来源不提供可验证的五档盘口。",
                    )
                }

                book.asks.isEmpty() && book.bids.isEmpty() -> {
                    EmptyPanel(
                        title = "盘口暂空",
                        description = book.notice ?: "等待服务端生成下一份盘口快照。",
                    )
                }

                else -> {
                    book.asks.take(5).asReversed().forEachIndexed { index, level ->
                        OrderLevelRow(
                            label = "卖 ${book.asks.take(5).size - index}",
                            level = level,
                            price = formatQuoteMoney(stock, level.price, state.displayCurrency),
                            color = LossGreen,
                        )
                    }
                    HorizontalDivider(modifier = Modifier.padding(vertical = 3.dp))
                    book.bids.take(5).forEachIndexed { index, level ->
                        OrderLevelRow(
                            label = "买 ${index + 1}",
                            level = level,
                            price = formatQuoteMoney(stock, level.price, state.displayCurrency),
                            color = GainRed,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun OrderLevelRow(
    label: String,
    level: OrderBookLevelUi,
    price: String,
    color: Color,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, modifier = Modifier.width(48.dp), color = color)
        Text(price, modifier = Modifier.weight(1f), fontWeight = FontWeight.SemiBold)
        Text(
            formatCompactNumber(level.quantity),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodySmall,
        )
    }
}

@Composable
private fun PositionPanel(
    position: PositionUi?,
    state: AppUiState,
) {
    Card {
        Column(modifier = Modifier.padding(15.dp)) {
            SectionTitle(
                title = "我的持仓",
                caption = if (state.account == null) "登录后查看" else "当前模拟盘",
            )
            Spacer(Modifier.height(8.dp))
            when {
                state.account == null -> {
                    EmptyPanel(
                        title = "尚未登录",
                        description = "下单时会引导你注册或登录。",
                    )
                }

                position == null -> {
                    EmptyPanel(
                        title = "当前未持有",
                        description = "完成首笔买入后，这里会显示成本和浮动盈亏。",
                    )
                }

                else -> {
                    KeyValueRow("持仓数量", "${formatQuantity(position.quantity)} 股")
                    KeyValueRow("可卖数量", "${formatQuantity(position.availableQuantity)} 股")
                    if (position.pendingSettlementQuantity > 0) {
                        KeyValueRow(
                            "待结算",
                            "${formatQuantity(position.pendingSettlementQuantity)} 股",
                        )
                    }
                    KeyValueRow(
                        "平均成本",
                        formatMoney(position.averageCostUsd, state.displayCurrency),
                    )
                    KeyValueRow(
                        "持仓市值",
                        formatMoney(position.marketValueUsd, state.displayCurrency),
                    )
                    KeyValueRow(
                        "浮动盈亏",
                        "${formatMoney(position.profitLossUsd, state.displayCurrency, signed = true)} " +
                            formatPercent(position.profitLossPercent),
                        valueColor = when {
                            position.profitLossUsd > 0 -> GainRed
                            position.profitLossUsd < 0 -> LossGreen
                            else -> MaterialTheme.colorScheme.onSurface
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun StockFacts(stock: StockUi, mode: UiMarketMode) {
    Card {
        Column(modifier = Modifier.padding(15.dp)) {
            SectionTitle(title = "股票资料")
            Spacer(Modifier.height(6.dp))
            KeyValueRow("市场", marketLabel(stock.market))
            KeyValueRow("代码", stock.symbol)
            KeyValueRow("行业", stock.industry.ifBlank { "—" })
            KeyValueRow("报价币种", stock.quoteCurrency)
            KeyValueRow("交易单位", "${stock.lotSize} 股 / 手")
            KeyValueRow("结算", stock.settlementCycle)
            KeyValueRow("模式", if (mode == UiMarketMode.REAL) "真实行情模拟盘" else "虚拟市场模拟盘")
            KeyValueRow("可交易", if (stock.tradable) "是" else "否")
        }
    }
}

@Composable
fun DetailTradeActions(
    stock: StockUi?,
    tradeBusy: Boolean,
    onTrade: (UiTradeSide) -> Unit,
) {
    Surface(shadowElevation = 8.dp, tonalElevation = 2.dp) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            OutlinedButton(
                onClick = { onTrade(UiTradeSide.SELL) },
                enabled = stock?.tradable == true && !tradeBusy,
                modifier = Modifier.weight(1f),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = LossGreen),
            ) {
                Text("卖出")
            }
            Button(
                onClick = { onTrade(UiTradeSide.BUY) },
                enabled = stock?.tradable == true && !tradeBusy,
                modifier = Modifier.weight(1f),
                colors = ButtonDefaults.buttonColors(containerColor = GainRed),
            ) {
                Text("买入")
            }
        }
    }
}
