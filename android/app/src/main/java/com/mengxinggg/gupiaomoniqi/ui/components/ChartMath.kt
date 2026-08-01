package com.mengxinggg.gupiaomoniqi.ui.components

import com.mengxinggg.gupiaomoniqi.ui.CandleUi

internal data class ChartStudyPoint(
    val ma5: Double?,
    val ma10: Double?,
    val ma20: Double?,
    val intradayAverage: Double?,
    val dif: Double,
    val dea: Double,
    val macd: Double,
)

internal enum class ChartGestureIntent {
    UNDECIDED,
    HORIZONTAL,
    VERTICAL,
}

/**
 * 图表只接管方向足够明确的横向拖动；斜向或纵向移动优先留给外层滚动容器。
 */
internal fun chartGestureIntent(
    totalDx: Float,
    totalDy: Float,
    touchSlop: Float,
): ChartGestureIntent {
    val horizontal = kotlin.math.abs(totalDx)
    val vertical = kotlin.math.abs(totalDy)
    if (maxOf(horizontal, vertical) <= touchSlop) return ChartGestureIntent.UNDECIDED
    return if (horizontal > touchSlop && horizontal >= vertical * 1.25f) {
        ChartGestureIntent.HORIZONTAL
    } else {
        ChartGestureIntent.VERTICAL
    }
}

internal fun tailWindow(candles: List<CandleUi>, requestedSize: Int): List<CandleUi> {
    if (candles.isEmpty()) return emptyList()
    return candles.takeLast(requestedSize.coerceIn(1, candles.size))
}

internal fun movingAverage(values: List<Double>, period: Int): List<Double?> {
    require(period > 0) { "period must be positive" }
    var sum = 0.0
    return values.mapIndexed { index, value ->
        sum += value
        if (index >= period) sum -= values[index - period]
        if (index >= period - 1) sum / period else null
    }
}

internal fun exponentialMovingAverage(values: List<Double>, period: Int): List<Double> {
    require(period > 0) { "period must be positive" }
    if (values.isEmpty()) return emptyList()
    val alpha = 2.0 / (period + 1.0)
    var previous = values.first()
    return values.mapIndexed { index, value ->
        if (index == 0) {
            value
        } else {
            ((value - previous) * alpha + previous).also { previous = it }
        }
    }
}

internal fun calculateStudies(candles: List<CandleUi>): List<ChartStudyPoint> {
    if (candles.isEmpty()) return emptyList()
    val closes = candles.map(CandleUi::close)
    val ma5 = movingAverage(closes, 5)
    val ma10 = movingAverage(closes, 10)
    val ma20 = movingAverage(closes, 20)
    val ema12 = exponentialMovingAverage(closes, 12)
    val ema26 = exponentialMovingAverage(closes, 26)
    val dif = ema12.zip(ema26) { fast, slow -> fast - slow }
    val dea = exponentialMovingAverage(dif, 9)
    var weightedValue = 0.0
    var totalVolume = 0.0
    var closeSum = 0.0
    return candles.indices.map { index ->
        val volume = candles[index].volume.coerceAtLeast(0.0)
        weightedValue += closes[index] * volume
        totalVolume += volume
        closeSum += closes[index]
        val recordedAverage = candles[index].averagePrice
            ?.takeIf { it.isFinite() && it > 0.0 }
        ChartStudyPoint(
            ma5 = ma5[index],
            ma10 = ma10[index],
            ma20 = ma20[index],
            intradayAverage = recordedAverage ?: if (totalVolume > 0.0) {
                    weightedValue / totalVolume
                } else {
                    closeSum / (index + 1)
                },
            dif = dif[index],
            dea = dea[index],
            macd = (dif[index] - dea[index]) * 2.0,
        )
    }
}
