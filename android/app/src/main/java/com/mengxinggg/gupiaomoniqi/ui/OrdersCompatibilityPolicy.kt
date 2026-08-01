package com.mengxinggg.gupiaomoniqi.ui

internal class OrdersEndpointCapability {
    private data class Key(
        val serverEpoch: Long,
        val mode: UiMarketMode,
    )

    private val missing = mutableSetOf<Key>()

    fun shouldSkip(serverEpoch: Long, mode: UiMarketMode): Boolean =
        Key(serverEpoch, mode) in missing

    fun recordMissing(serverEpoch: Long, mode: UiMarketMode) {
        missing += Key(serverEpoch, mode)
    }

    fun recordAvailable(serverEpoch: Long, mode: UiMarketMode) {
        missing -= Key(serverEpoch, mode)
    }

    fun clear() {
        missing.clear()
    }
}
