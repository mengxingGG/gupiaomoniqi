package com.mengxinggg.gupiaomoniqi.update

import com.mengxinggg.gupiaomoniqi.BuildConfig
import com.mengxinggg.gupiaomoniqi.model.AndroidAppRelease
import com.mengxinggg.gupiaomoniqi.model.AndroidUpdateCheck

internal object AppUpdatePolicy {
    fun sanitize(check: AndroidUpdateCheck): AndroidUpdateCheck {
        if (check.currentVersionCode != BuildConfig.VERSION_CODE.toLong()) {
            throw AppUpdateException("服务器返回的当前版本号不正确")
        }
        val release = check.release
        if (release == null) {
            if (check.updateAvailable) {
                throw AppUpdateException("服务器更新清单不完整")
            }
            return check.copy(updateAvailable = false, release = null)
        }
        if (!check.updateAvailable || !isValidNewRelease(release)) {
            throw AppUpdateException("服务器更新清单无效")
        }
        return check.copy(updateAvailable = true, release = release)
    }

    fun isValidNewRelease(release: AndroidAppRelease): Boolean =
        release.packageName == BuildConfig.APPLICATION_ID &&
            release.versionCode > BuildConfig.VERSION_CODE.toLong() &&
            release.versionName.isNotBlank() &&
            release.apkPath.startsWith("/") &&
            !release.apkPath.contains("..") &&
            !release.apkPath.contains('\\') &&
            release.sha256.matches(SHA256_REGEX) &&
            release.sizeBytes in 1L..MAX_APK_BYTES &&
            release.publishedAt.isNotBlank()

    private const val MAX_APK_BYTES = 250L * 1024L * 1024L
    private val SHA256_REGEX = Regex("^[0-9a-fA-F]{64}$")
}
