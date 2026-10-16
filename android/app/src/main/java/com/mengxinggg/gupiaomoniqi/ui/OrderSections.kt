package com.mengxinggg.gupiaomoniqi.ui

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope

/** 成交与委托独立收集结果；普通接口失败不取消另一栏，退出页面的取消仍向上传播。 */
internal suspend fun <T, O> loadOrderSections(
    transactions: suspend () -> T,
    orders: suspend () -> O,
): Pair<Result<T>, Result<O>> = coroutineScope {
    val first = async { captureSection(transactions) }
    val second = async { captureSection(orders) }
    first.await() to second.await()
}

private suspend fun <T> captureSection(load: suspend () -> T): Result<T> = try {
    Result.success(load())
} catch (error: CancellationException) {
    throw error
} catch (error: Exception) {
    Result.failure(error)
}

internal fun Throwable.orderSectionMessage(fallback: String): String =
    if (message?.contains("REAL_ORDER_INSTRUMENT_NOT_FOUND") == true)
        "服务器无法读取部分历史委托的股票资料，请将服务端更新至 1.1.2。成交记录可单独查看。"
    else fallback
