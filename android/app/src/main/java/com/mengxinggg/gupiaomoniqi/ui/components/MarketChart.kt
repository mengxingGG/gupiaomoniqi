package com.mengxinggg.gupiaomoniqi.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.mengxinggg.gupiaomoniqi.ui.CandleUi
import com.mengxinggg.gupiaomoniqi.ui.UiChartRange
import com.mengxinggg.gupiaomoniqi.ui.UiDisplayCurrency
import com.mengxinggg.gupiaomoniqi.ui.asDisplayMoney
import com.mengxinggg.gupiaomoniqi.ui.theme.GainRed
import com.mengxinggg.gupiaomoniqi.ui.theme.LossGreen
import java.util.Locale
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

private val Ma5Color = Color(0xFFF6A623)
private val Ma10Color = Color(0xFF8E6CEF)
private val Ma20Color = Color(0xFF2684FF)
private val AverageColor = Color(0xFFFF9800)
private val DifColor = Color(0xFFF6A623)
private val DeaColor = Color(0xFF2684FF)

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
        shape = RoundedCornerShape(12.dp),
        tonalElevation = 1.dp,
    ) {
        if (candles.isEmpty()) {
            EmptyChart()
            return@Surface
        }

        var windowSize by rememberSaveable(range) { mutableIntStateOf(defaultWindow(candles.size)) }
        var selectedIndex by rememberSaveable(range, candles.size) {
            mutableIntStateOf((min(candles.size, windowSize) - 1).coerceAtLeast(0))
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
                averagePrice = candle.averagePrice?.let(converter),
            )
        }
        val visible = tailWindow(converted, windowSize)
        val safeSelectedIndex = selectedIndex.coerceIn(visible.indices)
        val selected = visible[safeSelectedIndex]
        val studies = calculateStudies(converted).takeLast(visible.size)
        val gridColor = MaterialTheme.colorScheme.outlineVariant
        val surfaceColor = MaterialTheme.colorScheme.surface
        val primaryColor = MaterialTheme.colorScheme.primary

        Column(
            modifier = Modifier.padding(10.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                (listOf(30, 60, 120).filter { it < candles.size } + candles.size)
                    .distinct()
                    .forEach { count ->
                    FilterChip(
                        selected = windowSize == count,
                        onClick = {
                            windowSize = count
                            selectedIndex = min(count, candles.size) - 1
                        },
                        label = {
                            Text(
                                if (count == candles.size) "全部" else "$count 根",
                                style = MaterialTheme.typography.labelSmall,
                            )
                        },
                    )
                }
            }
            OhlcvTip(selected, displayCurrency)

            if (range == UiChartRange.INTRADAY) {
                IntradayLegend()
                PriceCanvas(
                    candles = visible,
                    studies = studies,
                    intraday = true,
                    selectedIndex = safeSelectedIndex,
                    onSelect = { selectedIndex = it },
                    gridColor = gridColor,
                    surfaceColor = surfaceColor,
                    primaryColor = primaryColor,
                )
                VolumeCanvas(
                    candles = visible,
                    selectedIndex = safeSelectedIndex,
                    gridColor = gridColor,
                    surfaceColor = surfaceColor,
                    onSelect = { selectedIndex = it },
                )
            } else {
                MovingAverageLegend(studies.getOrNull(safeSelectedIndex))
                PriceCanvas(
                    candles = visible,
                    studies = studies,
                    intraday = false,
                    selectedIndex = safeSelectedIndex,
                    onSelect = { selectedIndex = it },
                    gridColor = gridColor,
                    surfaceColor = surfaceColor,
                    primaryColor = primaryColor,
                )
                Text("成交量", style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                VolumeCanvas(
                    candles = visible,
                    selectedIndex = safeSelectedIndex,
                    gridColor = gridColor,
                    surfaceColor = surfaceColor,
                    onSelect = { selectedIndex = it },
                )
                MacdLegend(studies.getOrNull(safeSelectedIndex))
                MacdCanvas(
                    studies = studies,
                    selectedIndex = safeSelectedIndex,
                    gridColor = gridColor,
                    surfaceColor = surfaceColor,
                    onSelect = { selectedIndex = it },
                )
                if (visible.size < 26) {
                    Text(
                        "现有 ${visible.size} 根记录，MA20/MACD 指标尚未充分形成。",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.labelSmall,
                    )
                }
            }
            Text(
                "触摸或左右拖动图表可查看对应 OHLCV；图表只使用服务端已有记录。",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.labelSmall,
            )
        }
    }
}

