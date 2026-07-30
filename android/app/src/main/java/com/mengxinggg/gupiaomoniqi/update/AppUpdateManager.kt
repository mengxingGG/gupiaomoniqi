package com.mengxinggg.gupiaomoniqi.update

import android.content.Context
import com.mengxinggg.gupiaomoniqi.BuildConfig
import com.mengxinggg.gupiaomoniqi.data.ApiClient
import com.mengxinggg.gupiaomoniqi.data.ApiClientException
import com.mengxinggg.gupiaomoniqi.data.EncryptedTokenStore
import com.mengxinggg.gupiaomoniqi.data.InMemoryTokenStore
import com.mengxinggg.gupiaomoniqi.model.AndroidAppRelease
import java.io.File
import java.net.URI
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

data class AppUpdateUiState(
    val release: AndroidAppRelease? = null,
    val lastSuccessfulCheckAtMillis: Long = 0L,
    val checking: Boolean = false,
    val downloading: Boolean = false,
    val downloadProgress: Float = 0f,
    val downloadedApkPath: String? = null,
    val installRequestId: Long = 0L,
    val message: String? = null,
) {
    val updateAvailable: Boolean
        get() = release?.let {
            it.packageName == BuildConfig.APPLICATION_ID &&
                it.versionCode > BuildConfig.VERSION_CODE.toLong()
        } == true

    val busy: Boolean
        get() = checking || downloading
}

/**
 * 应用更新与登录状态相互独立：后台只检查元数据，只有用户主动点击后才下载 APK。
 */
class AppUpdateManager(context: Context) : AutoCloseable {
    private val applicationContext = context.applicationContext
    private val tokenStore = EncryptedTokenStore(applicationContext)
    private val store = AppUpdateStore(applicationContext)
    private val downloader = ApkDownloader(applicationContext)
    private val verifier = ApkVerifier(applicationContext)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val mutableState = MutableStateFlow(AppUpdateUiState())
    private var silentCheckJob: Job? = null
    private var manualUpdateJob: Job? = null
    private var observedBaseUrl = tokenStore.baseUrl
    private var configurationGeneration = 0L
    private val storeListener = store.addChangeListener {
        scope.launch {
            refreshFromStore()
        }
    }

    val state: StateFlow<AppUpdateUiState> = mutableState.asStateFlow()

    init {
        refreshFromStore()
    }

    fun onAppForeground() {
        refreshFromStore()
        checkSilentlyIfDue()
    }

    fun onServerConfigurationChanged() {
        val currentBaseUrl = tokenStore.baseUrl
        if (currentBaseUrl != observedBaseUrl) {
            observedBaseUrl = currentBaseUrl
            configurationGeneration += 1L
            silentCheckJob?.cancel()
            manualUpdateJob?.cancel()
            silentCheckJob = null
            manualUpdateJob = null
            mutableState.value.downloadedApkPath?.let { path ->
                runCatching { File(path).delete() }
            }
            mutableState.update {
                it.copy(
                    release = null,
                    checking = false,
                    downloading = false,
                    downloadProgress = 0f,
                    downloadedApkPath = null,
                    message = null,
                )
            }
        }
        refreshFromStore()
        checkSilentlyIfDue()
    }

