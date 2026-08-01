package com.mengxinggg.gupiaomoniqi.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.mengxinggg.gupiaomoniqi.ui.AppUiState
import com.mengxinggg.gupiaomoniqi.ui.UiOrderMode
import com.mengxinggg.gupiaomoniqi.ui.UiTradeSide
import com.mengxinggg.gupiaomoniqi.ui.effectivePriceUsdOrNull
import com.mengxinggg.gupiaomoniqi.ui.formatMoney
import com.mengxinggg.gupiaomoniqi.ui.formatQuoteMoney
import com.mengxinggg.gupiaomoniqi.ui.limitPriceDisplayOrNull
import com.mengxinggg.gupiaomoniqi.ui.modeLabel
import com.mengxinggg.gupiaomoniqi.ui.theme.GainRed
import com.mengxinggg.gupiaomoniqi.ui.theme.LossGreen
import kotlin.math.max

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TradeSheet(
    state: AppUiState,
    onDismiss: () -> Unit,
    onOrderModeChange: (UiOrderMode) -> Unit,
    onLimitPriceChange: (String) -> Unit,
    onLotsChange: (Int) -> Unit,
    onPercentage: (Int) -> Unit,
    onSubmit: () -> Unit,
) {
    val sheet = state.tradeSheet ?: return
    val stock = sheet.stock
    val quantity = sheet.lots * stock.lotSize
    val limitPrice = sheet.limitPriceDisplayOrNull()
    val effectivePriceUsd = sheet.effectivePriceUsdOrNull() ?: 0.0
    val grossUsd = effectivePriceUsd * quantity
    val feeUsd = max(1.0, grossUsd * 0.0003)
    val sideColor = if (sheet.side == UiTradeSide.BUY) GainRed else LossGreen

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .imePadding()
                .navigationBarsPadding()
                .padding(start = 18.dp, end = 18.dp, bottom = 18.dp),
            verticalArrangement = Arrangement.spacedBy(13.dp),
        ) {
            Column {
                Text(
                    "${if (sheet.side == UiTradeSide.BUY) "买入" else "卖出"} ${stock.name}",
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Black,
                )
                Text(
                    "${stock.symbol} · ${modeLabel(state.mode)} · ${sheet.orderMode.label}单",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall,
                )
            }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                UiOrderMode.entries.forEach { mode ->
                    FilterChip(
                        selected = sheet.orderMode == mode,
                        onClick = { onOrderModeChange(mode) },
                        enabled = !state.tradeBusy,
                        label = { Text("${mode.label}交易") },
                    )
                }
            }

            if (sheet.orderMode == UiOrderMode.LIMIT) {
                OutlinedTextField(
                    value = sheet.limitPriceInput,
                    onValueChange = onLimitPriceChange,
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !state.tradeBusy,
                    label = { Text("限价（${sheet.limitPriceCurrency.name}）") },
                    supportingText = {
                        Text(
                            "按当前显示币种输入，提交时自动换算为 " +
                                stock.quoteCurrency,
                        )
                    },
                    isError = sheet.limitPriceInput.isNotBlank() && limitPrice == null,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    singleLine = true,
                )
            }

            if (state.mode.name == "REAL") {
                Surface(
                    color = MaterialTheme.colorScheme.primaryContainer,
                    shape = MaterialTheme.shapes.medium,
                ) {
                    Text(
                        "按最新真实行情进行模拟成交，不连接券商。",
                        modifier = Modifier.padding(11.dp),
                        color = MaterialTheme.colorScheme.onPrimaryContainer,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }

            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        if (sheet.orderMode == UiOrderMode.LIMIT) "委托价" else "参考价",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.labelMedium,
                    )
                    Text(
                        if (sheet.orderMode == UiOrderMode.LIMIT) {
                            formatMoney(effectivePriceUsd, state.displayCurrency)
                        } else {
                            formatQuoteMoney(stock, stock.currentPrice, state.displayCurrency)
                        },
                        fontWeight = FontWeight.Bold,
                    )
                }
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        "每手",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.labelMedium,
                    )
                    Text("${stock.lotSize} 股", fontWeight = FontWeight.Bold)
                }
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        "最多",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.labelMedium,
                    )
                    Text("${sheet.maxLots} 手", fontWeight = FontWeight.Bold)
                }
            }

            OutlinedTextField(
                value = if (sheet.lots == 0) "" else sheet.lots.toString(),
                onValueChange = { raw ->
                    onLotsChange(raw.filter(Char::isDigit).toIntOrNull() ?: 0)
                },
                modifier = Modifier.fillMaxWidth(),
                enabled = sheet.maxLots > 0 && !state.tradeBusy,
                label = { Text("手数") },
                supportingText = {
                    Text("共 $quantity 股 · 必须按整手下单")
                },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                singleLine = true,
            )

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(7.dp),
            ) {
                listOf(25, 50, 75, 100).forEach { percent ->
                    OutlinedButton(
                        onClick = { onPercentage(percent) },
                        enabled = sheet.maxLots > 0 && !state.tradeBusy,
                        modifier = Modifier.weight(1f),
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(
                            horizontal = 2.dp,
                            vertical = 8.dp,
                        ),
                    ) {
                        Text("$percent%", style = MaterialTheme.typography.labelMedium)
                    }
                }
            }

            Surface(
                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f),
                shape = MaterialTheme.shapes.medium,
            ) {
                Column(
                    modifier = Modifier.padding(12.dp),
                    verticalArrangement = Arrangement.spacedBy(5.dp),
                ) {
                    Row {
                        Text(
                            if (sheet.orderMode == UiOrderMode.LIMIT) "预计委托额" else "预计成交额",
                            modifier = Modifier.weight(1f),
                        )
                        Text(
                            formatMoney(grossUsd, state.displayCurrency),
                            fontWeight = FontWeight.Bold,
                        )
                    }
                    Row {
                        Text("预计手续费", modifier = Modifier.weight(1f))
                        Text(formatMoney(feeUsd, state.displayCurrency))
                    }
                    Text(
                        if (sheet.orderMode == UiOrderMode.LIMIT) {
                            "限价单可能立即成交，也可能进入委托列表等待撮合。"
                        } else {
                            "实际成交价与费用以服务端权威结果为准。"
                        },
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.labelSmall,
                    )
                }
            }

            if (sheet.maxLots <= 0) {
                Text(
                    if (sheet.side == UiTradeSide.BUY) {
                        "当前可用资金不足以买入一手。"
                    } else {
                        "当前没有可卖的整手持仓，T+1 待结算数量暂不可卖。"
                    },
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            if (state.tradeError != null) {
                Surface(
                    color = MaterialTheme.colorScheme.errorContainer,
                    shape = MaterialTheme.shapes.medium,
                ) {
                    Text(
                        state.tradeError,
                        modifier = Modifier.padding(11.dp),
                        color = MaterialTheme.colorScheme.onErrorContainer,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }

            Button(
                onClick = onSubmit,
                enabled = sheet.lots in 1..sheet.maxLots &&
                    (sheet.orderMode != UiOrderMode.LIMIT || limitPrice != null) &&
                    !state.tradeBusy,
                modifier = Modifier.fillMaxWidth(),
                colors = androidx.compose.material3.ButtonDefaults.buttonColors(
                    containerColor = sideColor,
                ),
            ) {
                Text(
                    if (state.tradeBusy) {
                        "正在提交…"
                    } else {
                        "确认${if (sheet.side == UiTradeSide.BUY) "买入" else "卖出"} " +
                            "$quantity 股 · ${sheet.orderMode.label}"
                    },
                )
            }
            Text(
                "幂等请求 ${sheet.idempotencyKey.take(8)}… · 重试不会重复成交",
                modifier = Modifier.fillMaxWidth(),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.labelSmall,
            )
            Spacer(Modifier.height(2.dp))
        }
    }
}
