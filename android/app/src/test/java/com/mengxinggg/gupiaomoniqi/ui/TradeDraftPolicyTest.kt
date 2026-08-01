package com.mengxinggg.gupiaomoniqi.ui

import com.mengxinggg.gupiaomoniqi.model.Currency
import com.mengxinggg.gupiaomoniqi.model.Instrument
import com.mengxinggg.gupiaomoniqi.model.InstrumentType
import com.mengxinggg.gupiaomoniqi.model.Market
import com.mengxinggg.gupiaomoniqi.model.MarketItem
import com.mengxinggg.gupiaomoniqi.model.Quote
import com.mengxinggg.gupiaomoniqi.model.SettlementCycle
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TradeDraftPolicyTest {
    @Test
    fun `mode mapping uses market and symbol instead of the old instrument id`() {
        val us = marketItem(id = "real-us-aapl", market = Market.US, symbol = "AAPL")
        val uk = marketItem(id = "real-uk-aapl", market = Market.UK, symbol = "AAPL")

        assertEquals(
            "real-us-aapl",
            findModeMappedInstrument(listOf(uk, us), "US", "aapl")?.instrument?.id,
        )
        assertNull(findModeMappedInstrument(listOf(uk), "US", "AAPL"))
    }

    @Test
    fun `buy percentage never forces one lot beyond the percentage budget`() {
        val sheet = marketBuySheet(price = 80.0)
            .recalculateForPortfolio(portfolio(cashUsd = 100.0), keyFactory("open"))
        assertEquals(1, sheet.maxLots)

        val quarter = sheet.selectPercentage(
            percent = 25,
            portfolio = portfolio(cashUsd = 100.0),
            keyFactory = keyFactory("quarter"),
        )

        assertEquals(0, quarter.lots)
        assertEquals("quarter", quarter.idempotencyKey)
    }

    @Test
    fun `cny limit input converts back to the stock quote currency`() {
        val marketSheet = marketBuySheet(price = 100.0).copy(
            limitPriceCurrency = UiDisplayCurrency.CNY,
        )
        val limitSheet = marketSheet.changeOrderMode(
            mode = UiOrderMode.LIMIT,
            portfolio = portfolio(cashUsd = 10_000.0),
            keyFactory = keyFactory("limit-mode"),
        ).changeLimitPrice(
            raw = "714",
            portfolio = portfolio(cashUsd = 10_000.0),
            keyFactory = keyFactory("limit-price"),
        )

        assertEquals(714.0, limitSheet.limitPriceDisplayOrNull()!!, 0.000001)
        assertEquals(102.0, limitSheet.limitPriceUsdOrNull()!!, 0.000001)
        assertEquals(102.0, limitSheet.limitPriceQuoteOrNull()!!, 0.000001)
    }

    @Test
    fun `payload edits refresh idempotency while identical retry keeps it`() {
        val original = marketBuySheet(price = 10.0).copy(
            maxLots = 10,
            lots = 1,
            idempotencyKey = "attempt-1",
        )
        val changed = original.changeLots(2, keyFactory("attempt-2"))
        val identicalRetry = changed.changeLots(2, keyFactory("must-not-be-used"))

        assertEquals("attempt-2", changed.idempotencyKey)
        assertEquals("attempt-2", identicalRetry.idempotencyKey)

        val limit = changed.changeOrderMode(
            UiOrderMode.LIMIT,
            portfolio(cashUsd = 1_000.0),
            keyFactory("attempt-3"),
        )
        assertNotEquals(changed.idempotencyKey, limit.idempotencyKey)
        val converted = limit.convertLimitDisplayCurrency(UiDisplayCurrency.CNY)
        assertEquals(limit.idempotencyKey, converted.idempotencyKey)
        assertEquals(limit.limitPriceQuoteOrNull()!!, converted.limitPriceQuoteOrNull()!!, 0.000001)
    }

    @Test
    fun `latest quote and assets recalculate an open trade sheet`() {
        val original = marketBuySheet(price = 10.0).copy(
            maxLots = 99,
            lots = 10,
            idempotencyKey = "before-refresh",
        )
        val refreshed = original.withLatestMarketData(
            stock = stock(price = 20.0),
            portfolio = portfolio(cashUsd = 100.0),
            keyFactory = keyFactory("after-refresh"),
        )

        assertEquals(20.0, refreshed.stock.currentPrice, 0.000001)
        assertEquals(4, refreshed.maxLots)
        assertEquals(4, refreshed.lots)
        assertEquals("after-refresh", refreshed.idempotencyKey)
    }

    private fun marketBuySheet(price: Double): TradeSheetUi = TradeSheetUi(
        stock = stock(price),
        side = UiTradeSide.BUY,
        limitPriceCurrency = UiDisplayCurrency.USD,
        idempotencyKey = "initial",
    )

    private fun stock(price: Double): StockUi = StockUi(
        id = "virtual-us-aapl",
        symbol = "AAPL",
        name = "Apple",
        market = "US",
        industry = "Technology",
        quoteCurrency = "USD",
        currentPrice = price,
        previousClose = price,
        openPrice = price,
        highPrice = price,
        lowPrice = price,
        volume = 1_000.0,
        changeAmount = 0.0,
        changePercent = 0.0,
        lotSize = 1,
        settlementCycle = "T0",
        tradable = true,
        updatedAt = "2026-08-01T00:00:00.000Z",
    )

    private fun portfolio(cashUsd: Double): PortfolioUi = PortfolioUi(
        availableCashUsd = cashUsd,
        frozenCashUsd = 0.0,
        positionsValueUsd = 0.0,
        totalAssetsUsd = cashUsd,
        realizedProfitUsd = 0.0,
        unrealizedProfitUsd = 0.0,
        totalProfitLossUsd = 0.0,
        positions = emptyList(),
    )

    private fun marketItem(
        id: String,
        market: Market,
        symbol: String,
    ): MarketItem = MarketItem(
        instrument = Instrument(
            id = id,
            symbol = symbol,
            name = symbol,
            market = market,
            sourceCurrency = Currency.USD,
            quoteCurrency = Currency.USD,
            type = InstrumentType.STOCK_REAL,
            industry = "",
            isTradable = true,
            lotSize = 1,
            settlementCycle = SettlementCycle.T0,
        ),
        quote = Quote(
            instrumentId = id,
            symbol = symbol,
            market = market,
            quoteCurrency = Currency.USD,
            currentPrice = 100.0,
            previousClose = 100.0,
            openPrice = 100.0,
            highPrice = 100.0,
            lowPrice = 100.0,
            volume = 1_000,
            changeAmount = 0.0,
            changePercent = 0.0,
            updatedAt = "2026-08-01T00:00:00.000Z",
        ),
    )

    private fun keyFactory(value: String): () -> String = { value }
}
