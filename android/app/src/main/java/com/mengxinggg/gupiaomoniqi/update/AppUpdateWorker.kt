package com.mengxinggg.gupiaomoniqi.update

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.mengxinggg.gupiaomoniqi.BuildConfig
import com.mengxinggg.gupiaomoniqi.data.ApiClient
import com.mengxinggg.gupiaomoniqi.data.ApiClientException
import com.mengxinggg.gupiaomoniqi.data.EncryptedTokenStore
import com.mengxinggg.gupiaomoniqi.data.InMemoryTokenStore
import java.net.URI
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class AppUpdateWorker(
    appContext: Context,
    parameters: WorkerParameters,
) : CoroutineWorker(appContext, parameters) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val tokenStore = EncryptedTokenStore(applicationContext)
        val baseUrl = tokenStore.baseUrl
        if (
            baseUrl.isBlank() ||
            !runCatching {
                URI(baseUrl).scheme.equals("https", ignoreCase = true)
            }.getOrDefault(false)
        ) {
            return@withContext Result.success()
        }
        try {
            val check = ApiClient(
                InMemoryTokenStore(initialBaseUrl = baseUrl),
            ).androidUpdate(
                BuildConfig.VERSION_CODE.toLong(),
            )
            if (tokenStore.baseUrl != baseUrl) {
                return@withContext Result.success()
            }
            AppUpdateStore(applicationContext).saveSuccessfulCheck(
                sourceBaseUrl = baseUrl,
                check = AppUpdatePolicy.sanitize(check),
            )
            Result.success()
        } catch (error: ApiClientException) {
            if (
                (
                    error.status == 0 ||
                        error.status == 408 ||
                        error.status == 425 ||
                        error.status == 429 ||
                        error.status in 500..599
                    ) &&
                runAttemptCount < 3
            ) {
                Result.retry()
            } else {
                Result.success()
            }
        } catch (_: AppUpdateException) {
            Result.success()
        } catch (_: Throwable) {
            if (runAttemptCount < 3) Result.retry() else Result.success()
        }
    }
}

object AppUpdateScheduler {
    private const val UNIQUE_WORK_NAME =
        "gupiaomoniqi-daily-app-update-check"

    fun ensureScheduled(context: Context) {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()
        val request = PeriodicWorkRequestBuilder<AppUpdateWorker>(
            24,
            TimeUnit.HOURS,
        )
            .setConstraints(constraints)
            .setBackoffCriteria(
                BackoffPolicy.EXPONENTIAL,
                30,
                TimeUnit.SECONDS,
            )
            .build()
        WorkManager.getInstance(context.applicationContext)
            .enqueueUniquePeriodicWork(
                UNIQUE_WORK_NAME,
                ExistingPeriodicWorkPolicy.UPDATE,
                request,
            )
    }
}
