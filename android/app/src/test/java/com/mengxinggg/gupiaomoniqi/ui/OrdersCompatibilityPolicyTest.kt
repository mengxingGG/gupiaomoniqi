package com.mengxinggg.gupiaomoniqi.ui

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class OrdersCompatibilityPolicyTest {
    @Test
    fun `missing endpoint is cached only for the same server epoch and mode`() {
        val capability = OrdersEndpointCapability()
        capability.recordMissing(3L, UiMarketMode.VIRTUAL)

        assertTrue(capability.shouldSkip(3L, UiMarketMode.VIRTUAL))
        assertFalse(capability.shouldSkip(3L, UiMarketMode.REAL))
        assertFalse(capability.shouldSkip(4L, UiMarketMode.VIRTUAL))
    }

    @Test
    fun `successful manual reprobe restores endpoint availability`() {
        val capability = OrdersEndpointCapability()
        capability.recordMissing(1L, UiMarketMode.REAL)
        capability.recordAvailable(1L, UiMarketMode.REAL)

        assertFalse(capability.shouldSkip(1L, UiMarketMode.REAL))
    }

    @Test
    fun `server switch can clear all stale capability results`() {
        val capability = OrdersEndpointCapability()
        capability.recordMissing(1L, UiMarketMode.VIRTUAL)
        capability.recordMissing(1L, UiMarketMode.REAL)
        capability.clear()

        assertFalse(capability.shouldSkip(1L, UiMarketMode.VIRTUAL))
        assertFalse(capability.shouldSkip(1L, UiMarketMode.REAL))
    }
}
