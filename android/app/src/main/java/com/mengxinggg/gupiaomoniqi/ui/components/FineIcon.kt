package com.mengxinggg.gupiaomoniqi.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

enum class FineSymbol { MENU, NEW_CHAT, EXPAND, CLOSE, BACK, STAR, PLUS, MINUS, PREVIOUS, NEXT, SETTINGS }

/** 统一 24 单位网格、圆角端点和细线宽，点击热区由外层按钮提供。 */
@Composable
fun FineIcon(symbol: FineSymbol, description: String?, modifier: Modifier = Modifier) {
    val color = LocalContentColor.current
    Canvas(modifier.size(22.dp).semantics { if (description != null) contentDescription = description }) {
        scale(size.width / 24f, size.height / 24f, pivot = Offset.Zero) {
            fun line(x: Float, y: Float, ex: Float, ey: Float) = drawLine(color, Offset(x, y), Offset(ex, ey), 1.6f, StrokeCap.Round)
            when (symbol) {
                FineSymbol.SETTINGS -> {
                    drawCircle(color, 6f, Offset(12f, 12f), style = Stroke(1.6f))
                    drawCircle(color, 2f, Offset(12f, 12f), style = Stroke(1.6f))
                    repeat(8) { i ->
                        val a = Math.PI * i / 4
                        line(12f + (kotlin.math.cos(a) * 6).toFloat(), 12f + (kotlin.math.sin(a) * 6).toFloat(), 12f + (kotlin.math.cos(a) * 9).toFloat(), 12f + (kotlin.math.sin(a) * 9).toFloat())
                    }
                }
                FineSymbol.MENU -> { line(4f, 6f, 20f, 6f); line(4f, 12f, 15f, 12f); line(4f, 18f, 20f, 18f) }
                FineSymbol.NEW_CHAT -> {
                    val path = Path().apply { moveTo(19f, 13f); lineTo(19f, 20f); lineTo(4f, 20f); lineTo(4f, 5f); lineTo(11f, 5f) }
                    drawPath(path, color, style = Stroke(1.6f, cap = StrokeCap.Round))
                    line(11f, 13f, 20f, 4f); line(17f, 4f, 20f, 4f); line(20f, 4f, 20f, 7f)
                }
                FineSymbol.EXPAND -> { line(14f, 4f, 20f, 4f); line(20f, 4f, 20f, 10f); line(20f, 4f, 14f, 10f); line(4f, 14f, 4f, 20f); line(4f, 20f, 10f, 20f); line(4f, 20f, 10f, 14f) }
                FineSymbol.CLOSE -> { line(6f, 6f, 18f, 18f); line(18f, 6f, 6f, 18f) }
                FineSymbol.BACK -> { line(15f, 4f, 7f, 12f); line(7f, 12f, 15f, 20f) }
                FineSymbol.PLUS -> { line(5f, 12f, 19f, 12f); line(12f, 5f, 12f, 19f) }
                FineSymbol.MINUS -> line(5f, 12f, 19f, 12f)
                FineSymbol.PREVIOUS -> { line(14f, 6f, 8f, 12f); line(8f, 12f, 14f, 18f) }
                FineSymbol.NEXT -> { line(10f, 6f, 16f, 12f); line(16f, 12f, 10f, 18f) }
                FineSymbol.STAR -> {
                    val path = Path().apply { moveTo(12f, 3f); lineTo(14.8f, 8.7f); lineTo(21f, 9.6f); lineTo(16.5f, 14f); lineTo(17.6f, 20.3f); lineTo(12f, 17.3f); lineTo(6.4f, 20.3f); lineTo(7.5f, 14f); lineTo(3f, 9.6f); lineTo(9.2f, 8.7f); close() }
                    drawPath(path, color, style = Stroke(1.6f))
                }
            }
        }
    }
}
