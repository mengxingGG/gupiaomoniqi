package com.mengxinggg.gupiaomoniqi.ui

import com.mengxinggg.gupiaomoniqi.model.Currency
import com.mengxinggg.gupiaomoniqi.model.MarketItem
import java.util.UUID
import kotlin.math.floor
import kotlin.math.max

private const val TRADE_FEE_RATE = 0.0003
private const val MINIMUM_TRADE_FEE_USD = 1.0

internal fun maximumAffordableLots(
    budgetUsd: Double,
    grossPerLotUsd: Double,
): Int {
    if (budgetUsd <= 0 || grossPerLotUsd <= 0) return 0
    var lots = floor(budgetUsd / (grossPerLotUsd * (1 + TRADE_FEE_RATE))).toInt()
    while (lots > 0) {
        val gross = grossPerLotUsd * lots
        val fee = max(MINIMUM_TRADE_FEE_USD, gross * TRADE_FEE_RATE)
        if (gross + fee <= budgetUsd) return lots
        lots -= 1
    }
    return 0
}

internal fun StockUi.priceUsd(): Double = quotePriceToUsd(currentPrice)

internal fun StockUi.quotePriceToUsd(quotePrice: Double): Double =
    if (quoteCurrency == Currency.CNY.name) quotePrice / 7.0 else quotePrice

internal fun StockUi.quotePriceToDisplay(
    quotePrice: Double,
    displayCurrency: UiDisplayCurrency,
): Double = quotePriceToUsd(quotePrice).asDisplayMoney(displayCurrency)

internal fun StockUi.displayPriceToQuote(
    displayPrice: Double,
    displayCurrency: UiDisplayCurrency,
): Double {
    val priceUsd = displayPrice.toUsd(displayCurrency)
    return if (quoteCurrency == Currency.CNY.name) priceUsd * 7.0 else priceUsd
}

internal fun Double.toUsd(displayCurrency: UiDisplayCurrency): Double =
    if (displayCurrency == UiDisplayCurrency.CNY) this / 7.0 else this

internal fun TradeSheetUi.limitPriceDisplayOrNull(): Double? =
    if (orderMode == UiOrderMode.LIMIT) {
        limitPriceInput.toDoubleOrNull()?.takeIf { it.isFinite() && it > 0 }
    } else {
        null
    }

internal fun TradeSheetUi.limitPriceUsdOrNull(): Double? =
    limitPriceDisplayOrNull()?.toUsd(limitPriceCurrency)

internal fun TradeSheetUi.limitPriceQuoteOrNull(): Double? =
    limitPriceDisplayOrNull()?.let {
        stock.displayPriceToQuote(it, limitPriceCurrency)
    }

internal fun TradeSheetUi.changeLots(
    requestedLots: Int,
    keyFactory: () -> String = { UUID.randomUUID().toString() },
): TradeSheetUi {
    val nextLots = requestedLots.coerceIn(0, maxLots)
    return if (nextLots == lots) this else copy(
        lots = nextLots,
        idempotencyKey = keyFactory(),
    )
}

internal fun TradeSheetUi.changeOrderMode(
    mode: UiOrderMode,
    portfolio: PortfolioUi?,
    keyFactory: () -> String = { UUID.randomUUID().toString() },
): TradeSheetUi {
    if (mode == orderMode) return this
    val nextKey = keyFactory()
    val candidate = copy(
        orderMode = mode,
        limitPriceInput = if (mode == UiOrderMode.LIMIT && limitPriceInput.isBlank()) {
            stock.quotePriceToDisplay(
                stock.currentPrice,
                limitPriceCurrency,
            ).toEditablePrice()
        } else {
            limitPriceInput
        },
        idempotencyKey = nextKey,
    )
    return candidate.recalculateForPortfolio(portfolio) { nextKey }
}

internal fun TradeSheetUi.changeLimitPrice(
    raw: String,
    portfolio: PortfolioUi?,
    keyFactory: () -> String = { UUID.randomUUID().toString() },
): TradeSheetUi {
    val normalized = raw.normalizeDecimalInput()
    if (normalized == limitPriceInput) return this
    val nextKey = keyFactory()
    return copy(
        limitPriceInput = normalized,
        idempotencyKey = nextKey,
    ).recalculateForPortfolio(portfolio) { nextKey }
}

