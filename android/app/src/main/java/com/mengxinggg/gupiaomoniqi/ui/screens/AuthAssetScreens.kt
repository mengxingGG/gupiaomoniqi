package com.mengxinggg.gupiaomoniqi.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.mengxinggg.gupiaomoniqi.ui.AppUiState
import com.mengxinggg.gupiaomoniqi.ui.AuthMode
import com.mengxinggg.gupiaomoniqi.ui.LimitOrderUi
import com.mengxinggg.gupiaomoniqi.ui.PositionUi
import com.mengxinggg.gupiaomoniqi.ui.TransactionUi
import com.mengxinggg.gupiaomoniqi.ui.UiMarketMode
import com.mengxinggg.gupiaomoniqi.ui.UiOrderMode
import com.mengxinggg.gupiaomoniqi.ui.UiOrderStatus
import com.mengxinggg.gupiaomoniqi.ui.components.EmptyPanel
import com.mengxinggg.gupiaomoniqi.ui.components.ErrorPanel
import com.mengxinggg.gupiaomoniqi.ui.components.LoadingPanel
import com.mengxinggg.gupiaomoniqi.ui.components.MarketBadge
import com.mengxinggg.gupiaomoniqi.ui.components.PullToRefreshContainer
import com.mengxinggg.gupiaomoniqi.ui.components.SectionTitle
import com.mengxinggg.gupiaomoniqi.ui.formatMoney
import com.mengxinggg.gupiaomoniqi.ui.formatPercent
import com.mengxinggg.gupiaomoniqi.ui.formatQuantity
import com.mengxinggg.gupiaomoniqi.ui.formatTime
import com.mengxinggg.gupiaomoniqi.ui.marketLabel
import com.mengxinggg.gupiaomoniqi.ui.modeLabel
import com.mengxinggg.gupiaomoniqi.ui.theme.GainRed
import com.mengxinggg.gupiaomoniqi.ui.theme.LossGreen

