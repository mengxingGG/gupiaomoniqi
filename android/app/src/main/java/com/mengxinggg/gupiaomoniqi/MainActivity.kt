package com.mengxinggg.gupiaomoniqi

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.mengxinggg.gupiaomoniqi.ui.StockSimulatorApp
import com.mengxinggg.gupiaomoniqi.update.AppUpdateScheduler

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        AppUpdateScheduler.ensureScheduled(applicationContext)
        enableEdgeToEdge()
        setContent {
            StockSimulatorApp()
        }
    }
}
