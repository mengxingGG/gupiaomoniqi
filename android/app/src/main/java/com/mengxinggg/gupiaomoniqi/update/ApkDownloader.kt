package com.mengxinggg.gupiaomoniqi.update

import android.content.Context
import com.mengxinggg.gupiaomoniqi.data.ApiUrl
import com.mengxinggg.gupiaomoniqi.model.AndroidAppRelease
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.job
import kotlinx.coroutines.withContext

class AppUpdateException(message: String, cause: Throwable? = null) :
    Exception(message, cause)

class ApkDownloader(context: Context) {
    private val updateDirectory = File(
        context.applicationContext.cacheDir,
        "updates",
    )

    suspend fun download(
        baseUrl: String,
        release: AndroidAppRelease,
        onProgress: (Float) -> Unit,
    ): File = withContext(Dispatchers.IO) {
        validateRelease(release)
        val downloadUrl = sameOriginHttpsUrl(baseUrl, release.apkPath)
        updateDirectory.mkdirs()
        if (!updateDirectory.isDirectory) {
            throw AppUpdateException("无法创建更新缓存目录")
        }
        val destination = File(
            updateDirectory,
            "update-${release.versionCode}-${release.sha256.take(12)}.apk",
        )
        if (
            destination.isFile &&
            destination.length() == release.sizeBytes &&
            sha256(destination).equals(release.sha256, ignoreCase = true)
        ) {
            onProgress(1f)
            return@withContext destination
        }

        val partial = File(destination.absolutePath + ".part")
        partial.delete()
        val connection = URL(downloadUrl).openConnection() as HttpURLConnection
        val cancellationHandle =
            currentCoroutineContext().job.invokeOnCompletion { cause ->
                if (cause is CancellationException) {
                    connection.disconnect()
                }
            }
        try {
            connection.requestMethod = "GET"
            connection.connectTimeout = 15_000
            connection.readTimeout = 120_000
            connection.instanceFollowRedirects = false
            connection.useCaches = false
            connection.setRequestProperty(
                "Accept",
                "application/vnd.android.package-archive",
            )
            val status = connection.responseCode
            if (status !in 200..299) {
                throw AppUpdateException("更新包下载失败（HTTP $status）")
            }
            val contentLength = connection.contentLengthLong
            if (contentLength > 0 && contentLength != release.sizeBytes) {
                throw AppUpdateException("服务器更新包大小与发布清单不一致")
            }

            val digest = MessageDigest.getInstance("SHA-256")
            var total = 0L
            connection.inputStream.use { input ->
                FileOutputStream(partial).use { output ->
                    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                    while (true) {
                        currentCoroutineContext().ensureActive()
                        val count = input.read(buffer)
                        if (count < 0) break
                        total += count
                        if (total > MAX_APK_BYTES || total > release.sizeBytes) {
                            throw AppUpdateException("更新包大小超出发布清单")
                        }
                        output.write(buffer, 0, count)
                        digest.update(buffer, 0, count)
                        onProgress(
                            (total.toDouble() / release.sizeBytes.toDouble())
                                .toFloat()
                                .coerceIn(0f, 1f),
                        )
                    }
                    output.fd.sync()
                }
            }
            if (total != release.sizeBytes) {
                throw AppUpdateException("更新包下载不完整")
            }
            val actualSha256 = digest.digest().toHex()
            if (!actualSha256.equals(release.sha256, ignoreCase = true)) {
                throw AppUpdateException("更新包 SHA-256 校验失败")
            }
            Files.move(
                partial.toPath(),
                destination.toPath(),
                StandardCopyOption.REPLACE_EXISTING,
            )
            updateDirectory.listFiles()
                ?.filter { it != destination && (it.extension == "apk" || it.extension == "part") }
                ?.forEach(File::delete)
            onProgress(1f)
            destination
        } catch (cancelled: CancellationException) {
            partial.delete()
            throw cancelled
        } catch (error: AppUpdateException) {
            partial.delete()
            throw error
        } catch (error: Throwable) {
            partial.delete()
            currentCoroutineContext().ensureActive()
            throw AppUpdateException(
                error.message ?: "更新包下载失败",
                error,
            )
        } finally {
            cancellationHandle.dispose()
            connection.disconnect()
        }
    }

    private fun sameOriginHttpsUrl(baseUrl: String, apkPath: String): String {
        if (
            !apkPath.startsWith("/") ||
            apkPath.contains("..") ||
            apkPath.contains('\\')
        ) {
            throw AppUpdateException("服务器返回了无效的更新包路径")
        }
        val normalizedBaseUrl = ApiUrl.normalizeBaseUrl(baseUrl)
        val baseUri = URI(normalizedBaseUrl)
        if (!baseUri.scheme.equals("https", ignoreCase = true)) {
            throw AppUpdateException("为保证安全，更新包只能通过 HTTPS 下载")
        }
        val result = URI(ApiUrl.build(normalizedBaseUrl, apkPath))
        if (
            !result.scheme.equals(baseUri.scheme, ignoreCase = true) ||
            !result.host.equals(baseUri.host, ignoreCase = true) ||
            effectivePort(result) != effectivePort(baseUri)
        ) {
            throw AppUpdateException("更新包必须与当前服务器同源")
        }
        return result.toString()
    }

    private fun validateRelease(release: AndroidAppRelease) {
        if (
            release.sizeBytes !in 1..MAX_APK_BYTES ||
            !release.sha256.matches(Regex("^[0-9a-fA-F]{64}$"))
        ) {
            throw AppUpdateException("服务器更新清单无效")
        }
    }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                digest.update(buffer, 0, count)
            }
        }
        return digest.digest().toHex()
    }

    private fun effectivePort(uri: URI): Int = when {
        uri.port >= 0 -> uri.port
        uri.scheme.equals("https", ignoreCase = true) -> 443
        else -> 80
    }

    private fun ByteArray.toHex(): String =
        joinToString(separator = "") { "%02x".format(it) }

    private companion object {
        const val MAX_APK_BYTES = 250L * 1024L * 1024L
    }
}
