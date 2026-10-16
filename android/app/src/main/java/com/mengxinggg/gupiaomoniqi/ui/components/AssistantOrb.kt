package com.mengxinggg.gupiaomoniqi.ui.components

import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt

/** 位置按可用区域比例保存；屏幕、系统字体和安全区变化后仍保持在边框内。 */
@Composable
fun AssistantOrb(status: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences("assistant_orb_position", 0) }
    var right by remember { mutableStateOf(prefs.getBoolean("right", true)) }
    var fraction by remember { mutableStateOf(prefs.getFloat("vertical", .78f).coerceIn(0f, 1f)) }
    var dragging by remember { mutableStateOf(false) }
    var dragX by remember { mutableStateOf(0f) }
    var dragY by remember { mutableStateOf(0f) }
    val transition = rememberInfiniteTransition(label = "助手呼吸")
    val breath by transition.animateFloat(.99f, 1.01f, infiniteRepeatable(tween(1800), RepeatMode.Reverse), label = "球体轻呼吸")
    val blink by transition.animateFloat(1f, 1f, infiniteRepeatable(keyframes {
        durationMillis = 5200
        1f at 0; 1f at 4200; .16f at 4330; 1f at 4460; 1f at 5200
    }), label = "轻轻眨眼")
    val glance by transition.animateFloat(-1f, 1f, infiniteRepeatable(tween(1500), RepeatMode.Reverse), label = "思考视线")
    val density = LocalDensity.current
    BoxWithConstraints(modifier) {
        val diameter = 48.dp
        val maxX = with(density) { (maxWidth - diameter).toPx().coerceAtLeast(0f) }
        val maxY = with(density) { (maxHeight - diameter).toPx().coerceAtLeast(0f) }
        val targetX = if (dragging) dragX.coerceIn(0f, maxX) else if (right) maxX else 0f
        val targetY = if (dragging) dragY.coerceIn(0f, maxY) else maxY * fraction
        val x by animateFloatAsState(targetX, if (dragging) snap() else spring(dampingRatio = .8f, stiffness = Spring.StiffnessMedium), label = "吸附边框")
        val y by animateFloatAsState(targetY, if (dragging) snap() else spring(), label = "球体位置")
        fun save() { prefs.edit().putBoolean("right", right).putFloat("vertical", fraction).apply() }
        val stateLabel = when (status) { "running" -> "任务进行中"; "error" -> "任务需要重试"; "complete" -> "回复已完成"; else -> "点击提问" }
        Box(Modifier.offset { IntOffset(x.roundToInt(), y.roundToInt()) }.size(diameter)
            .semantics {
                contentDescription = "AI 助手，$stateLabel，可拖动并吸附边缘"
                customActions = listOf(
                    CustomAccessibilityAction("移到左边") { right = false; save(); true },
                    CustomAccessibilityAction("移到右边") { right = true; save(); true },
                    CustomAccessibilityAction("上移") { fraction = (fraction - .2f).coerceAtLeast(0f); save(); true },
                    CustomAccessibilityAction("下移") { fraction = (fraction + .2f).coerceAtMost(1f); save(); true },
                )
            }
            .pointerInput(maxX, maxY) {
                detectDragGestures(onDragStart = { dragX = x; dragY = y; dragging = true },
                    onDrag = { change, amount -> change.consume(); dragX = (dragX + amount.x).coerceIn(0f,maxX); dragY = (dragY + amount.y).coerceIn(0f,maxY) },
                    onDragEnd = { right = dragX > maxX / 2f; fraction = if (maxY > 0f) dragY / maxY else 0f; dragging = false; save() },
                    onDragCancel = { dragging = false })
            }.clickable(onClickLabel = "打开 AI 助手", onClick = onClick), contentAlignment = Alignment.Center) {
            Box(Modifier.size(40.dp).scale(if (dragging) 1.04f else breath)
                .shadow(if (dragging) 5.dp else 2.dp, CircleShape).clip(CircleShape)
                .background(Color.White).border(.6.dp, Color(0xFFE5E5E5), CircleShape), contentAlignment = Alignment.Center) {
            if (status == "running") CircularProgressIndicator(Modifier.fillMaxSize().padding(3.dp), color = Color(0xFFA1A5AD), strokeWidth = 1.5.dp)
            Canvas(Modifier.fillMaxSize()) {
                val eye = size.width * .055f
                val look = if (dragging) size.width * .025f else if (status == "running") glance * size.width * .018f else 0f
                val ink = Color.Black
                listOf(.35f, .65f).forEach { position ->
                    drawOval(ink, topLeft = Offset(size.width * position + look - eye, size.height * .43f - eye * blink), size = Size(eye * 2, eye * 2 * blink))
                }
                val mouth = size.width * (if (status == "complete") .052f else .041f)
                drawCircle(ink, radius = mouth, center = Offset(size.width * .5f + look * .5f, size.height * .64f + if (status == "running") glance * size.height * .012f else 0f))
            }
            }
        }
    }
}
