package com.mengxinggg.gupiaomoniqi.ui

import com.mengxinggg.gupiaomoniqi.model.Candle
import com.mengxinggg.gupiaomoniqi.model.CandleSource
import org.junit.Assert.assertEquals
import org.junit.Test

class CandleMappingTest {
    @Test
    fun `UI candle keeps provider average price`() {
        val mapped = Candle(
            time = "2026-08-01T09:30:00Z",
            open = 10.0,
            high = 10.5,
            low = 9.8,
            close = 10.2,
            volume = 1234,
            averagePrice = 10.08,
            source = CandleSource.REAL_PROVIDER_HISTORY,
            isPartial = false,
        ).toUi()

        assertEquals(10.08, mapped.averagePrice!!, 0.000001)
        assertEquals(1234.0, mapped.volume, 0.000001)
    }
}
