package com.mengxinggg.gupiaomoniqi.data

import com.mengxinggg.gupiaomoniqi.model.Market
import com.mengxinggg.gupiaomoniqi.model.MarketMode
import com.mengxinggg.gupiaomoniqi.model.MarketQuery
import com.mengxinggg.gupiaomoniqi.model.LimitOrderStatus
import com.mengxinggg.gupiaomoniqi.model.OrderMode
import com.mengxinggg.gupiaomoniqi.model.TradeRequest
import com.mengxinggg.gupiaomoniqi.model.TradeSide
import java.io.IOException
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

private const val TEST_BASE_URL = "http://10.0.2.2:3100"

class ApiClientContractTest {
    @Test
    fun `limit order submission sends price and idempotency key to global order endpoint`() {
        lateinit var recorded: HttpRequest
        val client = ApiClient(
            InMemoryTokenStore("token", TEST_BASE_URL),
        ) { request ->
            recorded = request
            HttpResponse(
                200,
                """{"data":{"order":${openLimitOrderJson()},"transaction":null,"portfolio":${TestJson.portfolio}}}""",
            )
        }

        val result = client.submitOrder(
            MarketMode.REAL,
            TradeRequest(
                instrumentId = "us-aapl",
                side = TradeSide.BUY,
                quantity = 20,
                orderMode = OrderMode.LIMIT,
                limitPrice = 205.5,
                idempotencyKey = "order-attempt-1",
            ),
        )

        assertEquals("POST", recorded.method)
        assertEquals("$TEST_BASE_URL/api/orders", recorded.url)
        assertEquals("Bearer token", recorded.headers["Authorization"])
        val body = JSONObject(recorded.body!!)
        assertEquals("REAL", body.getString("mode"))
        assertEquals("LIMIT", body.getString("orderMode"))
        assertEquals(205.5, body.getDouble("limitPrice"), 0.0001)
        assertEquals("order-attempt-1", body.getString("idempotencyKey"))
        assertEquals(LimitOrderStatus.OPEN, result.order.status)
        assertNull(result.transaction)
    }

    @Test
    fun `order list filter and cancellation use mode query parameters`() {
        val requests = mutableListOf<HttpRequest>()
        val client = ApiClient(
            InMemoryTokenStore("token", TEST_BASE_URL),
        ) { request ->
            requests += request
            if (request.method == "GET") {
                HttpResponse(200, """{"data":[${openLimitOrderJson()}]}""")
            } else {
                val cancelled = openLimitOrderJson()
                    .replace("\"status\":\"OPEN\"", "\"status\":\"CANCELLED\"")
                    .replace("\"cancelledAt\":null", "\"cancelledAt\":\"2026-08-01T02:10:00.000Z\"")
                HttpResponse(
                    200,
                    """{"data":{"order":$cancelled,"portfolio":${TestJson.portfolio}}}""",
                )
            }
        }

        client.orders(MarketMode.REAL, LimitOrderStatus.OPEN)
        val cancellation = client.cancelOrder(MarketMode.REAL, "order/1")

        assertEquals(
            "$TEST_BASE_URL/api/account/orders?mode=REAL&status=OPEN",
            requests[0].url,
        )
        assertEquals("DELETE", requests[1].method)
        assertEquals(
            "$TEST_BASE_URL/api/orders/order%2F1?mode=REAL",
            requests[1].url,
        )
        assertNull(requests[1].body)
        assertEquals(LimitOrderStatus.CANCELLED, cancellation.order.status)
    }

    @Test
    fun `Android update check is public GET with current version code`() {
        lateinit var recorded: HttpRequest
        val client = ApiClient(
            InMemoryTokenStore(
                initialToken = "secret-token",
                initialBaseUrl = TEST_BASE_URL,
            ),
        ) { request ->
            recorded = request
            HttpResponse(
                200,
                """
                    {
                      "data": {
                        "platform": "ANDROID",
                        "currentVersionCode": 2,
                        "updateAvailable": false,
                        "release": null
                      }
                    }
                """.trimIndent(),
            )
        }

        val result = client.androidUpdate(currentVersionCode = 2)

        assertEquals("GET", recorded.method)
        assertEquals(
            "$TEST_BASE_URL/api/android/update?currentVersionCode=2",
            recorded.url,
        )
        assertFalse(recorded.headers.containsKey("Authorization"))
        assertNull(recorded.body)
        assertEquals(2L, result.currentVersionCode)
        assertFalse(result.updateAvailable)
        assertNull(result.release)
    }