@Composable
private fun EmptyChart() {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(250.dp)
            .padding(24.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text("暂无可用图表记录", style = MaterialTheme.typography.titleMedium)
            Text(
                "只展示服务端真实记录，不会随机补线。",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

@Composable
private fun OhlcvTip(candle: CandleUi, currency: UiDisplayCurrency) {
    val prefix = currency.symbol
    Text(
        "${candle.time}  开 $prefix${candle.open.price()}  高 $prefix${candle.high.price()}\n" +
            "低 $prefix${candle.low.price()}  收 $prefix${candle.close.price()}  量 ${candle.volume.volume()}",
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        style = MaterialTheme.typography.labelSmall,
    )
}

@Composable
private fun IntradayLegend() {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        LegendText("价格", MaterialTheme.colorScheme.primary)
        LegendText("均价", AverageColor)
    }
}

@Composable
private fun MovingAverageLegend(last: ChartStudyPoint?) {
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        LegendText("MA5 ${last?.ma5?.price() ?: "--"}", Ma5Color)
        LegendText("MA10 ${last?.ma10?.price() ?: "--"}", Ma10Color)
        LegendText("MA20 ${last?.ma20?.price() ?: "--"}", Ma20Color)
    }
}

@Composable
private fun MacdLegend(point: ChartStudyPoint?) {
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        LegendText("MACD", MaterialTheme.colorScheme.onSurface)
        LegendText("DIF ${point?.dif?.signed() ?: "--"}", DifColor)
        LegendText("DEA ${point?.dea?.signed() ?: "--"}", DeaColor)
    }
}

@Composable
private fun LegendText(text: String, color: Color) {
    Text(text, color = color, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
}

@Composable
private fun PriceCanvas(
    candles: List<CandleUi>,
    studies: List<ChartStudyPoint>,
    intraday: Boolean,
    selectedIndex: Int,
    onSelect: (Int) -> Unit,
    gridColor: Color,
    surfaceColor: Color,
    primaryColor: Color,
) {
    val low = candles.minOf { it.low }
    val high = candles.maxOf { it.high }
    val span = max(0.000001, high - low)
    Canvas(
        modifier = Modifier
            .fillMaxWidth()
            .height(238.dp)
            .background(surfaceColor, RoundedCornerShape(6.dp))
            .chartPointer(candles.size, onSelect),
    ) {
        drawGrid(gridColor)
        fun y(value: Double): Float =
            size.height - (((value - low) / span) * size.height).toFloat()
        val step = size.width / max(1, candles.size).toFloat()
        if (intraday) {
            drawSeries(candles.map { it.close }, primaryColor, ::y, step, 2.4f)
            drawNullableSeries(studies.map { it.intradayAverage }, AverageColor, ::y, step, 2f)
        } else {
            val width = min(14f, max(2.5f, step * 0.58f))
            candles.forEachIndexed { index, candle ->
                val x = xAt(index, step)
                val color = candleColor(candle)
                drawLine(color, Offset(x, y(candle.high)), Offset(x, y(candle.low)), 1.8f)
                val openY = y(candle.open)
                val closeY = y(candle.close)
                drawRect(
                    color,
                    Offset(x - width / 2f, min(openY, closeY)),
                    Size(width, max(2f, abs(closeY - openY))),
                )
            }
            drawNullableSeries(studies.map { it.ma5 }, Ma5Color, ::y, step, 1.8f)
            drawNullableSeries(studies.map { it.ma10 }, Ma10Color, ::y, step, 1.8f)
            drawNullableSeries(studies.map { it.ma20 }, Ma20Color, ::y, step, 1.8f)
        }
        drawCrosshair(selectedIndex, candles.size, gridColor.copy(alpha = 0.9f), y(candles[selectedIndex].close))
    }
}

@Composable
private fun VolumeCanvas(
    candles: List<CandleUi>,
    selectedIndex: Int,
    gridColor: Color,
    surfaceColor: Color,
    onSelect: (Int) -> Unit,
) {
    val maxVolume = max(1.0, candles.maxOf { it.volume })
    Canvas(
        modifier = Modifier
            .fillMaxWidth()
            .height(82.dp)
            .background(surfaceColor, RoundedCornerShape(6.dp))
            .chartPointer(candles.size, onSelect),
    ) {
        val step = size.width / max(1, candles.size).toFloat()
        candles.forEachIndexed { index, candle ->
            val height = ((candle.volume / maxVolume) * size.height).toFloat()
            drawRect(
                candleColor(candle).copy(alpha = 0.78f),
                Offset(xAt(index, step) - max(1f, step * 0.32f), size.height - height),
                Size(max(2f, step * 0.64f), height),
            )
        }
        drawCrosshair(selectedIndex, candles.size, gridColor.copy(alpha = 0.8f))
    }
}

@Composable
private fun MacdCanvas(
    studies: List<ChartStudyPoint>,
    selectedIndex: Int,
    gridColor: Color,
    surfaceColor: Color,
    onSelect: (Int) -> Unit,
) {
    val extrema = studies.flatMap { listOf(it.dif, it.dea, it.macd) }
    val amplitude = max(0.000001, extrema.maxOfOrNull { abs(it) } ?: 1.0)
    Canvas(
        modifier = Modifier
            .fillMaxWidth()
            .height(112.dp)
            .background(surfaceColor, RoundedCornerShape(6.dp))
            .chartPointer(studies.size, onSelect),
    ) {
        val step = size.width / max(1, studies.size).toFloat()
        fun y(value: Double): Float =
            size.height / 2f - (value / amplitude * size.height * 0.46).toFloat()
        val zero = y(0.0)
        drawLine(gridColor, Offset(0f, zero), Offset(size.width, zero), 1.2f)
        studies.forEachIndexed { index, point ->
            val value = point.macd
            val valueY = y(value)
            drawRect(
                if (value >= 0) GainRed.copy(alpha = 0.78f) else LossGreen.copy(alpha = 0.78f),
                Offset(xAt(index, step) - max(1f, step * 0.28f), min(zero, valueY)),
                Size(max(2f, step * 0.56f), max(1f, abs(zero - valueY))),
            )
        }
        drawSeries(studies.map { it.dif }, DifColor, ::y, step, 1.8f)
        drawSeries(studies.map { it.dea }, DeaColor, ::y, step, 1.8f)
        drawCrosshair(selectedIndex, studies.size, gridColor.copy(alpha = 0.8f))
    }
}

private fun Modifier.chartPointer(count: Int, onSelect: (Int) -> Unit): Modifier =
    pointerInput(count) {
        fun select(x: Float) {
            if (count <= 0 || size.width <= 0) return
            onSelect(((x / size.width) * count).toInt().coerceIn(0, count - 1))
        }

        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false)
            var intent = ChartGestureIntent.UNDECIDED
            while (true) {
                val change = awaitPointerEvent(PointerEventPass.Main)
                    .changes
                    .firstOrNull { it.id == down.id }
                    ?: return@awaitEachGesture
                if (!change.pressed) {
                    if (intent == ChartGestureIntent.UNDECIDED && !change.isConsumed) {
                        select(change.position.x)
                    }
                    if (intent == ChartGestureIntent.HORIZONTAL) change.consume()
                    return@awaitEachGesture
                }
                if (intent == ChartGestureIntent.UNDECIDED) {
                    if (change.isConsumed) return@awaitEachGesture
                    intent = chartGestureIntent(
                        totalDx = change.position.x - down.position.x,
                        totalDy = change.position.y - down.position.y,
                        touchSlop = viewConfiguration.touchSlop,
                    )
                    when (intent) {
                        ChartGestureIntent.HORIZONTAL -> {
                            select(change.position.x)
                            change.consume()
                        }
                        ChartGestureIntent.VERTICAL -> return@awaitEachGesture
                        ChartGestureIntent.UNDECIDED -> Unit
                    }
                } else if (intent == ChartGestureIntent.HORIZONTAL) {
                    select(change.position.x)
                    change.consume()
                }
            }
        }
    }

