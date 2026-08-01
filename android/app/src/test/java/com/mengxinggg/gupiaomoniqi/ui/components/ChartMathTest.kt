package com.mengxinggg.gupiaomoniqi.ui.components

import com.mengxinggg.gupiaomoniqi.ui.CandleUi
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ChartMathTest {
    @Test
    fun `moving average stays absent until a complete period exists`() {
        val result = movingAverage(listOf(1.0, 2.0, 3.0, 4.0, 5.0, 6.0), 5)

        assertNull(result[3])
        assertEquals(3.0, result[4]!!, 0.000001)
        assertEquals(4.0, result[5]!!, 0.000001)
    }

    @Test
    fun `ema and macd are deterministic from closing prices`() {
        val candles = (1..40).map { index -> candle(index, index.toDouble(), index.toDouble()) }
        val studies = calculateStudies(candles)

        assertEquals(40, studies.size)
        assertEquals(38.0, studies.last().ma5!!, 0.000001)
        assertTrue(studies.last().dif > studies.last().dea)
        assertTrue(studies.last().macd > 0.0)
    }

    @Test
    fun `intraday average uses cumulative volume weighting without invented points`() {
        val studies = calculateStudies(
            listOf(
                candle(1, close = 10.0, volume = 1.0),
                candle(2, close = 20.0, volume = 3.0),
            ),
        )

        assertEquals(10.0, studies[0].intradayAverage!!, 0.000001)
        assertEquals(17.5, studies[1].intradayAverage!!, 0.000001)
    }

    @Test
    fun `recorded intraday average takes priority over fallback`() {
        val recorded = candle(1, close = 10.0, volume = 2.0).copy(averagePrice = 9.75)

        assertEquals(9.75, calculateStudies(listOf(recorded)).single().intradayAverage!!, 0.000001)
    }

    @Test
    fun `studies remain aligned when the visible window is shortened`() {
        val candles = (1..40).map { candle(it, it.toDouble(), 1.0) }
        val alignedTail = calculateStudies(candles).takeLast(3)

        assertTrue(alignedTail.first().ma20 != null)
        assertNull(calculateStudies(candles.takeLast(3)).first().ma20)
    }

    @Test
    fun `tail window keeps the newest recorded candles`() {
        val candles = (1..10).map { candle(it, it.toDouble(), 1.0) }
        val visible = tailWindow(candles, 3)

        assertEquals(listOf("8", "9", "10"), visible.map(CandleUi::time))
    }

    @Test
    fun `chart gesture waits inside touch slop`() {
        assertEquals(
            ChartGestureIntent.UNDECIDED,
            chartGestureIntent(totalDx = 7f, totalDy = 5f, touchSlop = 8f),
        )
    }

    @Test
    fun `chart gesture claims only clearly horizontal drag`() {
        assertEquals(
            ChartGestureIntent.HORIZONTAL,
            chartGestureIntent(totalDx = 20f, totalDy = 8f, touchSlop = 8f),
        )
        assertEquals(
            ChartGestureIntent.VERTICAL,
            chartGestureIntent(totalDx = 10f, totalDy = 18f, touchSlop = 8f),
        )
        assertEquals(
            ChartGestureIntent.VERTICAL,
            chartGestureIntent(totalDx = 14f, totalDy = 13f, touchSlop = 8f),
        )
    }

    private fun candle(index: Int, close: Double, volume: Double): CandleUi = CandleUi(
        time = index.toString(),
        open = close - 0.5,
        high = close + 1.0,
        low = close - 1.0,
        close = close,
        volume = volume,
    )
}
