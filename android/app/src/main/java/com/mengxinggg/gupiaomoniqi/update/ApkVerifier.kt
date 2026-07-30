package com.mengxinggg.gupiaomoniqi.update

import android.content.Context
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.content.pm.Signature
import android.os.Build
import com.mengxinggg.gupiaomoniqi.BuildConfig
import com.mengxinggg.gupiaomoniqi.model.AndroidAppRelease
import java.io.File
import java.security.MessageDigest

class ApkVerifier(context: Context) {
    private val packageManager = context.applicationContext.packageManager

    @Suppress("DEPRECATION")
    fun verify(file: File, release: AndroidAppRelease) {
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            PackageManager.GET_SIGNING_CERTIFICATES
        } else {
            PackageManager.GET_SIGNATURES
        }
        val archive = packageManager.getPackageArchiveInfo(
            file.absolutePath,
            flags,
        ) ?: throw AppUpdateException("下载文件不是有效的 Android 安装包")
        if (
            archive.packageName != BuildConfig.APPLICATION_ID ||
            release.packageName != BuildConfig.APPLICATION_ID
        ) {
            throw AppUpdateException("更新包应用标识不匹配")
        }
        val archiveVersionCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            archive.longVersionCode
        } else {
            archive.versionCode.toLong()
        }
        if (
            archiveVersionCode != release.versionCode ||
            archiveVersionCode <= BuildConfig.VERSION_CODE.toLong()
        ) {
            throw AppUpdateException("更新包版本号与发布清单不匹配")
        }
        if (archive.versionName != release.versionName) {
            throw AppUpdateException("更新包版本名称与发布清单不匹配")
        }

        val installed = packageManager.getPackageInfo(
            BuildConfig.APPLICATION_ID,
            flags,
        )
        val installedSigners = signerDigests(installed)
        val archiveSigners = signerDigests(archive)
        if (
            installedSigners.isEmpty() ||
            archiveSigners.isEmpty() ||
            installedSigners != archiveSigners
        ) {
            throw AppUpdateException("更新包签名与当前 App 不一致")
        }
    }

    @Suppress("DEPRECATION")
    private fun signatures(info: PackageInfo): Array<Signature> {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
            return info.signatures ?: emptyArray()
        }
        val signingInfo = info.signingInfo ?: return emptyArray()
        return if (signingInfo.hasMultipleSigners()) {
            signingInfo.apkContentsSigners
        } else {
            signingInfo.signingCertificateHistory
        }
    }

    private fun signerDigests(info: PackageInfo): Set<String> =
        signatures(info).mapTo(mutableSetOf()) { signature ->
            MessageDigest.getInstance("SHA-256")
                .digest(signature.toByteArray())
                .joinToString(separator = "") { "%02x".format(it) }
        }
}