    @Test
    fun `server probe validates health without mutating configured session`() {
        lateinit var recorded: HttpRequest
        val store = InMemoryTokenStore(
            initialToken = "existing-token",
            initialBaseUrl = TEST_BASE_URL,
        )
        val client = ApiClient(store) { request ->
            recorded = request
            HttpResponse(200, """{"data":{"status":"ok"}}""")
        }

        client.probeServer("https://stocks.example.test/")

        assertEquals("GET", recorded.method)
        assertEquals(
            "https://stocks.example.test/api/health",
            recorded.url,
        )
        assertFalse(recorded.headers.containsKey("Authorization"))
        assertEquals(TEST_BASE_URL, client.baseUrl)
        assertEquals("existing-token", store.token)
    }

    @Test
    fun `server probe rejects an unrelated healthy website`() {
        val client = ApiClient(
            InMemoryTokenStore(initialBaseUrl = TEST_BASE_URL),
        ) {
            HttpResponse(200, """{"data":{"status":"green"}}""")
        }

        val error = assertThrows(ApiClientException::class.java) {
            client.probeServer("https://example.test")
        }

        assertEquals("INVALID_SERVER", error.code)
        assertEquals(200, error.status)
    }

    @Test
    fun `safe get retries one transient network failure`() {
        var attempts = 0
        val client = ApiClient(
            InMemoryTokenStore(initialBaseUrl = TEST_BASE_URL),
        ) {
            attempts += 1
            if (attempts == 1) {
                throw IOException("connection closed")
            }
            HttpResponse(
                200,
                """{"data":{"items":[],"total":0,"page":1,"pageSize":30}}""",
            )
        }

        client.market(
            MarketQuery(
                mode = MarketMode.VIRTUAL,
                page = 1,
                pageSize = 30,
            ),
        )

        assertEquals(2, attempts)
    }

    @Test
    fun `write request is not retried after a network failure`() {
        var attempts = 0
        val client = ApiClient(
            InMemoryTokenStore(initialBaseUrl = TEST_BASE_URL),
        ) {
            attempts += 1
            throw IOException("connection closed")
        }

        assertThrows(ApiClientException::class.java) {
            client.login("trader_1", "Password1")
        }

        assertEquals(1, attempts)
    }

    @Test
    fun `public market request carries explicit mode without a bearer token`() {
        val requests = mutableListOf<HttpRequest>()
        val store = InMemoryTokenStore(
            initialToken = "secret-token",
            initialBaseUrl = TEST_BASE_URL,
        )
        val client = ApiClient(store) { request ->
            requests += request
            HttpResponse(
                200,
                """{"data":{"items":[],"total":0,"page":3,"pageSize":25}}""",
            )
        }

        client.market(
            MarketQuery(
                mode = MarketMode.REAL,
                market = Market.US,
                search = "Apple & Co",
                page = 3,
                pageSize = 25,
            ),
        )

        val request = requests.single()
        assertEquals("GET", request.method)
        assertEquals(
            "$TEST_BASE_URL/api/market" +
                "?mode=REAL&page=3&pageSize=25&market=US" +
                "&search=Apple%20%26%20Co",
            request.url,
        )
        assertFalse(request.headers.containsKey("Authorization"))
        assertNull(request.body)
    }

    @Test
    fun `watchlist-only market request carries the bearer token`() {
        lateinit var recorded: HttpRequest
        val client = ApiClient(
            InMemoryTokenStore("secret-token", TEST_BASE_URL),
        ) { request ->
            recorded = request
            HttpResponse(
                200,
                """{"data":{"items":[],"total":0,"page":1,"pageSize":30}}""",
            )
        }

        client.market(
            MarketQuery(
                mode = MarketMode.REAL,
                page = 1,
                pageSize = 30,
                watchlistOnly = true,
            ),
        )

        assertEquals("Bearer secret-token", recorded.headers["Authorization"])
        assertTrue(recorded.url.contains("watchlist=true"))
    }

