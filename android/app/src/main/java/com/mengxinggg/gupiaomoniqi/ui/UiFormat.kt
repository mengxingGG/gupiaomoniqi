package com.mengxinggg.gupiaomoniqi.ui

import java.util.Locale
import kotlin.math.abs

internal fun formatMoney(
    amountUsd: Double,
    currency: UiDisplayCurrency,
    signed: Boolean = false,
): String {
    val amount = amountUsd.asDisplayMoney(currency)
    val prefix = when {
        signed && amount > 0 -> "+"
        else -> ""
    }
    return "$prefix${currency.symbol}${String.format(Locale.US, "%,.2f", amount)}"
}

internal fun formatQuoteMoney(
    stock: StockUi,
    amount: Double,
    currency: UiDisplayCurrency,
    signed: Boolean = false,
): String {
    val displayed = stock.displayPrice(amount, currency)
    val prefix = if (signed && displayed > 0) "+" else ""
    return "$prefix${currency.symbol}${String.format(Locale.US, "%,.2f", displayed)}"
}

internal fun formatPercent(value: Double): String =
    "${if (value > 0) "+" else ""}${String.format(Locale.US, "%.2f", value)}%"

internal fun formatCompactNumber(value: Double): String {
    val absolute = abs(value)
    return when {
        absolute >= 100_000_000 -> String.format(Locale.US, "%.2f亿", value / 100_000_000)
        absolute >= 10_000 -> String.format(Locale.US, "%.2f万", value / 10_000)
        else -> String.format(Locale.US, "%,.0f", value)
    }
}

internal fun formatQuantity(value: Double): String =
    if (value % 1.0 == 0.0) {
        String.format(Locale.US, "%,.0f", value)
    } else {
        String.format(Locale.US, "%,.2f", value)
    }

internal fun formatTime(value: String): String {
    if (value.isBlank()) return "—"
    return value
        .replace("T", " ")
        .replace("Z", "")
        .take(16)
}

internal fun marketLabel(value: String): String = when (value) {
    "CN" -> "沪深"
    "HK" -> "港股"
    "US" -> "美股"
    "UK" -> "英股"
    else -> value
}

internal fun modeLabel(mode: UiMarketMode): String = when (mode) {
    UiMarketMode.VIRTUAL -> "虚拟市场"
    UiMarketMode.REAL -> "真实行情"
}