@Composable
fun AuthScreen(
    state: AppUiState,
    onBack: () -> Unit,
    onModeChange: (AuthMode) -> Unit,
    onSubmit: (AuthMode, String, String, String) -> Unit,
    modifier: Modifier = Modifier,
) {
    var username by rememberSaveable { mutableStateOf("") }
    var displayName by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    val canSubmit = username.isNotBlank() &&
        password.isNotBlank() &&
        (state.authMode == AuthMode.LOGIN || displayName.isNotBlank())

    fun submit() {
        if (canSubmit && !state.authBusy) {
            onSubmit(state.authMode, username.trim(), displayName.trim(), password)
        }
    }

    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = PaddingValues(18.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item {
            TextButton(onClick = onBack) {
                Text("← 返回")
            }
        }
        item {
            Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
                Text(
                    "一套身份 · 两个独立模拟盘",
                    color = MaterialTheme.colorScheme.primary,
                    fontWeight = FontWeight.Bold,
                    style = MaterialTheme.typography.labelLarge,
                )
                Text(
                    "从一笔干净的模拟资金开始",
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Black,
                )
                Text(
                    "注册后，虚拟盘与真实行情盘各有独立的模拟资金、持仓和成交。REAL 不连接券商。",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }
        item {
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            ) {
                Column(
                    modifier = Modifier.padding(18.dp),
                    verticalArrangement = Arrangement.spacedBy(13.dp),
                ) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilterChip(
                            selected = state.authMode == AuthMode.REGISTER,
                            onClick = { onModeChange(AuthMode.REGISTER) },
                            label = { Text("注册账户") },
                        )
                        FilterChip(
                            selected = state.authMode == AuthMode.LOGIN,
                            onClick = { onModeChange(AuthMode.LOGIN) },
                            label = { Text("登录") },
                        )
                    }

                    Text(
                        if (state.authMode == AuthMode.REGISTER) {
                            "创建模拟交易账户"
                        } else {
                            "欢迎回来"
                        },
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold,
                    )

                    if (state.authMode == AuthMode.REGISTER) {
                        OutlinedTextField(
                            value = displayName,
                            onValueChange = { displayName = it.take(50) },
                            modifier = Modifier.fillMaxWidth(),
                            label = { Text("显示名称") },
                            placeholder = { Text("例如：星河交易员") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                        )
                    }
                    OutlinedTextField(
                        value = username,
                        onValueChange = { username = it.take(20) },
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("用户名") },
                        placeholder = { Text("字母、数字或下划线") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                    )
                    OutlinedTextField(
                        value = password,
                        onValueChange = { password = it.take(128) },
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("密码") },
                        supportingText = {
                            if (state.authMode == AuthMode.REGISTER) {
                                Text("至少 8 位，建议包含大小写字母与数字")
                            }
                        },
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = { submit() }),
                    )
                    if (state.authError != null) {
                        Surface(
                            color = MaterialTheme.colorScheme.errorContainer,
                            shape = RoundedCornerShape(10.dp),
                        ) {
                            Text(
                                state.authError,
                                modifier = Modifier.padding(11.dp),
                                color = MaterialTheme.colorScheme.onErrorContainer,
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }
                    }
                    Button(
                        onClick = { submit() },
                        enabled = canSubmit && !state.authBusy,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(
                            when {
                                state.authBusy -> "请稍候…"
                                state.authMode == AuthMode.REGISTER -> "注册并领取模拟资金"
                                else -> "登录账户"
                            },
                        )
                    }
                }
            }
        }
        item {
            Text(
                "浏览行情无需注册，只有保存自选、查看资产和模拟下单需要账户。",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

private enum class OrderPage { TRANSACTIONS, ORDERS }

@Composable
fun AssetsScreen(
    state: AppUiState,
    onLogin: () -> Unit,
    onRefresh: () -> Unit,
    onLogout: () -> Unit,
    onOpenStock: (String) -> Unit,
    onCheckIn: () -> Unit,
    onRedeemGift: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    var giftCode by rememberSaveable(state.mode) { mutableStateOf("") }

    PullToRefreshContainer(
        refreshing = state.accountLoading,
        onRefresh = onRefresh,
        modifier = modifier.fillMaxSize(),
    ) {
      LazyColumn(
          modifier = Modifier.fillMaxSize(),
          contentPadding = PaddingValues(12.dp),
          verticalArrangement = Arrangement.spacedBy(10.dp),
      ) {
        val account = state.account
        if (account == null) {
            item {
                EmptyPanel(
                    title = "注册后，资产与交易都在这里",
                    description = "行情始终公开；只有模拟下单、持仓与成交记录需要账户。",
                    action = "注册或登录",
                    onAction = onLogin,
                )
            }
            return@LazyColumn
        }

        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        "${account.displayName} · ${modeLabel(state.mode)}账户",
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold,
                    )
                    Text(
                        "两个模拟盘资金与持仓互相隔离",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.labelSmall,
                    )
                }
                TextButton(onClick = onLogout) {
                    Text("退出", style = MaterialTheme.typography.labelSmall)
                }
            }
        }
        if (state.accountError != null) {
            item { ErrorPanel(state.accountError, onRetry = onRefresh) }
        }

        if (state.accountLoading && state.portfolio == null) {
            item { LoadingPanel("正在计算最新资产…") }
            return@LazyColumn
        }

        val portfolio = state.portfolio
        if (portfolio == null) {
            item {
                EmptyPanel(
                    title = "资产尚未加载",
                    description = "检查网络或服务端状态后重试。",
                    action = "重新加载",
                    onAction = onRefresh,
                )
            }
            return@LazyColumn
        }

        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                AssetMetric(
                    label = "总资产",
                    value = formatMoney(portfolio.totalAssetsUsd, state.displayCurrency),
                    note = "现金 + 持仓",
                    modifier = Modifier.weight(1f),
                    emphasis = true,
                )
                AssetMetric(
                    label = "可用资金",
                    value = formatMoney(portfolio.availableCashUsd, state.displayCurrency),
                    note = "可用于交易",
                    modifier = Modifier.weight(1f),
                )
            }
        }
        item { SectionTitle(title = "当前持仓", caption = "${portfolio.positions.size} 个标的") }
        if (portfolio.positions.isEmpty()) {
            item {
                EmptyPanel(
                    title = "还没有持仓",
                    description = "从行情页打开任意股票即可开始模拟交易。",
                )
            }
        } else {
            items(portfolio.positions, key = { it.instrumentId }) { position ->
                PositionCard(
                    position = position,
                    state = state,
                    onClick = { onOpenStock(position.instrumentId) },
                )
            }
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                AssetMetric(
                    label = "持仓市值",
                    value = formatMoney(portfolio.positionsValueUsd, state.displayCurrency),
                    note = if (state.mode == UiMarketMode.REAL) "按最新真实价" else "按最新模拟价",
                    modifier = Modifier.weight(1f),
                )
                AssetMetric(
                    label = "累计收益",
                    value = formatMoney(portfolio.totalProfitLossUsd, state.displayCurrency, signed = true),
                    note = "已实现 ${formatMoney(portfolio.realizedProfitUsd, state.displayCurrency)}",
                    modifier = Modifier.weight(1f),
                    movement = portfolio.totalProfitLossUsd,
                )
            }
        }
        item {
            RewardsPanel(
                state = state,
                giftCode = giftCode,
                onGiftCodeChange = { giftCode = it },
                onCheckIn = onCheckIn,
                onRedeemGift = { onRedeemGift(giftCode.trim()) },
            )
        }
      }
    }
}

