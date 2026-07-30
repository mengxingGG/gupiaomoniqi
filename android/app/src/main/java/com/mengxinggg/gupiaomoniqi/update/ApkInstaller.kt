package com.mengxinggg.gupiaomoniqi.update

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.core.content.FileProvider
import com.mengxinggg.gupiaomoniqi.BuildConfig
import java.io.File

sealed interface InstallLaunchResult {
    data object Started : InstallLaunchResult
    data class PermissionRequired(val intent: Intent) : InstallLaunchResult
    data class Failed(val message: String) : InstallLaunchResult
}

class ApkInstaller(private val context: Context) {
    fun launch(file: File): InstallLaunchResult {
        if (!file.isFile) {
            return InstallLaunchResult.Failed("已下载的更新包不存在，请重新下载")
        }
        if (!context.packageManager.canRequestPackageInstalls()) {
            return InstallLaunchResult.PermissionRequired(
                Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:${BuildConfig.APPLICATION_ID}"),
                ),
            )
        }
        return try {
            val uri = FileProvider.getUriForFile(
                context,
                "${BuildConfig.APPLICATION_ID}.fileprovider",
                file,
            )
            context.startActivity(
                Intent(Intent.ACTION_VIEW)
                    .setDataAndType(
                        uri,
                        "application/vnd.android.package-archive",
                    )
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
            InstallLaunchResult.Started
        } catch (_: ActivityNotFoundException) {
            InstallLaunchResult.Failed("系统中没有可用的安装器")
        } catch (error: Throwable) {
            InstallLaunchResult.Failed(
                error.message ?: "无法打开系统安装器",
            )
        }
    }
}