private fun DrawScope.drawGrid(color: Color) {
    repeat(5) { index ->
        val y = size.height * index / 4f
        drawLine(color, Offset(0f, y), Offset(size.width, y), 1f)
    }
    repeat(5) { index ->
        val x = size.width * index / 4f
        drawLine(color.copy(alpha = 0.55f), Offset(x, 0f), Offset(x, size.height), 1f)
    }
}

private fun DrawScope.drawSeries(
    values: List<Double>,
    color: Color,
    y: (Double) -> Float,
    step: Float,
    width: Float,
) {
    val path = Path()
    values.forEachIndexed { index, value ->
        val x = xAt(index, step)
        if (index == 0) path.moveTo(x, y(value)) else path.lineTo(x, y(value))
    }
    drawPath(path, color, style = Stroke(width))
}

private fun DrawScope.drawNullableSeries(
    values: List<Double?>,
    color: Color,
    y: (Double) -> Float,
    step: Float,
    width: Float,
) {
    var path = Path()
    var drawing = false
    values.forEachIndexed { index, value ->
        if (value == null) {
            if (drawing) drawPath(path, color, style = Stroke(width))
            path = Path()
            drawing = false
        } else {
            val x = xAt(index, step)
            if (!drawing) path.moveTo(x, y(value)) else path.lineTo(x, y(value))
            drawing = true
        }
    }
    if (drawing) drawPath(path, color, style = Stroke(width))
}

private fun DrawScope.drawCrosshair(
    selectedIndex: Int,
    count: Int,
    color: Color,
    selectedY: Float? = null,
) {
    val step = size.width / max(1, count).toFloat()
    val x = xAt(selectedIndex, step)
    drawLine(color, Offset(x, 0f), Offset(x, size.height), 1f)
    if (selectedY != null) {
        drawLine(color, Offset(0f, selectedY), Offset(size.width, selectedY), 1f)
        drawCircle(color, 3.5f, Offset(x, selectedY))
    }
}

private fun xAt(index: Int, step: Float): Float = step * index + step / 2f
private fun candleColor(candle: CandleUi): Color = if (candle.close >= candle.open) GainRed else LossGreen
private fun defaultWindow(size: Int): Int = when {
    size > 120 -> 120
    size > 60 -> 60
    else -> size
}

private fun Double.price(): String = String.format(Locale.US, "%.2f", this)
private fun Double.signed(): String = String.format(Locale.US, "%+.3f", this)
private fun Double.volume(): String = when {
    this >= 100_000_000 -> String.format(Locale.US, "%.2f亿", this / 100_000_000)
    this >= 10_000 -> String.format(Locale.US, "%.2f万", this / 10_000)
    else -> String.format(Locale.US, "%.0f", this)
}