@Composable
fun OrdersScreen(
    state: AppUiState,
    onLogin: () -> Unit,
    onRefresh: () -> Unit,
    onOpenStock: (String) -> Unit,
    onCancelOrder: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    var orderPage by rememberSaveable(state.mode) { mutableStateOf(OrderPage.TRANSACTIONS) }
    var orderFilter by rememberSaveable(state.mode) { mutableStateOf(UiOrderStatus.OPEN.name) }
    PullToRefreshContainer(
        refreshing = state.accountLoading,
        onRefresh = onRefresh,
        modifier = modifier.fillMaxSize(),
    ) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (state.account == null) {
                item {
                    EmptyPanel(
                        title = "登录后查看订单",
                        description = "成交和委托记录按两个模拟盘分别保存。",
                        action = "注册或登录",
                        onAction = onLogin,
                    )
                }
                return@LazyColumn
            }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(
                        selected = orderPage == OrderPage.TRANSACTIONS,
                        onClick = { orderPage = OrderPage.TRANSACTIONS },
                        label = { Text("成交记录") },
                    )
                    FilterChip(
                        selected = orderPage == OrderPage.ORDERS,
                        onClick = { orderPage = OrderPage.ORDERS },
                        label = { Text("委托订单") },
                    )
                }
            }
            if (state.accountError != null) {
                item { ErrorPanel(state.accountError, onRetry = onRefresh) }
            }
            if (state.accountLoading && state.transactions.isEmpty() && state.orders.isEmpty()) {
                item { LoadingPanel("正在同步订单…") }
            } else if (orderPage == OrderPage.TRANSACTIONS) {
                if (state.transactions.isEmpty()) {
                    item { EmptyPanel("暂无成交", "买入或卖出后，流水会立即出现在这里。") }
                } else {
                    items(state.transactions, key = { it.id }) { transaction ->
                        TransactionCard(transaction, state) { onOpenStock(transaction.instrumentId) }
                    }
                }
            } else if (state.ordersUnavailable) {
                item {
                    EmptyPanel(
                        title = "服务器版本过旧，请先更新后端",
                        description = "资产、持仓和成交记录仍可正常使用。",
                    )
                }
            } else {
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                        listOf(
                            UiOrderStatus.OPEN.name to "进行中",
                            UiOrderStatus.FILLED.name to "已成交",
                            UiOrderStatus.CANCELLED.name to "已撤单",
                            "ALL" to "全部",
                        ).forEach { (value, label) ->
                            FilterChip(
                                selected = orderFilter == value,
                                onClick = { orderFilter = value },
                                label = { Text(label, style = MaterialTheme.typography.labelSmall) },
                            )
                        }
                    }
                }
                val visibleOrders = state.orders.filter {
                    orderFilter == "ALL" || it.status.name == orderFilter
                }
                if (visibleOrders.isEmpty()) {
                    item {
                        EmptyPanel(
                            title = if (orderFilter == UiOrderStatus.OPEN.name) "暂无进行中的委托" else "该分类暂无订单",
                            description = "限价单提交后可在这里查看状态与撤单。",
                        )
                    }
                } else {
                    items(visibleOrders, key = { it.id }) { order ->
                        LimitOrderCard(
                            order = order,
                            state = state,
                            onClick = { onOpenStock(order.instrumentId) },
                            onCancel = { onCancelOrder(order.id) },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun RewardsPanel(
    state: AppUiState,
    giftCode: String,
    onGiftCodeChange: (String) -> Unit,
    onCheckIn: () -> Unit,
    onRedeemGift: () -> Unit,
) {
    Card(
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.58f),
        ),
    ) {
        Column(
            modifier = Modifier.padding(15.dp),
            verticalArrangement = Arrangement.spacedBy(11.dp),
        ) {
            Text(
                "每日奖励",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
            )
            Text(
                "每日只能签到一次，奖励进入当前打开的模拟盘。",
                color = MaterialTheme.colorScheme.onPrimaryContainer,
                style = MaterialTheme.typography.bodySmall,
            )
            Button(
                onClick = onCheckIn,
                enabled = state.checkIn?.claimed != true && !state.rewardBusy,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(
                    when {
                        state.rewardBusy -> "正在入账…"
                        state.checkIn?.claimed == true -> {
                            "今日已签到 · ${modeLabel(state.checkIn.mode ?: state.mode)}"
                        }
                        else -> "签到领取 US$100,000"
                    },
                )
            }
            OutlinedTextField(
                value = giftCode,
                onValueChange = { onGiftCodeChange(it.take(64)) },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("礼包码") },
                placeholder = { Text("输入礼包码") },
                singleLine = true,
            )
            OutlinedButton(
                onClick = onRedeemGift,
                enabled = giftCode.isNotBlank() && !state.rewardBusy,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("领取到当前模拟盘")
            }
        }
    }
}

