package com.mengxinggg.gupiaomoniqi.data

import com.mengxinggg.gupiaomoniqi.model.AuthResult
import com.mengxinggg.gupiaomoniqi.model.AndroidAppRelease
import com.mengxinggg.gupiaomoniqi.model.AndroidUpdateCheck
import com.mengxinggg.gupiaomoniqi.model.Candle
import com.mengxinggg.gupiaomoniqi.model.CandleSource
import com.mengxinggg.gupiaomoniqi.model.ChartRange
import com.mengxinggg.gupiaomoniqi.model.ChartSeries
import com.mengxinggg.gupiaomoniqi.model.ChartSource
import com.mengxinggg.gupiaomoniqi.model.Currency
import com.mengxinggg.gupiaomoniqi.model.DailyCheckInStatus
import com.mengxinggg.gupiaomoniqi.model.EmailVerificationRequestResult
import com.mengxinggg.gupiaomoniqi.model.Instrument
import com.mengxinggg.gupiaomoniqi.model.InstrumentType
import com.mengxinggg.gupiaomoniqi.model.IndustryCount
import com.mengxinggg.gupiaomoniqi.model.Market
import com.mengxinggg.gupiaomoniqi.model.MarketItem
import com.mengxinggg.gupiaomoniqi.model.MarketMode
import com.mengxinggg.gupiaomoniqi.model.LimitOrder
import com.mengxinggg.gupiaomoniqi.model.OrderBook
import com.mengxinggg.gupiaomoniqi.model.OrderBookLevel
import com.mengxinggg.gupiaomoniqi.model.OrderCancellationResult
import com.mengxinggg.gupiaomoniqi.model.OrderSubmissionResult
import com.mengxinggg.gupiaomoniqi.model.Page
import com.mengxinggg.gupiaomoniqi.model.Portfolio
import com.mengxinggg.gupiaomoniqi.model.Position
import com.mengxinggg.gupiaomoniqi.model.PublicAccount
import com.mengxinggg.gupiaomoniqi.model.PasswordResetConfirmResult
import com.mengxinggg.gupiaomoniqi.model.PasswordResetRequestResult
import com.mengxinggg.gupiaomoniqi.model.Quote
import com.mengxinggg.gupiaomoniqi.model.RewardClaimResult
import com.mengxinggg.gupiaomoniqi.model.RewardClaimState
import com.mengxinggg.gupiaomoniqi.model.RewardKind
import com.mengxinggg.gupiaomoniqi.model.RegistrationEmailVerificationConfirmResult
import com.mengxinggg.gupiaomoniqi.model.SettlementCycle
import com.mengxinggg.gupiaomoniqi.model.TradeActorType
import com.mengxinggg.gupiaomoniqi.model.TradeResult
import com.mengxinggg.gupiaomoniqi.model.TradeSide
import com.mengxinggg.gupiaomoniqi.model.Transaction
import com.mengxinggg.gupiaomoniqi.model.Watchlist
import com.mengxinggg.gupiaomoniqi.model.WatchlistItem
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/**
 * JSON mapping is kept independent from Android framework classes so it can be
 * exercised by local JVM tests and reused by alternate transports.
 */
object JsonCodec {
    fun androidUpdateCheck(json: JSONObject): AndroidUpdateCheck =
        AndroidUpdateCheck(
            currentVersionCode = json.getLong("currentVersionCode"),
            updateAvailable = json.getBoolean("updateAvailable"),
            release = json.nullableObject("release")?.let(::androidAppRelease),
        )

    fun androidAppRelease(json: JSONObject): AndroidAppRelease =
        AndroidAppRelease(
            packageName = json.getString("packageName"),
            versionCode = json.getLong("versionCode"),
            versionName = json.getString("versionName"),
            apkPath = json.getString("apkPath"),
            sha256 = json.getString("sha256"),
            sizeBytes = json.getLong("sizeBytes"),
            publishedAt = json.getString("publishedAt"),
            mandatory = json.getBoolean("mandatory"),
            releaseNotes = json.getString("releaseNotes"),
        )

    fun authResult(json: JSONObject): AuthResult = AuthResult(
        token = json.getString("token"),
        account = publicAccount(json.getJSONObject("account")),
    )

