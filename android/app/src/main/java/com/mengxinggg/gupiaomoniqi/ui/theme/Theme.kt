package com.mengxinggg.gupiaomoniqi.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val GainRed = Color(0xFFD6404F)
val LossGreen = Color(0xFF16845B)
val BrandBlue = Color(0xFF4057C8)

private val LightColors = lightColorScheme(
    primary = BrandBlue,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFE0E5FF),
    onPrimaryContainer = Color(0xFF15225E),
    secondary = Color(0xFF555D7E),
    background = Color(0xFFF7F7FB),
    surface = Color(0xFFFFFFFF),
    surfaceVariant = Color(0xFFE8E9F1),
    outline = Color(0xFF777783),
    error = Color(0xFFBA1A1A),
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFFBAC3FF),
    onPrimary = Color(0xFF0B2674),
    primaryContainer = Color(0xFF273E9E),
    onPrimaryContainer = Color(0xFFE0E5FF),
    secondary = Color(0xFFC2C5DD),
    background = Color(0xFF111318),
    surface = Color(0xFF191B20),
    surfaceVariant = Color(0xFF44464F),
    error = Color(0xFFFFB4AB),
)

@Composable
fun StockSimulatorTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        content = content,
    )
}
