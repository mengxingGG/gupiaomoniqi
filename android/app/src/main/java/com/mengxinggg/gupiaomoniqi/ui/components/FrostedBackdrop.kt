package com.mengxinggg.gupiaomoniqi.ui.components

import android.graphics.Bitmap
import android.graphics.Canvas
import androidx.compose.runtime.*
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** 仅捕获本应用底层视图，在内存降采样模糊；兼容 Android 8+，不申请截屏权限或落盘。 */
@Composable
internal fun rememberFrostedBackdrop(visible: Boolean): ImageBitmap? {
    val page = LocalView.current.rootView
    var image by remember { mutableStateOf<ImageBitmap?>(null) }
    LaunchedEffect(visible, page) {
        if (!visible) return@LaunchedEffect
        if (page.width <= 0 || page.height <= 0) return@LaunchedEffect
        val bitmap = Bitmap.createBitmap((page.width / 8).coerceAtLeast(1), (page.height / 8).coerceAtLeast(1), Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.scale(bitmap.width.toFloat() / page.width, bitmap.height.toFloat() / page.height)
        page.draw(canvas)
        image = withContext(Dispatchers.Default) {
            val width = bitmap.width; val height = bitmap.height
            var pixels = IntArray(width * height)
            bitmap.getPixels(pixels, 0, width, 0, 0, width, height)
            repeat(2) { pixels = blurPass(blurPass(pixels, width, height, true), width, height, false) }
            bitmap.setPixels(pixels, 0, width, 0, 0, width, height)
            bitmap.asImageBitmap()
        }
    }
    return image
}

/** 滑动窗口盒式模糊，两轮可柔化边界；耗时与像素数线性相关。 */
private fun blurPass(input: IntArray, width: Int, height: Int, horizontal: Boolean): IntArray {
    val result = IntArray(input.size); val radius = 4; val count = radius * 2 + 1
    val length = if (horizontal) width else height
    val lines = if (horizontal) height else width
    for (line in 0 until lines) {
        fun index(position: Int): Int = if (horizontal) line * width + position.coerceIn(0, length - 1) else position.coerceIn(0, length - 1) * width + line
        var red = 0; var green = 0; var blue = 0
        fun add(pixel: Int, sign: Int) {
            red += ((pixel shr 16) and 255) * sign; green += ((pixel shr 8) and 255) * sign; blue += (pixel and 255) * sign
        }
        for (offset in -radius..radius) add(input[index(offset)], 1)
        for (position in 0 until length) {
            result[index(position)] = (255 shl 24) or ((red / count) shl 16) or ((green / count) shl 8) or (blue / count)
            add(input[index(position - radius)], -1); add(input[index(position + radius + 1)], 1)
        }
    }
    return result
}