    fun publicAccount(json: JSONObject): PublicAccount = PublicAccount(
        id = json.getString("id"),
        username = json.getString("username"),
        email = json.nullableString("email"),
        displayName = json.getString("displayName"),
        displayCurrency = json.enum("displayCurrency"),
        createdAt = json.getString("createdAt"),
    )

    fun passwordResetRequest(json: JSONObject): PasswordResetRequestResult =
        PasswordResetRequestResult(
            accepted = json.getBoolean("accepted"),
            expiresInSeconds = json.getInt("expiresInSeconds"),
        )

    fun passwordResetConfirm(json: JSONObject): PasswordResetConfirmResult =
        PasswordResetConfirmResult(
            reset = json.getBoolean("reset"),
        )

    fun emailVerificationRequest(json: JSONObject): EmailVerificationRequestResult =
        EmailVerificationRequestResult(
            accepted = json.getBoolean("accepted"),
            expiresInSeconds = json.getInt("expiresInSeconds"),
        )

    fun registrationEmailVerificationConfirm(
        json: JSONObject,
    ): RegistrationEmailVerificationConfirmResult =
        RegistrationEmailVerificationConfirmResult(
            verificationToken = json.getString("verificationToken"),
            expiresInSeconds = json.getInt("expiresInSeconds"),
        )

    fun instrument(json: JSONObject): Instrument = Instrument(
        id = json.getString("id"),
        symbol = json.getString("symbol"),
        name = json.getString("name"),
        market = json.enum("market"),
        sourceCurrency = json.enum("sourceCurrency"),
        quoteCurrency = json.enum("quoteCurrency"),
        type = json.enum("type"),
        industry = json.getString("industry"),
        isTradable = json.getBoolean("isTradable"),
        lotSize = json.getInt("lotSize"),
        settlementCycle = json.enum("settlementCycle"),
    )

    fun quote(json: JSONObject): Quote = Quote(
        instrumentId = json.getString("instrumentId"),
        symbol = json.getString("symbol"),
        market = json.enum("market"),
        quoteCurrency = json.enum("quoteCurrency"),
        currentPrice = json.getDouble("currentPrice"),
        previousClose = json.getDouble("previousClose"),
        openPrice = json.getDouble("openPrice"),
        highPrice = json.getDouble("highPrice"),
        lowPrice = json.getDouble("lowPrice"),
        volume = json.getLong("volume"),
        changeAmount = json.getDouble("changeAmount"),
        changePercent = json.getDouble("changePercent"),
        updatedAt = json.getString("updatedAt"),
        receivedAt = json.nullableString("receivedAt"),
    )

    fun marketItem(json: JSONObject): MarketItem = MarketItem(
        instrument = instrument(json.getJSONObject("instrument")),
        quote = quote(json.getJSONObject("quote")),
    )

    fun marketPage(json: JSONObject): Page<MarketItem> = Page(
        items = json.getJSONArray("items").mapObjects(::marketItem),
        total = json.getInt("total"),
        page = json.getInt("page"),
        pageSize = json.getInt("pageSize"),
    )

    fun industryCounts(json: JSONArray): List<IndustryCount> =
        json.mapObjects { item ->
            IndustryCount(
                industry = item.getString("industry"),
                count = item.getInt("count"),
            )
        }

    fun position(json: JSONObject): Position = Position(
        instrumentId = json.getString("instrumentId"),
        symbol = json.getString("symbol"),
        name = json.getString("name"),
        market = json.enum("market"),
        quoteCurrency = json.enum("quoteCurrency"),
        quantity = json.getInt("quantity"),
        availableQuantity = json.getInt("availableQuantity"),
        frozenQuantity = json.getInt("frozenQuantity"),
        pendingSettlementQuantity = json.getInt("pendingSettlementQuantity"),
        averageCostUsd = json.getDouble("averageCostUsd"),
        currentPriceUsd = json.getDouble("currentPriceUsd"),
        marketValueUsd = json.getDouble("marketValueUsd"),
        profitLossUsd = json.getDouble("profitLossUsd"),
        profitLossPercent = json.getDouble("profitLossPercent"),
    )