    @Test
    fun `delete watchlist sends the mode in a JSON body`() {
        lateinit var recorded: HttpRequest
        val client = ApiClient(
            InMemoryTokenStore("token", TEST_BASE_URL),
        ) { request ->
            recorded = request
            HttpResponse(
                200,
                """
                    {
                      "data": {
                        "mode": "VIRTUAL",
                        "items": [],
                        "instrumentIds": [],
                        "limit": 100
                      }
                    }
                """.trimIndent(),
            )
        }

        client.removeWatchlist(MarketMode.VIRTUAL, "cn-600000")

        assertEquals("DELETE", recorded.method)
        assertEquals("$TEST_BASE_URL/api/watchlist", recorded.url)
        val body = JSONObject(recorded.body!!)
        assertEquals("VIRTUAL", body.getString("mode"))
        assertEquals("cn-600000", body.getString("instrumentId"))
    }

    @Test
    fun `login stores token without sending an old bearer token`() {
        lateinit var recorded: HttpRequest
        val store = InMemoryTokenStore(
            initialToken = "stale",
            initialBaseUrl = TEST_BASE_URL,
        )
        val client = ApiClient(store) { request ->
            recorded = request
            HttpResponse(
                200,
                """{"data":{"token":"fresh","account":${TestJson.account}}}""",
            )
        }

        client.login("trader_1", "Password1")

        assertFalse(recorded.headers.containsKey("Authorization"))
        assertEquals("fresh", store.token)
    }

    @Test
    fun `unauthorized login does not clear an existing session`() {
        lateinit var recorded: HttpRequest
        val store = InMemoryTokenStore(
            initialToken = "still-valid",
            initialBaseUrl = TEST_BASE_URL,
        )
        val client = ApiClient(store) { request ->
            recorded = request
            HttpResponse(
                401,
                """{"code":"INVALID_CREDENTIALS","message":"Wrong password"}""",
            )
        }

        val error = assertThrows(ApiClientException::class.java) {
            client.login("trader_1", "WrongPassword1")
        }

        assertEquals("INVALID_CREDENTIALS", error.code)
        assertFalse(recorded.headers.containsKey("Authorization"))
        assertEquals("still-valid", store.token)
    }

    @Test
    fun `unauthorized authenticated response clears local token`() {
        val store = InMemoryTokenStore(
            initialToken = "expired",
            initialBaseUrl = TEST_BASE_URL,
        )
        val client = ApiClient(store) {
            HttpResponse(
                401,
                """{"code":"UNAUTHORIZED","message":"Session expired"}""",
            )
        }

        val error = assertThrows(ApiClientException::class.java) {
            client.account(MarketMode.REAL)
        }

        assertEquals("UNAUTHORIZED", error.code)
        assertNull(store.token)
        assertTrue(error.message!!.contains("expired"))
    }

    @Test
    fun `late unauthorized response cannot clear a newer server session`() {
        val store = InMemoryTokenStore(
            initialToken = "old-token",
            initialBaseUrl = TEST_BASE_URL,
        )
        val client = ApiClient(store) {
            store.baseUrl = "https://new.example.test"
            store.token = "new-token"
            HttpResponse(
                401,
                """{"code":"UNAUTHORIZED","message":"Old session expired"}""",
            )
        }

        assertThrows(ApiClientException::class.java) {
            client.account(MarketMode.VIRTUAL)
        }

        assertEquals("https://new.example.test", store.baseUrl)
        assertEquals("new-token", store.token)
    }

    @Test
    fun `late login response from an old server is discarded`() {
        val store = InMemoryTokenStore(
            initialBaseUrl = TEST_BASE_URL,
        )
        val client = ApiClient(store) {
            store.baseUrl = "https://new.example.test"
            HttpResponse(
                200,
                """{"data":{"token":"old-server-token","account":${TestJson.account}}}""",
            )
        }

        val error = assertThrows(ApiClientException::class.java) {
            client.login("trader_1", "Password1")
        }

        assertEquals("REQUEST_SUPERSEDED", error.code)
        assertNull(store.token)
        assertEquals("https://new.example.test", store.baseUrl)
    }