internal fun TradeSheetUi.selectPercentage(
    percent: Int,
    portfolio: PortfolioUi?,
    keyFactory: () -> String = { UUID.randomUUID().toString() },
): TradeSheetUi {
    val normalizedPercent = percent.coerceIn(0, 100)
    val selectedLots = when (side) {
        UiTradeSide.BUY -> {
            val perLotUsd = effectivePriceUsdOrNull()
                ?.times(stock.lotSize)
                ?: return changeLots(0, keyFactory)
            maximumAffordableLots(
                budgetUsd = (portfolio?.availableCashUsd ?: 0.0) *
                    (normalizedPercent / 100.0),
                grossPerLotUsd = perLotUsd,
            )
        }
        UiTradeSide.SELL -> floor(maxLots * (normalizedPercent / 100.0)).toInt()
    }
    return changeLots(selectedLots, keyFactory)
}

internal fun TradeSheetUi.recalculateForPortfolio(
    portfolio: PortfolioUi?,
    keyFactory: () -> String = { UUID.randomUUID().toString() },
): TradeSheetUi {
    val max = when (side) {
        UiTradeSide.BUY -> effectivePriceUsdOrNull()?.let { priceUsd ->
            maximumAffordableLots(
                budgetUsd = portfolio?.availableCashUsd ?: 0.0,
                grossPerLotUsd = priceUsd * stock.lotSize,
            )
        } ?: 0
        UiTradeSide.SELL -> floor(
            (portfolio?.positions
                ?.firstOrNull { it.instrumentId == stock.id }
                ?.availableQuantity ?: 0.0) / stock.lotSize,
        ).toInt()
    }.coerceAtLeast(0)
    val nextLots = when {
        max <= 0 -> 0
        else -> lots.coerceAtMost(max)
    }
    return copy(
        maxLots = max,
        lots = nextLots,
        idempotencyKey = if (nextLots == lots) idempotencyKey else keyFactory(),
    )
}

internal fun TradeSheetUi.withLatestMarketData(
    stock: StockUi,
    portfolio: PortfolioUi?,
    keyFactory: () -> String = { UUID.randomUUID().toString() },
): TradeSheetUi {
    if (this.stock.id != stock.id) return this
    return copy(stock = stock).recalculateForPortfolio(portfolio, keyFactory)
}

internal fun TradeSheetUi.convertLimitDisplayCurrency(
    currency: UiDisplayCurrency,
): TradeSheetUi {
    if (limitPriceCurrency == currency) return this
    val converted = limitPriceDisplayOrNull()?.let { oldDisplayPrice ->
        val quotePrice = stock.displayPriceToQuote(
            oldDisplayPrice,
            limitPriceCurrency,
        )
        stock.quotePriceToDisplay(quotePrice, currency).toEditablePrice()
    } ?: limitPriceInput
    // 这里只改变显示单位，服务端提交的报价币种价格不变，所以沿用同一幂等键。
    return copy(
        limitPriceInput = converted,
        limitPriceCurrency = currency,
    )
}

internal fun TradeSheetUi.effectivePriceUsdOrNull(): Double? =
    if (orderMode == UiOrderMode.LIMIT) limitPriceUsdOrNull() else stock.priceUsd()

internal fun findModeMappedInstrument(
    items: List<MarketItem>,
    market: String,
    symbol: String,
): MarketItem? = items.firstOrNull {
    it.instrument.market.name.equals(market, ignoreCase = true) &&
        it.instrument.symbol.equals(symbol, ignoreCase = true)
}

internal fun String.normalizeDecimalInput(): String {
    val filtered = filter { it.isDigit() || it == '.' }
    val dot = filtered.indexOf('.')
    val normalized = if (dot < 0) {
        filtered
    } else {
        filtered.take(dot + 1) + filtered.drop(dot + 1).replace(".", "")
    }
    return normalized.take(18)
}

internal fun Double.toEditablePrice(): String =
    toBigDecimal().stripTrailingZeros().toPlainString()
