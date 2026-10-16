package com.mengxinggg.gupiaomoniqi.ui

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.*
import org.junit.Test

class OrderSectionsTest {
    @Test
    fun brokenHistoricalOrderDoesNotCancelTransactions() = runBlocking {
        val orderStarted = CompletableDeferred<Unit>()
        val result = withTimeout(2_000) {
            loadOrderSections(
                transactions = { orderStarted.await(); listOf("filled-trade") },
                orders = { orderStarted.complete(Unit); error("REAL_ORDER_INSTRUMENT_NOT_FOUND") },
            )
        }
        assertEquals(listOf("filled-trade"), result.first.getOrThrow())
        assertTrue(result.second.isFailure)
        assertTrue(result.second.exceptionOrNull()!!.orderSectionMessage("失败").contains("1.1.2"))
    }

    @Test
    fun transactionFailureKeepsOrders() = runBlocking {
        val result = loadOrderSections(
            transactions = { error("transaction service unavailable") },
            orders = { listOf("open-order") },
        )
        assertTrue(result.first.isFailure)
        assertEquals(listOf("open-order"), result.second.getOrThrow())
    }

    @Test
    fun bothErrorsRemainAvailableForSessionExpiryHandling() = runBlocking {
        val first = IllegalStateException("401 session expired")
        val second = IllegalStateException("order failure")
        val result = loadOrderSections({ throw first }, { throw second })
        assertSame(first, result.first.exceptionOrNull())
        assertSame(second, result.second.exceptionOrNull())
    }

    @Test
    fun retryCanRecoverBothSections() = runBlocking {
        loadOrderSections({ error("offline") }, { error("offline") })
        val recovered = loadOrderSections({ listOf("trade") }, { listOf("order") })
        assertEquals(listOf("trade"), recovered.first.getOrThrow())
        assertEquals(listOf("order"), recovered.second.getOrThrow())
    }

    @Test
    fun cancellationIsPropagatedInsteadOfBecomingAnErrorPanel() {
        assertThrows(CancellationException::class.java) {
            runBlocking {
                loadOrderSections({ throw CancellationException("screen closed") }, { emptyList<String>() })
            }
        }
    }
}
