package com.mengxinggg.gupiaomoniqi.data

import com.mengxinggg.gupiaomoniqi.model.AuthResult
import com.mengxinggg.gupiaomoniqi.model.AndroidUpdateCheck
import com.mengxinggg.gupiaomoniqi.model.ChartRange
import com.mengxinggg.gupiaomoniqi.model.ChartSeries
import com.mengxinggg.gupiaomoniqi.model.Currency
import com.mengxinggg.gupiaomoniqi.model.DailyCheckInStatus
import com.mengxinggg.gupiaomoniqi.model.EmailVerificationRequestResult
import com.mengxinggg.gupiaomoniqi.model.IndustryCount
import com.mengxinggg.gupiaomoniqi.model.MarketItem
import com.mengxinggg.gupiaomoniqi.model.MarketMode
import com.mengxinggg.gupiaomoniqi.model.MarketQuery
import com.mengxinggg.gupiaomoniqi.model.LimitOrder
import com.mengxinggg.gupiaomoniqi.model.LimitOrderStatus
import com.mengxinggg.gupiaomoniqi.model.OrderBook
import com.mengxinggg.gupiaomoniqi.model.OrderCancellationResult
import com.mengxinggg.gupiaomoniqi.model.OrderSubmissionResult
import com.mengxinggg.gupiaomoniqi.model.Page
import com.mengxinggg.gupiaomoniqi.model.Portfolio
import com.mengxinggg.gupiaomoniqi.model.PublicAccount
import com.mengxinggg.gupiaomoniqi.model.PasswordResetConfirmResult
import com.mengxinggg.gupiaomoniqi.model.PasswordResetRequestResult
import com.mengxinggg.gupiaomoniqi.model.RewardClaimResult
import com.mengxinggg.gupiaomoniqi.model.RegistrationEmailVerificationConfirmResult
import com.mengxinggg.gupiaomoniqi.model.TradeRequest
import com.mengxinggg.gupiaomoniqi.model.Transaction
import com.mengxinggg.gupiaomoniqi.model.Watchlist
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.net.URLEncoder
import java.net.URL
import java.nio.charset.StandardCharsets
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

data class HttpRequest(
    val method: String,
    val url: String,
    val headers: Map<String, String>,
    val body: String? = null,
)

data class HttpResponse(
    val status: Int,
    val body: String,
)

private data class ExecutedResponse(
    val response: HttpResponse,
    val authorizedToken: String?,
    val baseUrl: String,
    val configurationGeneration: Long,
)

private data class DecodedObject<T>(
    val value: T,
    val executed: ExecutedResponse,
)

fun interface HttpTransport {
    @Throws(IOException::class)
    fun execute(request: HttpRequest): HttpResponse
}

class UrlConnectionTransport(
    private val connectTimeoutMillis: Int = 15_000,
    private val readTimeoutMillis: Int = 30_000,
) : HttpTransport {
    override fun execute(request: HttpRequest): HttpResponse {
        val connection = URL(request.url).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = request.method
            connection.connectTimeout = connectTimeoutMillis
            connection.readTimeout = readTimeoutMillis
            connection.instanceFollowRedirects = false
            connection.useCaches = false
            request.headers.forEach(connection::setRequestProperty)

            request.body?.let { body ->
                val bytes = body.toByteArray(StandardCharsets.UTF_8)
                connection.doOutput = true
                connection.setFixedLengthStreamingMode(bytes.size)
                connection.outputStream.use { it.write(bytes) }
            }

            val status = connection.responseCode
            val stream = if (status in 200..299) {
                connection.inputStream
            } else {
                connection.errorStream
                    ?: runCatching { connection.inputStream }.getOrNull()
            }
            val body = stream?.bufferedReader(StandardCharsets.UTF_8)
                ?.use { it.readText() }
                .orEmpty()
            return HttpResponse(status, body)
        } finally {
            connection.disconnect()
        }
    }
}

data class ParsedApiError(
    val code: String,
    val message: String,
    val status: Int,
)

class ApiClientException(
    val code: String,
    val status: Int,
    message: String,
    val responseBody: String? = null,
    cause: Throwable? = null,
) : IOException(message, cause)