@Composable
private fun AssetMetric(
    label: String,
    value: String,
    note: String,
    modifier: Modifier = Modifier,
    emphasis: Boolean = false,
    movement: Double? = null,
) {
    Card(
        modifier = modifier,
        colors = CardDefaults.cardColors(
            containerColor = if (emphasis) {
                MaterialTheme.colorScheme.primaryContainer
            } else {
                MaterialTheme.colorScheme.surface
            },
        ),
    ) {
        Column(
            modifier = Modifier.padding(13.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                label,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.labelMedium,
            )
            Text(
                value,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                color = when {
                    movement == null -> MaterialTheme.colorScheme.onSurface
                    movement > 0 -> GainRed
                    movement < 0 -> LossGreen
                    else -> MaterialTheme.colorScheme.onSurface
                },
                fontWeight = FontWeight.Black,
                style = MaterialTheme.typography.titleMedium,
            )
            Text(
                note,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.labelSmall,
            )
        }
    }
}

@Composable
private fun PositionCard(
    position: PositionUi,
    state: AppUiState,
    onClick: () -> Unit,
) {
    Card(
        onClick = onClick,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(9.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                MarketBadge(position.market)
                Spacer(Modifier.padding(5.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(position.name, fontWeight = FontWeight.Bold)
                    Text(
                        "${position.symbol} · ${marketLabel(position.market)}",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
                Text(
                    formatMoney(position.marketValueUsd, state.displayCurrency),
                    fontWeight = FontWeight.Bold,
                )
            }
            Row {
                Text(
                    "持仓 ${formatQuantity(position.quantity)} · 可卖 ${formatQuantity(position.availableQuantity)}" +
                        if (position.frozenQuantity > 0) {
                            " · 冻结 ${formatQuantity(position.frozenQuantity)}"
                        } else {
                            ""
                        },
                    modifier = Modifier.weight(1f),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall,
                )
                Text(
                    "${formatMoney(position.profitLossUsd, state.displayCurrency, signed = true)} " +
                        formatPercent(position.profitLossPercent),
                    color = if (position.profitLossUsd >= 0) GainRed else LossGreen,
                    fontWeight = FontWeight.Bold,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
    }
}

@Composable
private fun LimitOrderCard(
    order: LimitOrderUi,
    state: AppUiState,
    onClick: () -> Unit,
    onCancel: () -> Unit,
) {
    val sideColor = if (order.side.name == "BUY") GainRed else LossGreen
    Card(
        onClick = onClick,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(7.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = sideColor.copy(alpha = 0.14f),
                ) {
                    Text(
                        if (order.side.name == "BUY") "买入" else "卖出",
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                        color = sideColor,
                        fontWeight = FontWeight.Bold,
                        style = MaterialTheme.typography.labelMedium,
                    )
                }
                Spacer(Modifier.padding(4.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(order.name, fontWeight = FontWeight.Bold)
                    Text(
                        "${order.symbol} · ${marketLabel(order.market)} · ${formatTime(order.createdAt)}",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.labelSmall,
                    )
                }
                Text(
                    order.status.label,
                    color = if (order.status == UiOrderStatus.OPEN) {
                        MaterialTheme.colorScheme.primary
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    },
                    fontWeight = FontWeight.Bold,
                    style = MaterialTheme.typography.labelMedium,
                )
            }
            Row {
                Text(
                    if (order.orderMode == UiOrderMode.LIMIT) {
                        val quotePriceUsd = if (order.quoteCurrency == "CNY") {
                            (order.limitPrice ?: 0.0) / 7.0
                        } else {
                            order.limitPrice ?: 0.0
                        }
                        "限价 ${formatMoney(quotePriceUsd, state.displayCurrency)}"
                    } else {
                        "市价单"
                    },
                    modifier = Modifier.weight(1f),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall,
                )
                Text(
                    "${formatQuantity(order.filledQuantity)}/${formatQuantity(order.quantity)} 股",
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            if (order.status == UiOrderStatus.OPEN) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        if (order.side.name == "BUY") {
                            "冻结 ${formatMoney(order.reservedCashUsd, state.displayCurrency)}"
                        } else {
                            "冻结 ${formatQuantity(order.reservedQuantity)} 股"
                        },
                        modifier = Modifier.weight(1f),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall,
                    )
                    TextButton(
                        onClick = onCancel,
                        enabled = state.cancellingOrderId == null,
                    ) {
                        Text(if (state.cancellingOrderId == order.id) "撤单中…" else "撤单")
                    }
                }
            }
        }
    }
}

@Composable
private fun TransactionCard(
    transaction: TransactionUi,
    state: AppUiState,
    onClick: () -> Unit,
) {
    Card(
        onClick = onClick,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = if (transaction.side.name == "BUY") {
                        GainRed.copy(alpha = 0.14f)
                    } else {
                        LossGreen.copy(alpha = 0.14f)
                    },
                ) {
                    Text(
                        if (transaction.side.name == "BUY") "买入" else "卖出",
                        modifier = Modifier.padding(horizontal = 9.dp, vertical = 5.dp),
                        color = if (transaction.side.name == "BUY") GainRed else LossGreen,
                        fontWeight = FontWeight.Bold,
                        style = MaterialTheme.typography.labelMedium,
                    )
                }
                Spacer(Modifier.padding(5.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(transaction.name, fontWeight = FontWeight.Bold)
                    Text(
                        "${transaction.symbol} · ${formatTime(transaction.createdAt)}",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
                Text(
                    "${formatQuantity(transaction.quantity)} 股",
                    fontWeight = FontWeight.SemiBold,
                )
            }
            Row {
                Text(
                    "净额 ${formatMoney(transaction.netAmountUsd, state.displayCurrency)}",
                    modifier = Modifier.weight(1f),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall,
                )
                transaction.realizedProfitUsd?.let { profit ->
                    Text(
                        "已实现 ${formatMoney(profit, state.displayCurrency, signed = true)}",
                        color = if (profit >= 0) GainRed else LossGreen,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        }
    }
}
