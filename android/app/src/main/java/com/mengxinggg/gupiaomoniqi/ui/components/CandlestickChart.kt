package com.mengxinggg.gupiaomoniqi.ui.components

import android.graphics.Paint
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.mengxinggg.gupiaomoniqi.ui.*
import java.util.Locale
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

private val KUp = Color(0xFFDF3E44)
private val KDown = Color(0xFF24976B)
private val KInk = Color(0xFF4C535C)
private val KOrange = Color(0xFFE8A02F)
private val KMagenta = Color(0xFFAD56B6)
private val KGrid = Color(0xFFEDF0F3)
private fun Double.kPrice() = String.format(Locale.US, "%.2f", this)
private fun Double.kVolume() = when { this >= 1e8 -> String.format(Locale.US, "%.1f亿", this / 1e8); this >= 1e4 -> String.format(Locale.US, "%.1f万", this / 1e4); else -> String.format(Locale.US, "%.0f", this) }

@Composable
fun CandlestickChart(candles: List<CandleUi>, range: UiChartRange, quoteCurrency: String, displayCurrency: UiDisplayCurrency, modifier: Modifier = Modifier) {
    var expanded by rememberSaveable { mutableStateOf(false) }
    var count by rememberSaveable(range) { mutableIntStateOf(60) }
    var offset by rememberSaveable(range) { mutableIntStateOf(0) }
    var selected by rememberSaveable(range) { mutableIntStateOf(-1) }
    var macd by rememberSaveable { mutableStateOf(false) }
    val converted = remember(candles, quoteCurrency, displayCurrency) { candles.map { c ->
        fun convert(v: Double) = (if (quoteCurrency == "CNY") v / 7.0 else v).asDisplayMoney(displayCurrency)
        c.copy(open = convert(c.open), high = convert(c.high), low = convert(c.low), close = convert(c.close))
    } }
    val actualCount = min(count, converted.size)
    val end = (converted.size - offset).coerceIn(actualCount, converted.size)
    val start = end - actualCount
    val visible = converted.subList(start, end)
    val studies = remember(converted) { calculateStudies(converted) }.subList(start, end)
    val volumeMa5 = remember(candles) { movingAverage(candles.map { it.volume.toDouble() }, 5) }.subList(start, end)
    val volumeMa10 = remember(candles) { movingAverage(candles.map { it.volume.toDouble() }, 10) }.subList(start, end)
    val activeIndex = if (selected < 0) visible.lastIndex else selected.coerceAtMost(visible.lastIndex)
    val active = visible[activeIndex]
    val study = studies[activeIndex]
    val content: @Composable () -> Unit = {
        Column(Modifier.fillMaxWidth().background(Color.White).padding(horizontal = 4.dp)) {
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(vertical = 5.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                listOf(Triple("MA5", study.ma5, KInk), Triple("MA10", study.ma10, KOrange), Triple("MA20", study.ma20, KMagenta)).forEach { (name, value, color) ->
                    Text("$name ${value?.kPrice() ?: "—"}", color = color, fontSize = 10.sp, lineHeight = 14.sp, maxLines = 1)
                }
            }
            Row(Modifier.horizontalScroll(rememberScrollState()).padding(bottom = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(active.time.take(10), fontSize = 10.sp, lineHeight = 14.sp, color = KInk)
                listOf("开" to active.open, "高" to active.high, "低" to active.low, "收" to active.close).forEach { (label, value) -> Text("$label ${value.kPrice()}", fontSize = 10.sp, lineHeight = 14.sp, color = if (value >= active.open) KUp else KDown) }
            }
            KPlot(visible, studies, volumeMa5, volumeMa10, selected, macd, expanded, onSelect = { selected = it })
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = { macd = !macd }, contentPadding = PaddingValues(horizontal = 6.dp)) { Text(if (macd) "MACD ▾" else "成交量 ▾", fontSize = 11.sp, lineHeight = 16.sp, color = KInk) }
                Text("${visible.size}根", Modifier.weight(1f), color = KInk, fontSize = 10.sp)
                IconButton(onClick = { offset = min(converted.size - actualCount, offset + max(1, actualCount / 3)); selected = -1 }, enabled = start > 0, modifier = Modifier.size(40.dp)) { FineIcon(FineSymbol.PREVIOUS, "查看更早K线") }
                IconButton(onClick = { offset = max(0, offset - max(1, actualCount / 3)); selected = -1 }, enabled = offset > 0, modifier = Modifier.size(40.dp)) { FineIcon(FineSymbol.NEXT, "查看较新K线") }
                IconButton(onClick = { count = min(converted.size, count + 20); selected = -1 }, enabled = actualCount < converted.size, modifier = Modifier.size(40.dp)) { FineIcon(FineSymbol.MINUS, "缩小K线") }
                IconButton(onClick = { count = max(10, actualCount - 20); selected = -1 }, enabled = actualCount > 10, modifier = Modifier.size(40.dp)) { FineIcon(FineSymbol.PLUS, "放大K线") }
                IconButton(onClick = { expanded = !expanded }, modifier = Modifier.size(40.dp)) { FineIcon(if (expanded) FineSymbol.CLOSE else FineSymbol.EXPAND, if (expanded) "退出全屏图表" else "全屏K线图") }
            }
        }
    }
    if (expanded) Dialog(onDismissRequest = { expanded = false }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding(), color = Color.White) {
            Column(verticalArrangement = Arrangement.Center) { content() }
        }
    } else Box(modifier) { content() }
}