/**
 * Handles the API's `{ data: T }` success envelope and `{ code, message }`
 * failure object without depending on Android.
 */
object ApiResponseParser {
    fun requireData(response: HttpResponse): Any {
        if (response.status !in 200..299) {
            throw parseException(response.status, response.body)
        }

        val root = try {
            JSONObject(response.body)
        } catch (error: JSONException) {
            throw invalidResponse(
                response.status,
                response.body,
                "Response is not a JSON object",
                error,
            )
        }
        if (!root.has("data") || root.isNull("data")) {
            throw invalidResponse(
                response.status,
                response.body,
                "Response does not contain data",
            )
        }
        return root.get("data")
    }

    fun parseError(status: Int, body: String): ParsedApiError {
        val root = runCatching { JSONObject(body) }.getOrNull()
        val nested = root?.optJSONObject("error")
        val source = nested ?: root
        val code = source?.optString("code")
            ?.takeIf(String::isNotBlank)
            ?: "HTTP_$status"
        val message = source?.optString("message")
            ?.takeIf(String::isNotBlank)
            ?: "Request failed (HTTP $status)"
        return ParsedApiError(code, message, status)
    }

    fun parseException(status: Int, body: String): ApiClientException {
        val error = parseError(status, body)
        return ApiClientException(
            code = error.code,
            status = status,
            message = error.message,
            responseBody = body,
        )
    }

    fun invalidResponse(
        status: Int,
        body: String,
        detail: String,
        cause: Throwable? = null,
    ): ApiClientException = ApiClientException(
        code = "INVALID_RESPONSE",
        status = status,
        message = detail,
        responseBody = body,
        cause = cause,
    )
}

object ApiUrl {
    fun normalizeOptionalBaseUrl(value: String): String {
        if (value.isBlank()) {
            return ""
        }
        return normalizeBaseUrl(value)
    }

    fun normalizeBaseUrl(value: String): String {
        val trimmed = value.trim()
        require(trimmed.isNotEmpty()) { "baseUrl must not be blank" }
        val withScheme = if ("://" in trimmed) {
            trimmed
        } else {
            "http://$trimmed"
        }
        val uri = runCatching { URI(withScheme) }
            .getOrElse { throw IllegalArgumentException("Invalid baseUrl", it) }
        require(uri.scheme.equals("http", ignoreCase = true) ||
            uri.scheme.equals("https", ignoreCase = true)
        ) {
            "baseUrl must use http or https"
        }
        require(!uri.host.isNullOrBlank()) { "baseUrl must include a host" }
        require(uri.userInfo == null) { "baseUrl must not include credentials" }
        require(uri.rawQuery == null && uri.rawFragment == null) {
            "baseUrl must not include a query or fragment"
        }
        return withScheme.trimEnd('/')
    }

    fun build(
        baseUrl: String,
        path: String,
        query: Map<String, String> = emptyMap(),
    ): String {
        require(path.startsWith('/')) { "API path must start with /" }
        val normalized = normalizeBaseUrl(baseUrl)
        if (query.isEmpty()) {
            return normalized + path
        }
        return normalized + path + "?" + query.entries.joinToString("&") {
            "${encodeQuery(it.key)}=${encodeQuery(it.value)}"
        }
    }

    fun encodePathSegment(value: String): String = encodeQuery(value)

    private fun encodeQuery(value: String): String =
        URLEncoder.encode(value, StandardCharsets.UTF_8.name())
            .replace("+", "%20")
}

/**
 * Blocking HTTP client. [DefaultStockRepository] moves calls to Dispatchers.IO;
 * keeping this layer synchronous makes its transport deterministic in JVM tests.
 */
