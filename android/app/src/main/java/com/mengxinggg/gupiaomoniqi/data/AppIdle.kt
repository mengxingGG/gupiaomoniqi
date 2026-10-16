package com.mengxinggg.gupiaomoniqi.data

import android.os.SystemClock

object AppIdle {
    @Volatile var lastInteraction: Long = SystemClock.elapsedRealtime()
    fun touch() { lastInteraction = SystemClock.elapsedRealtime() }
    fun ready() = SystemClock.elapsedRealtime() - lastInteraction >= 15_000
}
