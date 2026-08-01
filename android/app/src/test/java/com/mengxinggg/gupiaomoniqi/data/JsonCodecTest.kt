package com.mengxinggg.gupiaomoniqi.data

import com.mengxinggg.gupiaomoniqi.model.CandleSource
import com.mengxinggg.gupiaomoniqi.model.ChartRange
import com.mengxinggg.gupiaomoniqi.model.ChartSource
import com.mengxinggg.gupiaomoniqi.model.Currency
import com.mengxinggg.gupiaomoniqi.model.Market
import com.mengxinggg.gupiaomoniqi.model.MarketMode
import com.mengxinggg.gupiaomoniqi.model.LimitOrderStatus
import com.mengxinggg.gupiaomoniqi.model.OrderMode
import com.mengxinggg.gupiaomoniqi.model.RewardClaimState
import com.mengxinggg.gupiaomoniqi.model.RewardKind
import com.mengxinggg.gupiaomoniqi.model.TradeSide
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class JsonCodecTest {
    @Test
    fun `parses open limit order with frozen funds and nullable fill fields`() {
        val order = JsonCodec.limitOrder(JSONObject(openLimitOrderJson()))

        assertEquals(OrderMode.LIMIT, order.orderMode)
        assertEquals(LimitOrderStatus.OPEN, order.status)
        assertEquals(205.5, order.limitPrice!!, 0.0001)
        assertEquals(4_111.23, order.reservedCashUsd, 0.0001)
        assertNull(order.filledAt)
        assertNull(order.transactionId)
    }

    @Test
    fun `parses available Android app update with release metadata`() {
        val update = JsonCodec.androidUpdateCheck(
            JSONObject(
                """
                {
                  "platform": "ANDROID",
                  "currentVersionCode": 2,
                  "updateAvailable": true,
                  "release": {
                    "packageName": "com.mengxinggg.gupiaomoniqi",
                    "versionCode": 3,
                    "versionName": "0.3.0",
                    "apkPath": "/api/android/update/apk",
                    "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                    "sizeBytes": 12345678,
                    "publishedAt": "2026-07-30T02:00:00.000Z",
                    "mandatory": false,
                    "releaseNotes": "新增应用内更新"
                  }
                }
                """.trimIndent(),
            ),
        )

        assertEquals(2L, update.currentVersionCode)
        assertTrue(update.updateAvailable)
        val release = update.release!!
        assertEquals("com.mengxinggg.gupiaomoniqi", release.packageName)
        assertEquals(3L, release.versionCode)
        assertEquals("0.3.0", release.versionName)
        assertEquals("/api/android/update/apk", release.apkPath)
        assertEquals(12_345_678L, release.sizeBytes)
        assertFalse(release.mandatory)
        assertEquals("新增应用内更新", release.releaseNotes)
    }

    @Test
    fun `parses Android app update response without a newer release`() {
        val update = JsonCodec.androidUpdateCheck(
            JSONObject(
                """
                {
                  "platform": "ANDROID",
                  "currentVersionCode": 2,
                  "updateAvailable": false,
                  "release": null
                }
                """.trimIndent(),
            ),
        )

        assertEquals(2L, update.currentVersionCode)
        assertFalse(update.updateAvailable)
        assertNull(update.release)
    }

    @Test
    fun `parses paginated market data and optional quote values`() {
        val page = JsonCodec.marketPage(
            JSONObject(
                """
                {
                  "items": [${TestJson.marketItem}],
                  "total": 101,
                  "page": 2,
                  "pageSize": 20
                }
                """.trimIndent(),
            ),
        )

        assertEquals(101, page.total)
        assertEquals(2, page.page)
        assertEquals(Market.US, page.items.single().instrument.market)
        assertEquals(Currency.USD, page.items.single().quote.quoteCurrency)
        assertEquals(12_345_678L, page.items.single().quote.volume)
        assertNull(page.items.single().quote.receivedAt)
    }

    @Test
    fun `parses account portfolio and transaction shapes`() {
        val account = JsonCodec.publicAccount(JSONObject(TestJson.account))
        val portfolio = JsonCodec.portfolio(JSONObject(TestJson.portfolio))
        val transaction = JsonCodec.transaction(
            JSONObject(TestJson.transaction),
        )

        assertEquals("trader_1", account.username)
        assertEquals(Currency.CNY, account.displayCurrency)
        assertEquals(MarketMode.REAL, portfolio.mode)
        assertEquals(12, portfolio.positions.single().quantity)
        assertEquals(97_661.28, portfolio.totalAssetsUsd, 0.0001)
        assertEquals(TradeSide.BUY, transaction.side)
        assertNull(transaction.realizedProfitUsd)
        assertEquals("trade-key-0001", transaction.idempotencyKey)
    }

    @Test
    fun `parses chart order book watchlist and reward variants`() {
        val chart = JsonCodec.chartSeries(
            JSONObject(
                """
                {
                  "instrumentId": "us-aapl",
                  "range": "DAY",
                  "mode": "REAL",
                  "source": "REAL_MARKET_RECORDED",
                  "candles": [{
                    "time": "2026-07-30T01:00:00.000Z",
                    "open": 210,
                    "high": 214,
                    "low": 209,
                    "close": 213.44,
                    "volume": 12345,
                    "averagePrice": 212.1,
                    "source": "REAL_PROVIDER_HISTORY",
                    "isPartial": false
                  }],
                  "coverageStart": null,
                  "updatedAt": "2026-07-30T01:03:00.000Z",
                  "referencePrice": 210,
                  "complete": true,
                  "notice": null
                }
                """.trimIndent(),
            ),
        )
        val orderBook = JsonCodec.orderBook(
            JSONObject(
                """
                {
                  "instrumentId": "us-aapl",
                  "quoteCurrency": "USD",
                  "mode": "REAL",
                  "asks": [{"price": 213.5, "quantity": 1200, "orderCount": 4}],
                  "bids": [{"price": 213.4, "quantity": 800, "orderCount": 2}],
                  "updatedAt": "2026-07-30T01:03:00.000Z",
                  "available": true,
                  "notice": null
                }
                """.trimIndent(),
            ),
        )
        val watchlist = JsonCodec.watchlist(
            JSONObject(
                """
                {
                  "mode": "REAL",
                  "items": [{
                    "mode": "REAL",
                    "instrumentId": "us-aapl",
                    "createdAt": "2026-07-30T01:04:00.000Z",
                    "marketItem": ${TestJson.marketItem}
                  }, {
                    "mode": "REAL",
                    "instrumentId": "missing",
                    "createdAt": "2026-07-30T01:05:00.000Z",
                    "marketItem": null
                  }],
                  "instrumentIds": ["us-aapl", "missing"],
                  "limit": 100
                }
                """.trimIndent(),
            ),
        )
        val reward = JsonCodec.rewardClaim(
            JSONObject(
                """
                {
                  "claimId": "claim-1",
                  "kind": "CHECK_IN",
                  "mode": "REAL",
                  "amountUsd": 100,
                  "state": "COMPLETED",
                  "claimedAt": "2026-07-30T01:06:00.000Z",
                  "portfolio": ${TestJson.portfolio}
                }
                """.trimIndent(),
            ),
        )

        assertEquals(ChartRange.DAY, chart.range)
        assertEquals(ChartSource.REAL_MARKET_RECORDED, chart.source)
        assertEquals(
            CandleSource.REAL_PROVIDER_HISTORY,
            chart.candles.single().source,
        )
        assertFalse(chart.candles.single().isPartial)
        assertEquals(212.1, chart.candles.single().averagePrice!!, 0.0001)
        assertNull(chart.coverageStart)
        assertEquals(1_200L, orderBook.asks.single().quantity)
        assertTrue(orderBook.available == true)
        assertEquals(2, watchlist.items.size)
        assertNull(watchlist.items.last().marketItem)
        assertEquals(RewardKind.CHECK_IN, reward.kind)
        assertEquals(RewardClaimState.COMPLETED, reward.state)
    }

    @Test
    fun `parses unclaimed check in status with nullable mode`() {
        val status = JsonCodec.checkInStatus(
            JSONObject(
                """
                {
                  "date": "2026-07-30",
                  "claimed": false,
                  "claimedAt": null,
                  "mode": null,
                  "rewardUsd": 100
                }
                """.trimIndent(),
            ),
        )

        assertFalse(status.claimed)
        assertNull(status.claimedAt)
        assertNull(status.mode)
    }
}
