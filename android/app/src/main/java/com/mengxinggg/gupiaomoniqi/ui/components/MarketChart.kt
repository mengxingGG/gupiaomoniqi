package com.mengxinggg.gupiaomoniqi.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp
import com.mengxinggg.gupiaomoniqi.ui.CandleUi
import com.mengxinggg.gupiaomoniqi.ui.UiChartRange
import com.mengxinggg.gupiaomoniqi.ui.UiDisplayCurrency
import com.mengxinggg.gupiaomoniqi.ui.asDisplayMoney
import com.mengxinggg.gupiaomoniqi.ui.theme.GainRed
import com.mengxinggg.gupiaomoniqi.ui.theme.LossGreen
import java.util.Locale
import kotlin.math.max
import kotlin.math.min

@Composable
fun MarketChart(
    candles: List<CandleUi>,
    range: UiChartRange,
    quoteCurrency: String,
    displayCurrency: UiDisplayCurrency,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(18.dp),
        tonalElevation = 1.dp,
    ) {
        if (candles.isEmpty()) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(250.dp)
                    .padding(24.dp),
                contentAlignment = Alignment.Center,
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Text("暂无可用 K 线", style = MaterialTheme.typography.titleMedium)
                    Text(
                        "只展示服务端真实记录，不会随机补线。",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
            return@Surface
        }

        val converter: (Double) -> Double = { value ->
            val usd = if (quoteCurrency == "CNY") value / 7.0 else value
            usd.asDisplayMoney(displayCurrency)
        }
        val converted = candles.map { candle ->
            candle.copy(
                open = converter(candle.open),
                high = converter(candle.high),
                low = converter(candle.low),
                close = converter(candle.close),
            )
        }
        val low = converted.minOf { it.low }
        val high = converted.maxOf { it.high }
        val lineColor = MaterialTheme.colorScheme.primary
        val gridColor = MaterialTheme.colorScheme.outlineVariant
        val volumeColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.17f)
        val labelColor = MaterialTheme.colorScheme.onSurfaceVariant

        Column(modifier = Modifier.padding(12.dp)) {
            Canvas(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(230.dp)
                    .background(
                        MaterialTheme.colorScheme.surface,
                        RoundedCornerShape(12.dp),
                    ),
            ) {
                val chartBottom = size.height * 0.79f
                val chartTop = size.height * 0.06f
                val volumeTop = size.height * 0.83f
                val priceSpan = max(0.000001, high - low)
                val xStep = size.width / max(1, converted.size).toFloat()
                val maxVolume = max(1.0, converted.maxOf { it.volume })

                repeat(5) { index ->
                    val y = chartTop + (chartBottom - chartTop) * index / 4f
                    drawLine(
                        color = gridColor,
                        start = Offset(0f, y),
                        end = Offset(size.width, y),
                        strokeWidth = 1f,
                    )
                }
                repeat(5) { index ->
                    val x = size.width * index / 4f
                    drawLine(
                        color = gridColor.copy(alpha = 0.55f),
                        start = Offset(x, chartTop),
                        end = Offset(x, chartBottom),
                        strokeWidth = 1f,
                    )
                }

                converted.forEachIndexed { index, candle ->
                    val x = xStep * index + xStep / 2f
                    val volumeHeight =
                        ((candle.volume / maxVolume) * (size.height - volumeTop)).toFloat()
                    drawRect(
                        color = volumeColor,
                        topLeft = Offset(x - max(1f, xStep * 0.3f), size.height - volumeHeight),
                        size = Size(max(2f, xStep * 0.6f), volumeHeight),
                    )
                }

                fun priceY(value: Double): Float =
                    chartBottom -
                        (((value - low) / priceSpan) * (chartBottom - chartTop)).toFloat()

                if (range == UiChartRange.INTRADAY || converted.size > 120) {
                    val path = Path()
                    converted.forEachIndexed { index, candle ->
                        val x = if (converted.size == 1) {
                            size.width / 2f
                        } else {
                            size.width * index / (converted.size - 1).toFloat()
                        }
                        val y = priceY(candle.close)
                        if (index == 0) path.moveTo(x, y) else path.lineTo(x, y)
                    }
                    drawPath(path = path, color = lineColor, style = Stroke(width = 3f))
                    converted.lastOrNull()?.let { candle ->
                        val x = if (converted.size == 1) {
                            size.width / 2f
                        } else {
                            size.width
                        }
                        drawCircle(lineColor, radius = 5f, center = Offset(x, priceY(candle.close)))
                    }
                } else {
                    val candleWidth = min(16f, max(3f, xStep * 0.56f))
                    converted.forEachIndexed { index, candle ->
                        val x = xStep * index + xStep / 2f
                        val color = if (candle.close >= candle.open) GainRed else LossGreen
                        val openY = priceY(candle.open)
                        val closeY = priceY(candle.close)
                        val highY = priceY(candle.high)
                        val lowY = priceY(candle.low)
                        drawLine(
                            color = color,
                            start = Offset(x, highY),
                            end = Offset(x, lowY),
                            strokeWidth = 2f,
                        )
                        val top = min(openY, closeY)
                        val height = max(2f, kotlin.math.abs(closeY - openY))
                        drawRect(
                            color = color,
                            topLeft = Offset(x - candleWidth / 2f, top),
                            size = Size(candleWidth, height),
                        )
                    }
                }
            }

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 4.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    "低 ${displayCurrency.symbol}${String.format(Locale.US, "%.2f", low)}",
                    color = labelColor,
                    style = MaterialTheme.typography.labelSmall,
                )
                Text(
                    "成交量",
                    color = labelColor,
                    style = MaterialTheme.typography.labelSmall,
                )
                Text(
                    "高 ${displayCurrency.symbol}${String.format(Locale.US, "%.2f", high)}",
                    color = labelColor,
                    style = MaterialTheme.typography.labelSmall,
                )
            }
        }
    }
}