    fun checkAndInstall() {
        if (manualUpdateJob?.isActive == true || mutableState.value.busy) return
        silentCheckJob?.cancel()
        silentCheckJob = null
        val baseUrl = tokenStore.baseUrl
        if (baseUrl.isBlank()) {
            showMessage("请先在设置中配置服务器地址")
            return
        }
        if (!isHttpsBaseUrl(baseUrl)) {
            showMessage("应用更新需要 HTTPS 服务器")
            return
        }
        val generation = configurationGeneration
        manualUpdateJob = scope.launch {
            mutableState.update {
                it.copy(
                    checking = true,
                    downloading = false,
                    downloadProgress = 0f,
                    message = null,
                )
            }
            try {
                val check = withContext(Dispatchers.IO) {
                    fetchUpdate(baseUrl)
                }
                ensureConfigurationCurrent(baseUrl, generation)
                val sanitized = AppUpdatePolicy.sanitize(check)
                store.saveSuccessfulCheck(
                    sourceBaseUrl = baseUrl,
                    check = sanitized,
                )
                val release = sanitized.release
                if (release == null) {
                    mutableState.update {
                        it.copy(
                            release = null,
                            checking = false,
                            downloading = false,
                            downloadProgress = 0f,
                            downloadedApkPath = null,
                            message = "已是最新版本（${BuildConfig.VERSION_NAME}）",
                        )
                    }
                    return@launch
                }

                mutableState.update {
                    it.copy(
                        release = release,
                        checking = false,
                        downloading = true,
                        downloadProgress = 0f,
                        downloadedApkPath = null,
                    )
                }
                val apk = downloader.download(
                    baseUrl = baseUrl,
                    release = release,
                    onProgress = { progress ->
                        mutableState.update {
                            it.copy(downloadProgress = progress)
                        }
                    },
                )
                ensureConfigurationCurrent(baseUrl, generation, apk)
                withContext(Dispatchers.IO) {
                    verifier.verify(apk, release)
                }
                ensureConfigurationCurrent(baseUrl, generation, apk)
                mutableState.update {
                    it.copy(
                        checking = false,
                        downloading = false,
                        downloadProgress = 1f,
                        downloadedApkPath = apk.absolutePath,
                        installRequestId = it.installRequestId + 1L,
                        message = "更新包已通过完整性与签名校验",
                    )
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Throwable) {
                mutableState.update {
                    it.copy(
                        checking = false,
                        downloading = false,
                        downloadProgress = 0f,
                        message = updateErrorMessage(error),
                    )
                }
            }
        }
    }

    fun requestInstallAgain() {
        val path = mutableState.value.downloadedApkPath
        if (path == null || !File(path).isFile) {
            checkAndInstall()
            return
        }
        mutableState.update {
            it.copy(
                installRequestId = it.installRequestId + 1L,
                message = null,
            )
        }
    }

    fun onInstallPermissionRequired() {
        showMessage("请允许此 App 安装更新，返回后会继续打开系统安装器")
    }

    fun onInstallerStarted() {
        showMessage("已交给系统安装器，请按系统提示确认更新")
    }

    fun onInstallFailed(message: String) {
        showMessage(message)
    }

    fun consumeMessage(message: String) {
        mutableState.update {
            if (it.message == message) it.copy(message = null) else it
        }
    }

    override fun close() {
        storeListener.close()
        scope.cancel()
    }

    private fun checkSilentlyIfDue() {
        if (
            tokenStore.baseUrl.isBlank() ||
            !isHttpsBaseUrl(tokenStore.baseUrl) ||
            silentCheckJob?.isActive == true ||
            manualUpdateJob?.isActive == true
        ) {
            return
        }
        val snapshot = store.snapshot()
        val sameServer = snapshot.sourceBaseUrl == tokenStore.baseUrl
        val age = System.currentTimeMillis() - snapshot.lastSuccessfulCheckAtMillis
        if (sameServer && age in 0 until DAILY_CHECK_INTERVAL_MILLIS) {
            return
        }
        val generation = configurationGeneration
        silentCheckJob = scope.launch {
            try {
                val baseUrl = tokenStore.baseUrl
                val check = withContext(Dispatchers.IO) {
                    fetchUpdate(baseUrl)
                }
                ensureConfigurationCurrent(baseUrl, generation)
                store.saveSuccessfulCheck(
                    sourceBaseUrl = baseUrl,
                    check = AppUpdatePolicy.sanitize(check),
                )
                refreshFromStore()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Throwable) {
                // 静默检查失败不打扰用户；手动检查会显示具体错误。
            }
        }
    }

    private fun refreshFromStore() {
        val snapshot = store.snapshot()
        val release = snapshot.release
            ?.takeIf { snapshot.sourceBaseUrl == tokenStore.baseUrl }
            ?.takeIf { isHttpsBaseUrl(tokenStore.baseUrl) }
            ?.takeIf(AppUpdatePolicy::isValidNewRelease)
        mutableState.update { current ->
            val sameRelease =
                current.release?.versionCode == release?.versionCode &&
                    current.release?.sha256.equals(release?.sha256, ignoreCase = true)
            current.copy(
                release = release,
                lastSuccessfulCheckAtMillis = if (
                    snapshot.sourceBaseUrl == tokenStore.baseUrl
                ) {
                    snapshot.lastSuccessfulCheckAtMillis
                } else {
                    0L
                },
                downloadedApkPath = if (sameRelease) {
                    current.downloadedApkPath
                } else {
                    null
                },
            )
        }
    }

    private fun updateErrorMessage(error: Throwable): String = when (error) {
        is ApiClientException -> when {
            error.status == 0 ->
                "无法连接更新服务器，请检查网络和服务器地址"
            error.status == 404 ->
                "当前服务器尚未提供 Android 更新接口"
            !error.message.isNullOrBlank() ->
                error.message.orEmpty()
            else ->
                "检查更新失败（HTTP ${error.status}）"
        }
        is AppUpdateException ->
            error.message ?: "应用更新失败"
        else ->
            error.message ?: "应用更新失败"
    }

    private fun showMessage(message: String) {
        mutableState.update { it.copy(message = message) }
    }

    private fun fetchUpdate(baseUrl: String) =
        ApiClient(InMemoryTokenStore(initialBaseUrl = baseUrl))
            .androidUpdate(BuildConfig.VERSION_CODE.toLong())

    private fun ensureConfigurationCurrent(
        baseUrl: String,
        generation: Long,
        downloadedApk: File? = null,
    ) {
        if (
            baseUrl == tokenStore.baseUrl &&
            generation == configurationGeneration
        ) {
            return
        }
        downloadedApk?.delete()
        throw CancellationException("Server configuration changed")
    }

    private fun isHttpsBaseUrl(baseUrl: String): Boolean =
        runCatching {
            URI(baseUrl).scheme.equals("https", ignoreCase = true)
        }.getOrDefault(false)

    private companion object {
        const val DAILY_CHECK_INTERVAL_MILLIS = 24L * 60L * 60L * 1_000L
    }
}