    @Test
    fun `login response is discarded after switching away and back`() {
        lateinit var client: ApiClient
        val store = InMemoryTokenStore(initialBaseUrl = TEST_BASE_URL)
        client = ApiClient(store) {
            client.baseUrl = "https://temporary.example.test"
            client.baseUrl = TEST_BASE_URL
            HttpResponse(
                200,
                """{"data":{"token":"superseded-token","account":${TestJson.account}}}""",
            )
        }

        val error = assertThrows(ApiClientException::class.java) {
            client.login("trader_1", "Password1")
        }

        assertEquals("REQUEST_SUPERSEDED", error.code)
        assertEquals(TEST_BASE_URL, store.baseUrl)
        assertNull(store.token)
    }

    @Test
    fun `late logout response cannot clear a newer server token`() {
        lateinit var client: ApiClient
        lateinit var recorded: HttpRequest
        val store = InMemoryTokenStore(
            initialToken = "old-token",
            initialBaseUrl = TEST_BASE_URL,
        )
        client = ApiClient(store) { request ->
            recorded = request
            client.baseUrl = "https://new.example.test"
            store.token = "new-token"
            HttpResponse(200, """{"data":{"loggedOut":true}}""")
        }

        client.logout()

        assertEquals("$TEST_BASE_URL/api/auth/logout", recorded.url)
        assertEquals("Bearer old-token", recorded.headers["Authorization"])
        assertEquals("https://new.example.test", store.baseUrl)
        assertEquals("new-token", store.token)
    }

    @Test
    fun `gift code preserves case and idempotency key`() {
        lateinit var recorded: HttpRequest
        val client = ApiClient(
            InMemoryTokenStore("token", TEST_BASE_URL),
        ) { request ->
            recorded = request
            HttpResponse(
                200,
                """
                    {
                      "data": {
                        "claimId": "gift-claim-1",
                        "kind": "GIFT_CODE",
                        "mode": "REAL",
                        "amountUsd": 100000,
                        "state": "COMPLETED",
                        "claimedAt": "2026-07-30T01:06:00.000Z",
                        "portfolio": ${TestJson.portfolio}
                      }
                    }
                """.trimIndent(),
            )
        }

        client.redeemGiftCode(
            mode = MarketMode.REAL,
            code = "MiXeD-Code",
            idempotencyKey = "gift-attempt-123",
        )

        val body = JSONObject(recorded.body!!)
        assertEquals("REAL", body.getString("mode"))
        assertEquals("MiXeD-Code", body.getString("code"))
        assertEquals("gift-attempt-123", body.getString("idempotencyKey"))
    }

    @Test
    fun `request fails clearly before transport when server is not configured`() {
        var transportInvoked = false
        val client = ApiClient(InMemoryTokenStore()) {
            transportInvoked = true
            HttpResponse(500, "")
        }

        val error = assertThrows(ApiClientException::class.java) {
            client.account(MarketMode.VIRTUAL)
        }

        assertEquals("SERVER_NOT_CONFIGURED", error.code)
        assertEquals(0, error.status)
        assertEquals("请先设置服务器地址", error.message)
        assertFalse(transportInvoked)
        assertEquals("", client.baseUrl)
    }
}

internal fun openLimitOrderJson(): String =
    """
    {
      "id":"order/1",
      "mode":"REAL",
      "instrumentId":"us-aapl",
      "symbol":"AAPL",
      "name":"苹果",
      "market":"US",
      "side":"BUY",
      "orderMode":"LIMIT",
      "status":"OPEN",
      "quantity":20,
      "filledQuantity":0,
      "limitPrice":205.5,
      "quoteCurrency":"USD",
      "reservedCashUsd":4111.23,
      "reservedQuantity":0,
      "actorType":"USER",
      "createdAt":"2026-08-01T02:00:00.000Z",
      "updatedAt":"2026-08-01T02:00:00.000Z",
      "filledAt":null,
      "cancelledAt":null,
      "transactionId":null
    }
    """.trimIndent()