    fun portfolio(json: JSONObject): Portfolio = Portfolio(
        mode = json.enum("mode"),
        displayCurrency = json.enum("displayCurrency"),
        usdCnyRate = json.getDouble("usdCnyRate"),
        initialCashUsd = json.getDouble("initialCashUsd"),
        availableCashUsd = json.getDouble("availableCashUsd"),
        frozenCashUsd = json.getDouble("frozenCashUsd"),
        positionsValueUsd = json.getDouble("positionsValueUsd"),
        totalAssetsUsd = json.getDouble("totalAssetsUsd"),
        realizedProfitUsd = json.getDouble("realizedProfitUsd"),
        unrealizedProfitUsd = json.getDouble("unrealizedProfitUsd"),
        totalProfitLossUsd = json.getDouble("totalProfitLossUsd"),
        positions = json.getJSONArray("positions").mapObjects(::position),
    )

    fun transaction(json: JSONObject): Transaction = Transaction(
        id = json.getString("id"),
        instrumentId = json.getString("instrumentId"),
        symbol = json.getString("symbol"),
        name = json.getString("name"),
        market = json.enum("market"),
        side = json.enum("side"),
        quantity = json.getInt("quantity"),
        quotePrice = json.getDouble("quotePrice"),
        quoteCurrency = json.enum("quoteCurrency"),
        fxRateToUsd = json.getDouble("fxRateToUsd"),
        priceUsd = json.getDouble("priceUsd"),
        grossAmountUsd = json.getDouble("grossAmountUsd"),
        feeUsd = json.getDouble("feeUsd"),
        netAmountUsd = json.getDouble("netAmountUsd"),
        realizedProfitUsd = json.nullableDouble("realizedProfitUsd"),
        createdAt = json.getString("createdAt"),
        actorType = json.enum("actorType"),
        actorId = json.nullableString("actorId"),
        idempotencyKey = json.nullableString("idempotencyKey"),
    )

    fun transactions(json: JSONArray): List<Transaction> =
        json.mapObjects(::transaction)

    fun limitOrder(json: JSONObject): LimitOrder = LimitOrder(
        id = json.getString("id"),
        mode = json.enum("mode"),
        instrumentId = json.getString("instrumentId"),
        symbol = json.getString("symbol"),
        name = json.getString("name"),
        market = json.enum("market"),
        side = json.enum("side"),
        orderMode = json.enum("orderMode"),
        status = json.enum("status"),
        quantity = json.getInt("quantity"),
        filledQuantity = json.getInt("filledQuantity"),
        limitPrice = json.nullableDouble("limitPrice"),
        quoteCurrency = json.enum("quoteCurrency"),
        reservedCashUsd = json.getDouble("reservedCashUsd"),
        reservedQuantity = json.getInt("reservedQuantity"),
        actorType = json.enum("actorType"),
        createdAt = json.getString("createdAt"),
        updatedAt = json.getString("updatedAt"),
        filledAt = json.nullableString("filledAt"),
        cancelledAt = json.nullableString("cancelledAt"),
        transactionId = json.nullableString("transactionId"),
    )

    fun limitOrders(json: JSONArray): List<LimitOrder> =
        json.mapObjects(::limitOrder)

    fun orderSubmissionResult(json: JSONObject): OrderSubmissionResult =
        OrderSubmissionResult(
            order = limitOrder(json.getJSONObject("order")),
            transaction = json.nullableObject("transaction")?.let(::transaction),
            portfolio = portfolio(json.getJSONObject("portfolio")),
        )

    fun orderCancellationResult(json: JSONObject): OrderCancellationResult =
        OrderCancellationResult(
            order = limitOrder(json.getJSONObject("order")),
            portfolio = portfolio(json.getJSONObject("portfolio")),
        )

    fun tradeResult(json: JSONObject): TradeResult = TradeResult(
        transaction = transaction(json.getJSONObject("transaction")),
        portfolio = portfolio(json.getJSONObject("portfolio")),
    )

    fun candle(json: JSONObject): Candle = Candle(
        time = json.getString("time"),
        open = json.getDouble("open"),
        high = json.getDouble("high"),
        low = json.getDouble("low"),
        close = json.getDouble("close"),
        volume = json.getLong("volume"),
        averagePrice = json.nullableDouble("averagePrice"),
        source = json.enum("source"),
        isPartial = json.getBoolean("isPartial"),
    )