class ApiClient(
    private val tokenStore: TokenStore,
    private val transport: HttpTransport = UrlConnectionTransport(),
) {
    private val settingsLock = Any()
    private var configurationGeneration = 0L

    var baseUrl: String
        get() = synchronized(settingsLock) { tokenStore.baseUrl }
        set(value) {
            synchronized(settingsLock) {
                val previous = tokenStore.baseUrl
                tokenStore.baseUrl = value
                if (tokenStore.baseUrl != previous) {
                    configurationGeneration += 1
                }
            }
        }

    val hasSession: Boolean
        get() = synchronized(settingsLock) {
            !tokenStore.token.isNullOrBlank()
        }

    fun clearSession() = synchronized(settingsLock) {
        tokenStore.clearToken()
        configurationGeneration += 1
    }

    fun probeServer(candidateBaseUrl: String) {
        val normalizedBaseUrl = ApiUrl.normalizeBaseUrl(candidateBaseUrl)
        val response = executeTransport(
            HttpRequest(
                method = "GET",
                url = ApiUrl.build(normalizedBaseUrl, "/api/health"),
                headers = mapOf("Accept" to "application/json"),
            ),
        )
        val data = try {
            ApiResponseParser.requireData(response)
        } catch (error: ApiClientException) {
            throw error
        }
        val status = (data as? JSONObject)?.optString("status")
        if (status != "ok") {
            throw ApiClientException(
                code = "INVALID_SERVER",
                status = response.status,
                message = "目标地址不是可用的股票模拟器服务器",
                responseBody = response.body,
            )
        }
    }

    fun androidUpdate(currentVersionCode: Long): AndroidUpdateCheck =
        requestObject(
            path = "/api/android/update",
            query = mapOf(
                "currentVersionCode" to currentVersionCode.toString(),
            ),
            includeAuth = false,
            decode = JsonCodec::androidUpdateCheck,
        )

    fun register(
        username: String,
        email: String,
        password: String,
        displayName: String,
        emailVerificationToken: String,
    ): AuthResult {
        val body = JSONObject()
            .put("username", username)
            .put("email", email)
            .put("password", password)
            .put("displayName", displayName)
            .put("emailVerificationToken", emailVerificationToken)
        val decoded = requestObjectWithExecution(
            method = "POST",
            path = "/api/auth/register",
            body = body,
            includeAuth = false,
            decode = JsonCodec::authResult,
        )
        return storeAuthResult(decoded)
    }

    fun login(username: String, password: String): AuthResult {
        val body = JSONObject()
            .put("username", username)
            .put("password", password)
        val decoded = requestObjectWithExecution(
            method = "POST",
            path = "/api/auth/login",
            body = body,
            includeAuth = false,
            decode = JsonCodec::authResult,
        )
        return storeAuthResult(decoded)
    }

    fun requestPasswordReset(email: String): PasswordResetRequestResult =
        requestObject(
            method = "POST",
            path = "/api/auth/password-reset/request",
            body = JSONObject().put("email", email),
            includeAuth = false,
            decode = JsonCodec::passwordResetRequest,
        )

    fun confirmPasswordReset(
        email: String,
        code: String,
        newPassword: String,
    ): PasswordResetConfirmResult = requestObject(
        method = "POST",
        path = "/api/auth/password-reset/confirm",
        body = JSONObject()
            .put("email", email)
            .put("code", code)
            .put("newPassword", newPassword),
        includeAuth = false,
        decode = JsonCodec::passwordResetConfirm,
    )

    fun requestEmailVerification(
        email: String,
    ): EmailVerificationRequestResult = requestObject(
        method = "POST",
        path = "/api/account/email-verification/request",
        body = JSONObject().put("email", email),
        decode = JsonCodec::emailVerificationRequest,
    )

    fun confirmEmailVerification(
        email: String,
        code: String,
    ): PublicAccount = requestObject(
        method = "POST",
        path = "/api/account/email-verification/confirm",
        body = JSONObject()
            .put("email", email)
            .put("code", code),
        decode = JsonCodec::publicAccount,
    )

    fun requestRegistrationEmailVerification(
        email: String,
    ): EmailVerificationRequestResult = requestObject(
        method = "POST",
        path = "/api/account/email-verification/request",
        body = JSONObject()
            .put("email", email)
            .put("purpose", "REGISTRATION"),
        includeAuth = false,
        decode = JsonCodec::emailVerificationRequest,
    )

    fun confirmRegistrationEmailVerification(
        email: String,
        code: String,
    ): RegistrationEmailVerificationConfirmResult = requestObject(
        method = "POST",
        path = "/api/account/email-verification/confirm",
        body = JSONObject()
            .put("email", email)
            .put("code", code)
            .put("purpose", "REGISTRATION"),
        includeAuth = false,
        decode = JsonCodec::registrationEmailVerificationConfirm,
    )

    fun me(): PublicAccount = requestObject(
        path = "/api/auth/me",
        decode = JsonCodec::publicAccount,
    )

    fun logout() {
        val request = synchronized(settingsLock) {
            val configuredBaseUrl = tokenStore.baseUrl
            val authorizedToken = tokenStore.token?.takeIf(String::isNotBlank)
            val headers = linkedMapOf("Accept" to "application/json")
            if (authorizedToken != null) {
                headers["Authorization"] = "Bearer $authorizedToken"
            }
            tokenStore.clearToken()
            configurationGeneration += 1
            if (configuredBaseUrl.isBlank()) {
                null
            } else {
                HttpRequest(
                    method = "POST",
                    url = ApiUrl.build(configuredBaseUrl, "/api/auth/logout"),
                    headers = headers,
                )
            }
        }
        if (request == null) return
        val response = executeTransport(request)
        ApiResponseParser.requireData(response)
    }

    fun updateDisplayCurrency(currency: Currency): PublicAccount {
        require(currency == Currency.CNY || currency == Currency.USD) {
            "Display currency must be CNY or USD"
        }
        return requestObject(
            method = "PUT",
            path = "/api/account/display-currency",
            body = JSONObject().put("currency", currency.name),
            decode = JsonCodec::publicAccount,
        )
    }

    fun market(query: MarketQuery): Page<MarketItem> {
        val params = linkedMapOf(
            "mode" to query.mode.name,
            "page" to query.page.toString(),
            "pageSize" to query.pageSize.toString(),
        )
        query.market?.let { params["market"] = it.name }
        query.industry?.trim()?.takeIf(String::isNotEmpty)?.let {
            params["industry"] = it
        }
        query.search?.trim()?.takeIf(String::isNotEmpty)?.let {
            params["search"] = it
        }
        if (query.watchlistOnly) {
            params["watchlist"] = "true"
        }
        if (query.sortBy.name != "DEFAULT") {
            params["sortBy"] = query.sortBy.name
            params["sortOrder"] = query.sortOrder.name
        }
        return requestObject(
            path = "/api/market",
            query = params,
            includeAuth = query.watchlistOnly,
            decode = JsonCodec::marketPage,
        )
    }

    fun industries(
        mode: MarketMode,
        market: com.mengxinggg.gupiaomoniqi.model.Market?,
    ): List<IndustryCount> {
        val query = linkedMapOf("mode" to mode.name)
        market?.let { query["market"] = it.name }
        return requestArray(
            path = "/api/industries",
            query = query,
            includeAuth = false,
            decode = JsonCodec::industryCounts,
        )
    }

    fun instrument(
        instrumentId: String,
        mode: MarketMode,
    ): MarketItem = requestObject(
        path = "/api/instruments/${ApiUrl.encodePathSegment(instrumentId)}",
        query = mapOf("mode" to mode.name),
        includeAuth = false,
        decode = JsonCodec::marketItem,
    )

    fun chart(
        instrumentId: String,
        range: ChartRange,
        mode: MarketMode,
    ): ChartSeries = requestObject(
        path = "/api/instruments/${ApiUrl.encodePathSegment(instrumentId)}/chart",
        query = linkedMapOf(
            "range" to range.name,
            "mode" to mode.name,
        ),
        includeAuth = false,
        decode = JsonCodec::chartSeries,
    )

    fun orderBook(
        instrumentId: String,
        mode: MarketMode,
    ): OrderBook = requestObject(
        path = "/api/instruments/${ApiUrl.encodePathSegment(instrumentId)}/order-book",
        query = mapOf("mode" to mode.name),
        includeAuth = false,
        decode = JsonCodec::orderBook,
    )

    fun account(mode: MarketMode): Portfolio = requestObject(
        path = "/api/account",
        query = mapOf("mode" to mode.name),
        decode = JsonCodec::portfolio,
    )

    fun transactions(mode: MarketMode): List<Transaction> = requestArray(
        path = "/api/account/transactions",
        query = mapOf("mode" to mode.name),
        decode = JsonCodec::transactions,
    )

    fun submitOrder(
        mode: MarketMode,
        trade: TradeRequest,
    ): OrderSubmissionResult {
        val body = JSONObject()
            .put("mode", mode.name)
            .put("instrumentId", trade.instrumentId)
            .put("side", trade.side.name)
            .put("quantity", trade.quantity)
            .put("orderMode", trade.orderMode.name)
        trade.limitPrice?.let {
            body.put("limitPrice", it)
        }
        trade.idempotencyKey?.let {
            body.put("idempotencyKey", it)
        }
        return requestObject(
            method = "POST",
            path = "/api/orders",
            body = body,
            decode = JsonCodec::orderSubmissionResult,
        )
    }

    fun orders(
        mode: MarketMode,
        status: LimitOrderStatus? = null,
    ): List<LimitOrder> {
        val query = linkedMapOf("mode" to mode.name)
        status?.let { query["status"] = it.name }
        return requestArray(
            path = "/api/account/orders",
            query = query,
            decode = JsonCodec::limitOrders,
        )
    }

    fun cancelOrder(
        mode: MarketMode,
        orderId: String,
    ): OrderCancellationResult = requestObject(
        method = "DELETE",
        path = "/api/orders/${ApiUrl.encodePathSegment(orderId)}",
        query = mapOf("mode" to mode.name),
        decode = JsonCodec::orderCancellationResult,
    )

    fun watchlist(mode: MarketMode): Watchlist = requestObject(
        path = "/api/watchlist",
        query = mapOf("mode" to mode.name),
        decode = JsonCodec::watchlist,
    )

    fun addWatchlist(
        mode: MarketMode,
        instrumentId: String,
    ): Watchlist = mutateWatchlist("POST", mode, instrumentId)

    fun removeWatchlist(
        mode: MarketMode,
        instrumentId: String,
    ): Watchlist = mutateWatchlist("DELETE", mode, instrumentId)

    fun checkInStatus(): DailyCheckInStatus = requestObject(
        path = "/api/rewards/check-in",
        decode = JsonCodec::checkInStatus,
    )

    fun claimCheckIn(mode: MarketMode): RewardClaimResult = requestObject(
        method = "POST",
        path = "/api/rewards/check-in",
        body = JSONObject().put("mode", mode.name),
        decode = JsonCodec::rewardClaim,
    )

    fun redeemGiftCode(
        mode: MarketMode,
        code: String,
        idempotencyKey: String,
    ): RewardClaimResult = requestObject(
        method = "POST",
        path = "/api/rewards/gift-code",
        body = JSONObject()
            .put("mode", mode.name)
            .put("code", code)
            .put("idempotencyKey", idempotencyKey),
        decode = JsonCodec::rewardClaim,
    )

    private fun mutateWatchlist(
        method: String,
        mode: MarketMode,
        instrumentId: String,
    ): Watchlist = requestObject(
        method = method,
        path = "/api/watchlist",
        body = JSONObject()
            .put("mode", mode.name)
            .put("instrumentId", instrumentId),
        decode = JsonCodec::watchlist,
    )

    private fun storeAuthResult(
        decoded: DecodedObject<AuthResult>,
    ): AuthResult = synchronized(settingsLock) {
        if (
            tokenStore.baseUrl != decoded.executed.baseUrl ||
            configurationGeneration !=
            decoded.executed.configurationGeneration
        ) {
            throw ApiClientException(
                code = "REQUEST_SUPERSEDED",
                status = 0,
                message = "服务器已切换，本次登录结果已忽略",
            )
        }
        tokenStore.token = decoded.value.token
        configurationGeneration += 1
        decoded.value
    }

    private fun <T> requestObject(
        path: String,
        method: String = "GET",
        query: Map<String, String> = emptyMap(),
        body: JSONObject? = null,
        includeAuth: Boolean = true,
        decode: (JSONObject) -> T,
    ): T = requestObjectWithExecution(
        path = path,
        method = method,
        query = query,
        body = body,
        includeAuth = includeAuth,
        decode = decode,
    ).value

    private fun <T> requestObjectWithExecution(
        path: String,
        method: String = "GET",
        query: Map<String, String> = emptyMap(),
        body: JSONObject? = null,
        includeAuth: Boolean = true,
        decode: (JSONObject) -> T,
    ): DecodedObject<T> {
        val executed = execute(method, path, query, body, includeAuth)
        val response = executed.response
        val data = requireData(
            executed = executed,
        )
        if (data !is JSONObject) {
            throw ApiResponseParser.invalidResponse(
                response.status,
                response.body,
                "Expected data to be a JSON object",
            )
        }
        return DecodedObject(
            value = decodeSafely(response, data) { decode(it) },
            executed = executed,
        )
    }

    private fun <T> requestArray(
        path: String,
        method: String = "GET",
        query: Map<String, String> = emptyMap(),
        body: JSONObject? = null,
        includeAuth: Boolean = true,
        decode: (JSONArray) -> T,
    ): T {
        val executed = execute(method, path, query, body, includeAuth)
        val response = executed.response
        val data = requireData(
            executed = executed,
        )
        if (data !is JSONArray) {
            throw ApiResponseParser.invalidResponse(
                response.status,
                response.body,
                "Expected data to be a JSON array",
            )
        }
        return decodeSafely(response, data) { decode(it) }
    }

    private fun execute(
        method: String,
        path: String,
        query: Map<String, String>,
        body: JSONObject?,
        includeAuth: Boolean,
    ): ExecutedResponse {
        val requestSettings = synchronized(settingsLock) {
            Triple(
                tokenStore.baseUrl,
                if (includeAuth) {
                    tokenStore.token?.takeIf(String::isNotBlank)
                } else {
                    null
                },
                configurationGeneration,
            )
        }
        val configuredBaseUrl = requestSettings.first
        val authorizedToken = requestSettings.second
        val headers = linkedMapOf("Accept" to "application/json")
        if (body != null) {
            headers["Content-Type"] = "application/json; charset=utf-8"
        }
        if (authorizedToken != null) {
            headers["Authorization"] = "Bearer $authorizedToken"
        }

        if (configuredBaseUrl.isBlank()) {
            throw ApiClientException(
                code = "SERVER_NOT_CONFIGURED",
                status = 0,
                message = "请先设置服务器地址",
            )
        }

        return ExecutedResponse(
            response = executeTransport(
                HttpRequest(
                    method = method,
                    url = ApiUrl.build(configuredBaseUrl, path, query),
                    headers = headers,
                    body = body?.toString(),
                ),
            ),
            authorizedToken = authorizedToken,
            baseUrl = configuredBaseUrl,
            configurationGeneration = requestSettings.third,
        )
    }

    private fun executeTransport(request: HttpRequest): HttpResponse {
        val attempts = if (request.method == "GET") 2 else 1
        var lastNetworkError: IOException? = null

        repeat(attempts) { attempt ->
            try {
                return transport.execute(request)
            } catch (error: ApiClientException) {
                throw error
            } catch (error: IOException) {
                lastNetworkError = error
                if (attempt + 1 < attempts) {
                    Thread.sleep(150)
                }
            }
        }

        val error = lastNetworkError
            ?: IOException("Network request failed")
        throw ApiClientException(
            code = "NETWORK_ERROR",
            status = 0,
            message = error.message ?: "Network request failed",
            cause = error,
        )
    }

    private fun requireData(executed: ExecutedResponse): Any = try {
        ApiResponseParser.requireData(executed.response)
    } catch (error: ApiClientException) {
        synchronized(settingsLock) {
            if (
                error.status == HttpURLConnection.HTTP_UNAUTHORIZED &&
                executed.authorizedToken != null &&
                tokenStore.token == executed.authorizedToken &&
                tokenStore.baseUrl == executed.baseUrl &&
                configurationGeneration ==
                executed.configurationGeneration
            ) {
                tokenStore.clearToken()
                configurationGeneration += 1
            }
        }
        throw error
    }

    private fun <I, O> decodeSafely(
        response: HttpResponse,
        input: I,
        decode: (I) -> O,
    ): O = try {
        decode(input)
    } catch (error: JSONException) {
        throw ApiResponseParser.invalidResponse(
            response.status,
            response.body,
            "Response data does not match the expected shape",
            error,
        )
    } catch (error: IllegalArgumentException) {
        throw ApiResponseParser.invalidResponse(
            response.status,
            response.body,
            "Response data contains an invalid value",
            error,
        )
    }
}
