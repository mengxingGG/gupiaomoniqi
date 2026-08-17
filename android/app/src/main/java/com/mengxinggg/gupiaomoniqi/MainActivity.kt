package com.mengxinggg.gupiaomoniqi

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.mengxinggg.gupiaomoniqi.ui.StockSimulatorApp
import com.mengxinggg.gupiaomoniqi.data.EncryptedTokenStore
import com.mengxinggg.gupiaomoniqi.update.AppUpdateScheduler

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        applyDebugServerOverride(intent)
        AppUpdateScheduler.ensureScheduled(applicationContext)
        enableEdgeToEdge()
        setContent {
            StockSimulatorApp()
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        applyDebugServerOverride(intent)
    }

    private fun applyDebugServerOverride(intent: Intent?) {
        if (!BuildConfig.DEBUG) return
        val requestedServerUrl = intent
            ?.getStringExtra(DEBUG_SERVER_URL_EXTRA)
            ?.trim()
            ?: return
        val serverUrl = if (requestedServerUrl == DEBUG_CLEAR_SERVER_URL) {
            ""
        } else {
            requestedServerUrl
        }
        // 仅调试包允许 ADB 预置地址；正式包仍必须通过设置页健康检查。
        EncryptedTokenStore(applicationContext).baseUrl = serverUrl
    }

    private companion object {
        const val DEBUG_SERVER_URL_EXTRA = "debug_server_url"
        const val DEBUG_CLEAR_SERVER_URL = "__CLEAR__"
    }
}