    fun chartSeries(json: JSONObject): ChartSeries = ChartSeries(
        instrumentId = json.getString("instrumentId"),
        range = json.enum("range"),
        mode = json.enum("mode"),
        source = json.enum("source"),
        candles = json.getJSONArray("candles").mapObjects(::candle),
        coverageStart = json.nullableString("coverageStart"),
        updatedAt = json.getString("updatedAt"),
        referencePrice = json.nullableDouble("referencePrice"),
        complete = json.nullableBoolean("complete"),
        notice = json.nullableString("notice"),
    )

    fun orderBookLevel(json: JSONObject): OrderBookLevel = OrderBookLevel(
        price = json.getDouble("price"),
        quantity = json.getLong("quantity"),
        orderCount = json.getInt("orderCount"),
    )

    fun orderBook(json: JSONObject): OrderBook = OrderBook(
        instrumentId = json.getString("instrumentId"),
        quoteCurrency = json.enum("quoteCurrency"),
        mode = json.enum("mode"),
        asks = json.getJSONArray("asks").mapObjects(::orderBookLevel),
        bids = json.getJSONArray("bids").mapObjects(::orderBookLevel),
        updatedAt = json.getString("updatedAt"),
        available = json.nullableBoolean("available"),
        notice = json.nullableString("notice"),
    )

    fun watchlistItem(json: JSONObject): WatchlistItem = WatchlistItem(
        mode = json.enum("mode"),
        instrumentId = json.getString("instrumentId"),
        createdAt = json.getString("createdAt"),
        marketItem = json.nullableObject("marketItem")?.let(::marketItem),
    )

    fun watchlist(json: JSONObject): Watchlist = Watchlist(
        mode = json.enum("mode"),
        items = json.getJSONArray("items").mapObjects(::watchlistItem),
        instrumentIds = json.getJSONArray("instrumentIds").mapStrings(),
        limit = json.getInt("limit"),
    )

    fun checkInStatus(json: JSONObject): DailyCheckInStatus =
        DailyCheckInStatus(
            date = json.getString("date"),
            claimed = json.getBoolean("claimed"),
            claimedAt = json.nullableString("claimedAt"),
            mode = json.nullableEnum<MarketMode>("mode"),
            rewardUsd = json.getDouble("rewardUsd"),
        )

    fun rewardClaim(json: JSONObject): RewardClaimResult =
        RewardClaimResult(
            claimId = json.getString("claimId"),
            kind = json.enum("kind"),
            mode = json.enum("mode"),
            amountUsd = json.getDouble("amountUsd"),
            state = json.enum("state"),
            claimedAt = json.getString("claimedAt"),
            portfolio = portfolio(json.getJSONObject("portfolio")),
        )
}

private inline fun <reified T : Enum<T>> JSONObject.enum(name: String): T {
    val raw = getString(name)
    return enumValues<T>().firstOrNull { it.name == raw }
        ?: throw JSONException("Unknown ${T::class.java.simpleName} value for $name: $raw")
}

private inline fun <reified T : Enum<T>> JSONObject.nullableEnum(
    name: String,
): T? = if (hasValue(name)) enum<T>(name) else null

private fun JSONObject.nullableString(name: String): String? =
    if (hasValue(name)) getString(name) else null

private fun JSONObject.nullableDouble(name: String): Double? =
    if (hasValue(name)) getDouble(name) else null

private fun JSONObject.nullableBoolean(name: String): Boolean? =
    if (hasValue(name)) getBoolean(name) else null

private fun JSONObject.nullableObject(name: String): JSONObject? =
    if (hasValue(name)) getJSONObject(name) else null

private fun JSONObject.hasValue(name: String): Boolean =
    has(name) && !isNull(name)

private fun <T> JSONArray.mapObjects(
    transform: (JSONObject) -> T,
): List<T> = buildList(length()) {
    for (index in 0 until length()) {
        add(transform(getJSONObject(index)))
    }
}

private fun JSONArray.mapStrings(): List<String> =
    buildList(length()) {
        for (index in 0 until length()) {
            add(getString(index))
        }
    }