@Composable
private fun KPlot(candles: List<CandleUi>, studies: List<ChartStudyPoint>, v5: List<Double?>, v10: List<Double?>, selected: Int, macd: Boolean, expanded: Boolean, onSelect: (Int) -> Unit) {
    val active = if (selected < 0) candles.lastIndex else selected.coerceAtMost(candles.lastIndex)
    val desc = "K线，${candles.size}根；${candles[active].time.take(10)}，开${candles[active].open.kPrice()}，高${candles[active].high.kPrice()}，低${candles[active].low.kPrice()}，收${candles[active].close.kPrice()}，成交量${candles[active].volume}"
    Canvas(Modifier.fillMaxWidth().height(if (expanded) 420.dp else 302.dp).semantics {
        contentDescription = desc
        customActions = listOf(CustomAccessibilityAction("上一根K线") { onSelect(max(0, active - 1)); true }, CustomAccessibilityAction("下一根K线") { onSelect(min(candles.lastIndex, active + 1)); true })
    }.pointerInput(candles.size, candles.first().time) {
        fun select(x: Float) = onSelect(((x - 38.dp.toPx()) / (size.width - 46.dp.toPx()) * candles.size).toInt().coerceIn(candles.indices))
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false)
            var intent = ChartGestureIntent.UNDECIDED
            while (true) {
                val change = awaitPointerEvent().changes.firstOrNull { it.id == down.id } ?: return@awaitEachGesture
                if (!change.pressed) { if (!change.isConsumed && intent != ChartGestureIntent.VERTICAL) select(change.position.x); return@awaitEachGesture }
                if (intent == ChartGestureIntent.UNDECIDED) {
                    if (change.isConsumed) return@awaitEachGesture
                    intent = chartGestureIntent(change.position.x - down.position.x, change.position.y - down.position.y, viewConfiguration.touchSlop)
                }
                if (intent == ChartGestureIntent.VERTICAL) return@awaitEachGesture
                if (intent == ChartGestureIntent.HORIZONTAL) { select(change.position.x); change.consume() }
            }
        }
    }) {
        val left = 38.dp.toPx(); val right = size.width - 8.dp.toPx(); val top = 10.dp.toPx()
        val bottom = size.height - 88.dp.toPx(); val volumeTop = bottom + 22.dp.toPx(); val volumeBottom = size.height - 19.dp.toPx()
        val step = (right - left) / candles.size; val bodyWidth = min(8.dp.toPx(), step * .64f)
        val averages = studies.flatMap { listOfNotNull(it.ma5, it.ma10, it.ma20) }
        val low = min(candles.minOf { it.low }, averages.minOrNull() ?: Double.MAX_VALUE)
        val high = max(candles.maxOf { it.high }, averages.maxOrNull() ?: -Double.MAX_VALUE)
        val pad = max((high - low) * .08, abs(high) * .003).coerceAtLeast(.01)
        val priceLow = low - pad; val priceHigh = high + pad
        fun x(i: Int) = left + (i + .5f) * step
        fun y(value: Double) = bottom - ((value - priceLow) / (priceHigh - priceLow) * (bottom - top)).toFloat()
        repeat(5) { i ->
            val yy = top + (bottom - top) * i / 4f
            drawLine(KGrid, Offset(left, yy), Offset(right, yy), .6.dp.toPx())
            kLabel((priceHigh - (priceHigh - priceLow) * i / 4).kPrice(), left - 4.dp.toPx(), yy + 3.dp.toPx(), align = Paint.Align.RIGHT)
            val xx = left + (right - left) * i / 4f
            drawLine(KGrid, Offset(xx, top), Offset(xx, bottom), .6.dp.toPx())
            drawLine(KGrid, Offset(xx, volumeTop), Offset(xx, volumeBottom), .6.dp.toPx())
        }
        candles.forEachIndexed { i, c ->
            val color = if (c.close >= c.open) KUp else KDown
            drawLine(color, Offset(x(i), y(c.high)), Offset(x(i), y(c.low)), .75.dp.toPx())
            val position = Offset(x(i) - bodyWidth / 2, min(y(c.open), y(c.close)))
            val body = Size(bodyWidth, max(.8.dp.toPx(), abs(y(c.open) - y(c.close))))
            drawRect(if (c.close >= c.open) Color.White else color, position, body)
            if (c.close >= c.open) drawRect(color, position, body, style = Stroke(.75.dp.toPx()))
        }
        listOf(studies.map { it.ma5 } to KInk, studies.map { it.ma10 } to KOrange, studies.map { it.ma20 } to KMagenta).forEach { (values, color) -> kLine(values, color, ::x, ::y) }
        val maxIndex = candles.indices.maxBy { candles[it].high }; val minIndex = candles.indices.minBy { candles[it].low }
        listOf(Triple(maxIndex, candles[maxIndex].high, -5.dp.toPx()), Triple(minIndex, candles[minIndex].low, 11.dp.toPx())).forEach { (i, price, delta) ->
            val endX = (x(i) + if (i > candles.size / 2) -12.dp.toPx() else 12.dp.toPx()).coerceIn(left, right)
            drawLine(KInk, Offset(x(i), y(price)), Offset(endX, y(price) + delta / 2), .6.dp.toPx())
            kLabel(price.kPrice(), endX, y(price) + delta, color = KInk, align = if (i > candles.size / 2) Paint.Align.RIGHT else Paint.Align.LEFT)
        }
        if (macd) {
            val extent = studies.maxOf { max(abs(it.macd), max(abs(it.dif), abs(it.dea))) }.coerceAtLeast(.001)
            val zero = (volumeTop + volumeBottom) / 2
            fun my(v: Double) = zero - (v / extent * (volumeBottom - volumeTop) / 2).toFloat()
            drawLine(KGrid, Offset(left, zero), Offset(right, zero), .6.dp.toPx())
            studies.forEachIndexed { i, s -> drawLine(if (s.macd >= 0) KUp else KDown, Offset(x(i), zero), Offset(x(i), my(s.macd)), max(.6.dp.toPx(), bodyWidth / 2)) }
            kLine(studies.map { it.dif }, KOrange, ::x, ::my); kLine(studies.map { it.dea }, KMagenta, ::x, ::my)
            kLabel("MACD(12,26,9)  DIF ${studies[active].dif.kPrice()}  DEA ${studies[active].dea.kPrice()}", 2.dp.toPx(), volumeTop - 6.dp.toPx())
        } else {
            val maxVolume = max(candles.maxOf { it.volume.toDouble() }, (v5 + v10).filterNotNull().maxOrNull() ?: 0.0).coerceAtLeast(1.0)
            fun vy(v: Double) = volumeBottom - (v / maxVolume * (volumeBottom - volumeTop)).toFloat()
            candles.forEachIndexed { i, c ->
                val rect = Size(bodyWidth, max(.6.dp.toPx(), volumeBottom - vy(c.volume.toDouble())))
                val position = Offset(x(i) - bodyWidth / 2, vy(c.volume.toDouble()))
                if (c.close >= c.open) drawRect(KUp, position, rect, style = Stroke(.6.dp.toPx())) else drawRect(KDown, position, rect)
            }
            kLine(v5, KOrange, ::x, ::vy); kLine(v10, KMagenta, ::x, ::vy)
            kLabel("量 ${candles[active].volume.toDouble().kVolume()}   MA5 ${v5[active]?.kVolume() ?: "—"}   MA10 ${v10[active]?.kVolume() ?: "—"}", 2.dp.toPx(), volumeTop - 6.dp.toPx())
            kLabel(maxVolume.kVolume(), left - 4.dp.toPx(), volumeTop + 8.dp.toPx(), align = Paint.Align.RIGHT)
        }
        listOf(0, candles.size / 2, candles.lastIndex).distinct().forEachIndexed { n, i -> kLabel(candles[i].time.take(10), when(n) { 0 -> left; 1 -> (left + right) / 2; else -> right }, size.height - 4.dp.toPx(), align = when(n) { 0 -> Paint.Align.LEFT; 1 -> Paint.Align.CENTER; else -> Paint.Align.RIGHT }) }
        if (selected >= 0) {
            val effect = PathEffect.dashPathEffect(floatArrayOf(3.dp.toPx(), 3.dp.toPx()))
            drawLine(KInk, Offset(x(active), top), Offset(x(active), volumeBottom), .6.dp.toPx(), pathEffect = effect)
            drawLine(KInk, Offset(left, y(candles[active].close)), Offset(right, y(candles[active].close)), .6.dp.toPx(), pathEffect = effect)
        }
    }
}

private fun DrawScope.kLabel(text: String, x: Float, y: Float, color: Color = Color(0xFF737D88), align: Paint.Align = Paint.Align.LEFT) {
    drawContext.canvas.nativeCanvas.drawText(text, x, y, Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = color.toArgb(); textSize = 9.sp.toPx(); textAlign = align; typeface = android.graphics.Typeface.create("sans-serif", android.graphics.Typeface.NORMAL) })
}

private fun DrawScope.kLine(values: List<Double?>, color: Color, x: (Int) -> Float, y: (Double) -> Float) {
    val path = Path(); var begun = false
    values.forEachIndexed { i, v -> if (v == null || !v.isFinite()) begun = false else { if (begun) path.lineTo(x(i), y(v)) else path.moveTo(x(i), y(v)); begun = true } }
    drawPath(path, color, style = Stroke(.85.dp.toPx()))
}
